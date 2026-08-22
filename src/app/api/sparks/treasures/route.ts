// Kaya Sparks · Treasures Admin-API gateway (2026-08-16).
//
// EVERY treasure read + write flows through here — the client never
// touches the `sparks_treasure*` collections directly. That is what
// makes two things real at once:
//
//   1. D4/F14 · the money value, receipts, serial numbers and warranty
//      dates live in `sparks_treasure_private` and are returned to
//      PARENTS ONLY. They cannot leak through a shared screen, a
//      sibling view, a helper's screen, an export or an AI reply,
//      because no non-parent request ever receives the fields at all.
//   2. D20 · ZERO firestore.rules / index / storage.rules deploys.
//      Unlisted collection paths are default-deny for clients, so the
//      Admin SDK here is the only door. Every query below is
//      equality-only — never add a range or orderBy without checking.
//
// Access matrix:
//   · parent            → full read/write on every kid in the family,
//                         plus the private value sub-document
//   · kid (owner)       → read + register + check + report condition +
//                         lend/return + story on their OWN treasures;
//                         NEVER receives values
//   · kid (sibling)     → only treasures the owner promoted to
//                         'siblings'/'family'; read-only; may add a
//                         SIGHTING to a missing item (D10) and nothing
//                         else; never receives values
//   · helper (sparks act, kid in kidIds)
//                       → mark found, complete a check, add a sighting
//                         ONLY (D18). No values, no create, no delete,
//                         no hand-on.
//   · anyone else       → 403
//
// Storage: /families/{familyId}/sparks_treasures
//                              |_treasure_events   (append-only trail)
//                              |_treasure_private  (parents only, ever)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';

/** D7 · the honesty window. Report a loss or break yourself inside this
 *  many days of it happening and you earn 🫱 Owned It. Generous on
 *  purpose: a child who is scared to report is the failure mode that
 *  makes the whole register fiction. */
const OWNED_IT_WINDOW_DAYS = 7;

/** D6 · a parent may truly delete only a mis-entry, only this soon. */
const HARD_DELETE_WINDOW_MS = 24 * 60 * 60 * 1000;

const CADENCE_DAYS: Record<string, number> = {
  weekly: 7, fortnightly: 14, monthly: 30, termly: 90,
};

const LIVE_ONLY = ['kept', 'lent', 'lost', 'broken', 'repaired'];
const ENDED = ['handed_on', 'donated', 'sold', 'outgrown', 'retired'];

type Action =
  | 'list' | 'get' | 'today' | 'create' | 'update' | 'delete'
  | 'story-set' | 'check-submit' | 'settings-get' | 'settings-set'
  | 'condition' | 'found' | 'sighting'
  | 'lend' | 'return' | 'lend-extend'
  | 'private-set' | 'end'
  | 'thankyou-set' | 'thankyou-send' | 'reply-add'
  | 'family-board' | 'people' | 'roll-up'
  | 'wish-list' | 'wish-add' | 'wish-remove';

const ALL_ACTIONS: Action[] = [
  'list', 'get', 'today', 'create', 'update', 'delete',
  'story-set', 'check-submit', 'settings-get', 'settings-set',
  'condition', 'found', 'sighting',
  'lend', 'return', 'lend-extend',
  'private-set', 'end',
  'thankyou-set', 'thankyou-send', 'reply-add',
  'family-board', 'people', 'roll-up',
  'wish-list', 'wish-add', 'wish-remove',
];

// ── Small validators ────────────────────────────────────────────────

const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

function str(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const VISIBILITIES = ['private', 'siblings', 'family'] as const;
const visibility = (v: unknown): string =>
  (VISIBILITIES as readonly string[]).includes(v as string) ? (v as string) : 'private';

const GIVER_KINDS = ['family', 'person', 'self', 'unknown'] as const;
const giverKind = (v: unknown): string =>
  (GIVER_KINDS as readonly string[]).includes(v as string) ? (v as string) : 'unknown';

const OWNERSHIPS = ['kid', 'shared'] as const;
const ownership = (v: unknown): string =>
  (OWNERSHIPS as readonly string[]).includes(v as string) ? (v as string) : 'kid';

const CHECK_RESULTS = ['have', 'fix', 'missing'] as const;
const checkResult = (v: unknown): string | null =>
  (CHECK_RESULTS as readonly string[]).includes(v as string) ? (v as string) : null;

function emailList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .slice(0, 8);
}

// ── Local-day helpers (day boundaries are LOCAL, never UTC) ─────────

function todayInTZ(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d); // en-CA formats as YYYY-MM-DD
}

function daysBetween(fromIso: string, toIso: string): number {
  const [fy, fm, fd] = fromIso.split('-').map(Number);
  const [ty, tm, td] = toIso.split('-').map(Number);
  return Math.round((Date.UTC(ty, (tm || 1) - 1, td || 1)
    - Date.UTC(fy, (fm || 1) - 1, fd || 1)) / 86400000);
}

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/** D23 · the next due date for a check, given the cadence, the preferred
 *  weekday and when it was last done. Always lands ON the chosen day of
 *  week so the ritual has a fixed place in the family's week. */
function nextCheckDue(
  lastDoneOn: string | undefined,
  cadence: string,
  dayOfWeek: number,
  today: string,
): string {
  const interval = CADENCE_DAYS[cadence] ?? 14;
  if (!lastDoneOn) {
    // Never checked — due on the next occurrence of the chosen weekday
    // (today counts, so a family that sets it up on a Sunday starts now).
    const [y, m, d] = today.split('-').map(Number);
    const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
    const delta = (dayOfWeek - dow + 7) % 7;
    return addDays(today, delta);
  }
  let due = addDays(lastDoneOn, interval);
  // Snap forward to the chosen weekday so checks don't drift.
  const [y, m, d] = due.split('-').map(Number);
  const dow = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  due = addDays(due, (dayOfWeek - dow + 7) % 7);
  return due;
}

// ── The coarse age curve (D15 · F8) ─────────────────────────────────
//
// Mirrors `residualFraction` in lib/sparks/treasures.ts. Deliberately
// crude: no market data, no FX, no resale pricing. The teaching point is
// "things wear out", not an exact figure — and the falling number is
// PARENT-ONLY, because a child reading "your bike is worth less now"
// hears "your bike is getting worse" (R5).
const LIFE_YEARS: Record<string, number> = {
  wearable: 5, school: 3, outdoor: 6, tech: 4, toy: 5,
  book: 10, game: 6, music: 10, clothes: 2, keepsake: 0, other: 5,
};

/** 🗄 Treasures 2.0 · family-owned Cupboard items carry this sentinel
 *  kidId (lib/sparks/treasures.ts FAMILY_OWNER_ID). They are served by
 *  /api/sparks/treasures/cupboard; here they only surface on the
 *  family-wide Lost & Found board. */
const FAMILY_OWNER_ID = 'family';

function residual(categoryId: string, yearsOld: number): number {
  const life = LIFE_YEARS[categoryId] ?? 5;
  if (life <= 0) return 1;                       // keepsakes never fall
  const worn = Math.min(1, Math.max(0, yearsOld / life));
  return Math.max(0.15, 1 - worn * 0.85);        // a working thing is never worth nothing
}

function yearsSince(fromIso: string, toIso: string): number {
  return Math.max(0, daysBetween(fromIso, toIso) / 365.25);
}

/** D4 · the CHILD's currency. Money is converted into the effort it
 *  actually took, because "about 6 weeks of chores" is a sentence a
 *  9-year-old can act on and "TZS 420,000" is not.
 *
 *  Rate comes from the family's own Hive config (`hpToHoneyRate` points
 *  per honey coin, `honeyToCashRate` USD per coin), and the weeks come
 *  from the child's OWN earning rate — lifetime points over the weeks
 *  they've been in Kaya. One doc read, no query, no index. */
function effortPointsFor(
  valueCents: number, currency: string, hive: { hpToHoneyRate?: number; honeyToCashRate?: number } | undefined,
): number {
  const perCoin = Number(hive?.hpToHoneyRate) > 0 ? Number(hive?.hpToHoneyRate) : 100;
  const usdPerCoin = Number(hive?.honeyToCashRate) > 0 ? Number(hive?.honeyToCashRate) : 1;
  const pointsPerMajorUnit = perCoin / usdPerCoin;
  // We do NOT convert currencies here — an approximate effort figure in
  // the family's own money is honest; a wrong FX number is not.
  void currency;
  return Math.round((valueCents / 100) * pointsPerMajorUnit);
}

// ── Route ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const action: Action = ALL_ACTIONS.includes(body.action as Action)
    ? (body.action as Action) : 'list';

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string; email?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const role = user?.role || '';
  const isParent = role === 'parent';
  const isHelper = role === 'helper';
  const actorName = str(user?.displayName, 60) || (isParent ? 'Parent' : 'Kaya');

  const famRef = db.collection('families').doc(familyId);
  const col = famRef.collection('sparks_treasures');
  const eventsCol = famRef.collection('sparks_treasure_events');
  const privateCol = famRef.collection('sparks_treasure_private');

  /** Resolve which child (if any) this caller IS. `childId` can legally
   *  be '' on a kid user doc, so fall back to a uid/email match on the
   *  children collection — never `kids[0]`. */
  const viewerChildId = await resolveViewerChildId(famRef, uid, user);
  const today = todayInTZ();

  // ── Reads ─────────────────────────────────────────────────────────

  if (action === 'list') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const access = await accessFor(famRef, { isParent, isHelper, uid, viewerChildId }, kidId);
    if (!access.canSee) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const snap = await col.where('kidId', '==', kidId).get();
    const treasures = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      // D5 · a sibling only ever sees promoted treasures. Parents,
      // helpers and the owner see everything.
      .filter((t) => access.isOwnerOrStaff
        || ['siblings', 'family'].includes(String((t as { visibility?: string }).visibility || 'private')))
      .sort((a, b) => Number((b as { createdAt?: number }).createdAt || 0)
        - Number((a as { createdAt?: number }).createdAt || 0));
    return NextResponse.json({ treasures });
  }

  if (action === 'family-board') {
    // D10 · the Lost & Found board is deliberately family-wide: finding
    // things is a household act. It carries names of THINGS, never
    // names of suspects.
    if (!isParent && !viewerChildId && !isHelper) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const snap = await col.where('status', '==', 'lost').get();
    const kids = await famRef.collection('children').get();
    const nameOf = new Map(kids.docs.map((d) => [d.id, String((d.data() as { name?: string }).name || 'Someone')]));
    nameOf.set(FAMILY_OWNER_ID, 'The family');
    const missing = snap.docs.map((d) => {
      const t = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        kidId: String(t.kidId || ''),
        kidName: nameOf.get(String(t.kidId || '')) || 'Someone',
        name: String(t.name || ''),
        emoji: String(t.emoji || '📦'),
        thumbUrl: t.thumbUrl ? String(t.thumbUrl) : undefined,
        lostSince: t.lostSince ? String(t.lostSince) : undefined,
        days: t.lostSince ? daysBetween(String(t.lostSince), today) : 0,
        lastSeenWhere: t.lastSeenWhere ? String(t.lastSeenWhere) : undefined,
        lastSeenOn: t.lastSeenOn ? String(t.lastSeenOn) : undefined,
        sightings: Array.isArray(t.sightings) ? t.sightings.slice(-4) : [],
      };
    }).sort((a, b) => b.days - a.days);

    // Recently found, so the board shows wins as well as worries.
    const foundSnap = await eventsCol.where('kind', '==', 'found').get();
    const found = foundSnap.docs
      .map((d) => d.data() as Record<string, unknown>)
      .filter((e) => daysBetween(String(e.on || today), today) <= 45)
      .sort((a, b) => Number(b.at || 0) - Number(a.at || 0))
      .slice(0, 6)
      .map((e) => ({ note: String(e.note || ''), on: String(e.on || '') }));

    return NextResponse.json({ missing, found });
  }

  if (action === 'today') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const access = await accessFor(famRef, { isParent, isHelper, uid, viewerChildId }, kidId);
    if (!access.canSee) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const snap = await col.where('kidId', '==', kidId).get();
    const rows = snap.docs.map((d) => d.data() as Record<string, unknown>);
    const live = rows.filter((t) => LIVE_ONLY.includes(String(t.status || 'kept')));
    const watch = live.filter((t) => t.watchlisted !== false);
    const missing = live.filter((t) => t.status === 'lost').length;
    const dueBack = live.filter((t) => {
      const b = t.borrow as { dueOn?: string } | undefined;
      return t.status === 'lent' && b?.dueOn && b.dueOn <= today;
    }).length;

    const settings = await readSettings(privateCol, kidId);
    const lastDoneOn = settings.lastDoneOn;
    const dueOn = nextCheckDue(lastDoneOn, settings.cadence, settings.dayOfWeek, today);
    const overdueDays = Math.max(0, daysBetween(dueOn, today));
    const due = settings.enabled && watch.length > 0 && today >= dueOn;

    // D8 · adrift = unaccounted across two or more consecutive checks.
    const adrift = live.filter((t) => Number(t.missedChecks || 0) >= 2).length;
    const careScore = live.length === 0 ? 100
      : Math.round(((live.length - adrift) / live.length) * 100);

    return NextResponse.json({
      date: today,
      live: live.length,
      check: {
        due,
        dueOn,
        overdueDays: due ? overdueDays : 0,
        items: watch.length,
        cadence: settings.cadence,
        enabled: settings.enabled,
        lastDoneOn,
      },
      missing,
      dueBack,
      careScore,
      // What the My Day / Workplan / nav badge count as "open" (D23).
      openCount: (due ? 1 : 0) + missing + dueBack,
    });
  }

  // ── ✨ The Wish Shelf → 🎁 Gift Brain (pathway 12) ────────────────
  //
  // The loop that closes the circle: wish → gift → treasure →
  // thank-you → care → hand-on. A child adds what they hope for; the
  // gateway MIRRORS it into the family's existing `giftIdeas` stash, so
  // Gift Brain surfaces it 14 days before their birthday and the gift
  // is something they actually wanted.
  //
  // The mirror only ever flows ONE way. Gift Brain is parents-only by
  // design (it must not spoil a surprise), so nothing a parent writes
  // there is ever readable from here.
  if (action === 'wish-list' || action === 'wish-add' || action === 'wish-remove') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const access = await accessFor(famRef, { isParent, isHelper, uid, viewerChildId }, kidId);
    // Only the owner and their parents — a sibling must never read a
    // wish list, and a helper has no business in it either.
    if (!isParent && viewerChildId !== kidId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    void access;
    const wishesCol = famRef.collection('sparks_wishes');

    if (action === 'wish-add') {
      const text = str(body.text, 160);
      if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
      const existing = await wishesCol.where('kidId', '==', kidId).get();
      if (existing.size >= 30) {
        return NextResponse.json({ error: 'wish-shelf-full' }, { status: 409 });
      }
      const ref = await wishesCol.add({
        kidId, text, at: Date.now(), byName: actorName, on: today,
      });
      // Mirror into Gift Brain so the parent sees it at birthday time.
      const kidSnap = await famRef.collection('children').doc(kidId).get();
      const kidNameStr = str((kidSnap.data() as { name?: string } | undefined)?.name, 60) || 'Child';
      await famRef.collection('giftIdeas').add({
        familyId,
        personName: kidNameStr,
        linkedChildId: kidId,
        text,
        createdByUid: uid,
        createdByName: actorName,
        createdAt: Date.now(),
        // So a parent can tell at a glance this came from the child.
        source: 'wish_shelf',
        wishId: ref.id,
      }).catch(() => { /* the wish is saved; the mirror can be retried */ });
      return NextResponse.json({ id: ref.id });
    }

    if (action === 'wish-remove') {
      const wishId = str(body.wishId, 80);
      if (!wishId) return NextResponse.json({ error: 'bad-wish' }, { status: 400 });
      const wRef = wishesCol.doc(wishId);
      const wSnap = await wRef.get();
      if (!wSnap.exists) return NextResponse.json({ ok: true });
      if (String((wSnap.data() as { kidId?: string }).kidId) !== kidId) {
        return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      }
      await wRef.delete();
      const mirrored = await famRef.collection('giftIdeas').where('wishId', '==', wishId).get();
      for (const d of mirrored.docs) await d.ref.delete().catch(() => {});
      return NextResponse.json({ ok: true });
    }

    const snap = await wishesCol.where('kidId', '==', kidId).get();
    const wishes = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => Number((b as { at?: number }).at || 0) - Number((a as { at?: number }).at || 0));
    return NextResponse.json({ wishes });
  }

  if (action === 'roll-up') {
    // D5 · the parent's cross-kid view. It carries BEHAVIOUR (Keeper
    // Score, what's open) and — for parents only — value. It never
    // compares children on count or on value; the numbers sit on their
    // own rows and are never ranked.
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const kidsSnap = await famRef.collection('children').get();
    const rows: Array<Record<string, unknown>> = [];
    let warrantyDue: Array<Record<string, unknown>> = [];
    let thankYous: Array<Record<string, unknown>> = [];

    for (const kidDoc of kidsSnap.docs) {
      const kidId = kidDoc.id;
      const kid = kidDoc.data() as { name?: string; avatarEmoji?: string };
      const tSnap = await col.where('kidId', '==', kidId).get();
      if (tSnap.empty) continue;
      const all: Array<Record<string, unknown> & { id: string }> =
        tSnap.docs.map((d) => ({ ...(d.data() as Record<string, unknown>), id: d.id }));
      const live = all.filter((t) => LIVE_ONLY.includes(String(t.status || 'kept')));
      const adrift = live.filter((t) => Number(t.missedChecks || 0) >= 2).length;
      const settings = await readSettings(privateCol, kidId);
      const dueOn = nextCheckDue(settings.lastDoneOn, settings.cadence, settings.dayOfWeek, today);
      const watch = live.filter((t) => t.watchlisted !== false);

      // D4 · values, parents only. Summed per kid so a parent can see
      // the shape of what they're replacing — never rendered anywhere a
      // child can reach.
      let costCents = 0;
      let nowCents = 0;
      let currency = 'TZS';
      for (const t of all) {
        const p = await privateCol.doc(String(t.id)).get();
        if (!p.exists) continue;
        const pv = p.data() as { valueCents?: number; currency?: string; purchasedOn?: string; warrantyEndsOn?: string };
        const cents = Number(pv.valueCents || 0);
        if (pv.currency) currency = pv.currency;
        if (cents > 0 && !ENDED.includes(String(t.status))) {
          costCents += cents;
          const from = String(pv.purchasedOn || t.givenOn || today);
          nowCents += Math.round(cents * residual(String(t.categoryId || 'other'), yearsSince(from, today)));
        }
        // 🧾 the pathway that pays for the module for the PARENT — one
        // honoured warranty repays a year of subscription.
        if (pv.warrantyEndsOn && daysBetween(today, String(pv.warrantyEndsOn)) <= 60
            && daysBetween(today, String(pv.warrantyEndsOn)) >= 0) {
          warrantyDue.push({
            treasureId: t.id, kidId, kidName: kid.name || '',
            name: String(t.name || ''), endsOn: String(pv.warrantyEndsOn),
            days: daysBetween(today, String(pv.warrantyEndsOn)),
          });
        }
      }

      // F17 · thank-yous a child composed and a parent still has to send.
      for (const t of all) {
        const ty = t.thankYou as { status?: string; text?: string; kind?: string } | undefined;
        if (ty && ty.status && ty.status !== 'sent') {
          thankYous.push({
            treasureId: t.id, kidId, kidName: kid.name || '',
            name: String(t.name || ''), giverName: String(t.giverName || ''),
            kind: String(ty.kind || 'text'), text: String(ty.text || ''),
          });
        }
      }

      rows.push({
        kidId,
        name: kid.name || 'Child',
        emoji: kid.avatarEmoji || '🧒',
        live: live.length,
        careScore: live.length === 0 ? 100 : Math.round(((live.length - adrift) / live.length) * 100),
        missing: live.filter((t) => t.status === 'lost').length,
        lent: live.filter((t) => t.status === 'lent').length,
        ownedIt: all.filter((t) => t.ownedIt).length,
        checkDueOn: dueOn,
        checkOverdueDays: Math.max(0, daysBetween(dueOn, today)),
        checkItems: watch.length,
        cadence: settings.cadence,
        costCents,
        nowCents,
        currency,
      });
    }

    warrantyDue = warrantyDue.sort((a, b) => Number(a.days) - Number(b.days)).slice(0, 6);
    thankYous = thankYous.slice(0, 10);
    return NextResponse.json({ kids: rows, warrantyDue, thankYous });
  }

  if (action === 'people') {
    // D17 · "Kaya already knows your people." The giver picker is served
    // from here so a child never types anyone's contact details — and so
    // the client never needs read access to `users`.
    const kidId = str(body.kidId, 80);
    const [parentsSnap, kidsSnap] = await Promise.all([
      db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get(),
      famRef.collection('children').get(),
    ]);
    const people = [
      ...parentsSnap.docs.map((d) => {
        const u = d.data() as { displayName?: string; avatarEmoji?: string };
        return {
          key: `p:${d.id}`, label: str(u.displayName, 60) || 'Parent',
          emoji: str(u.avatarEmoji, 8) || '🧑', kind: 'family', uid: d.id,
        };
      }),
      ...kidsSnap.docs.filter((d) => d.id !== kidId).map((d) => {
        const c = d.data() as { name?: string; avatarEmoji?: string };
        return {
          key: `c:${d.id}`, label: str(c.name, 60) || 'Brother or sister',
          emoji: str(c.avatarEmoji, 8) || '🧒', kind: 'family', childId: d.id,
        };
      }),
    ];

    // Anyone who has given this family something before — so Grandma
    // Joyce is typed exactly once, ever.
    const seen = new Set<string>();
    const priorSnap = await col.where('giverKind', '==', 'person').get();
    const priors = priorSnap.docs
      .map((d) => str((d.data() as { giverName?: string }).giverName, 60))
      .filter((n) => {
        const k = n.toLowerCase();
        if (!n || seen.has(k)) return false;
        seen.add(k); return true;
      })
      .slice(0, 8)
      .map((n) => ({ key: `n:${n}`, label: n, emoji: '💛', kind: 'person' }));

    return NextResponse.json({ people: [...people, ...priors] });
  }

  if (action === 'settings-get') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const access = await accessFor(famRef, { isParent, isHelper, uid, viewerChildId }, kidId);
    if (!access.canSee) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const s = await readSettings(privateCol, kidId);
    return NextResponse.json({ settings: s });
  }

  if (action === 'settings-set') {
    // D23 · the cadence is the PARENT's call.
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const patch = (body.settings ?? {}) as Record<string, unknown>;
    const current = await readSettings(privateCol, kidId);
    const next: Record<string, unknown> = { kidId };
    next.cadence = CADENCE_DAYS[str(patch.cadence, 20)] ? str(patch.cadence, 20) : current.cadence;
    next.dayOfWeek = patch.dayOfWeek === undefined ? current.dayOfWeek : num(patch.dayOfWeek, 0, 6, 0);
    next.hour = patch.hour === undefined ? current.hour : num(patch.hour, 0, 23, 9);
    next.enabled = patch.enabled === undefined ? current.enabled : patch.enabled !== false;
    next.escalatePushAfterDays = patch.escalatePushAfterDays === undefined
      ? current.escalatePushAfterDays : num(patch.escalatePushAfterDays, 0, 14, 1);
    next.escalateEmailAfterDays = patch.escalateEmailAfterDays === undefined
      ? current.escalateEmailAfterDays : num(patch.escalateEmailAfterDays, 0, 30, 3);
    const extras = emailList(patch.extraEmails);
    if (extras.length) next.extraEmails = extras;
    if (current.lastDoneOn) next.lastDoneOn = current.lastDoneOn;
    await privateCol.doc(`settings__${kidId}`).set(next, { merge: true });
    return NextResponse.json({ ok: true });
  }

  // ── Keeper Check (D9 · D23) — kid-level, not treasure-level ───────

  if (action === 'check-submit') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const access = await accessFor(famRef, { isParent, isHelper, uid, viewerChildId }, kidId);
    // D18 · a helper may run the check; a sibling never can.
    if (!isParent && viewerChildId !== kidId && !access.helperMayAct) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    return submitCheck({
      db, col, eventsCol, privateCol,
      kidId, results: body.results, today, actorName,
      isOwner: viewerChildId === kidId,
    });
  }

  // ── Create ────────────────────────────────────────────────────────

  if (action === 'create') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    // D22 · a parent may register for any kid; a kid registers only for
    // themselves. A helper never creates (D18).
    if (!isParent && viewerChildId !== kidId) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const kidSnap = await famRef.collection('children').doc(kidId).get();
    if (!kidSnap.exists) return NextResponse.json({ error: 'no-such-kid' }, { status: 404 });

    const name = str(body.name, 80);
    if (!name) return NextResponse.json({ error: 'bad-name' }, { status: 400 });

    const now = Date.now();
    // Firestore (Admin) rejects `undefined` — only set what exists.
    const doc: Record<string, unknown> = {
      kidId,
      name,
      categoryId: str(body.categoryId, 30) || 'other',
      emoji: str(body.emoji, 8) || '📦',
      giverKind: giverKind(body.giverKind),
      giverName: str(body.giverName, 60),
      givenOn: isDate(body.givenOn) ? body.givenOn : today,
      status: 'kept',
      ownership: ownership(body.ownership),
      visibility: visibility(body.visibility),
      watchlisted: body.watchlisted !== false,
      travels: body.travels === true,
      missedChecks: 0,
      createdAt: now,
      createdBy: uid,
      createdByName: actorName,
    };
    const photoUrl = str(body.photoUrl, 600);
    if (photoUrl) doc.photoUrl = photoUrl;
    const thumbUrl = str(body.thumbUrl, 600);
    if (thumbUrl) doc.thumbUrl = thumbUrl;
    const photoId = str(body.photoId, 80);
    if (photoId) doc.photoId = photoId;
    const occasion = str(body.occasion, 80);
    if (occasion) doc.occasion = occasion;
    const story = str(body.story, 1200);
    if (story) doc.story = story;
    const giverUid = str(body.giverUid, 80);
    if (giverUid) doc.giverUid = giverUid;
    const giverChildId = str(body.giverChildId, 80);
    if (giverChildId) doc.giverChildId = giverChildId;
    const achId = str(body.achievementItemId, 80);
    if (achId) doc.achievementItemId = achId;

    const ref = await col.add(doc);
    await logEvent(eventsCol, {
      treasureId: ref.id, kidId, kind: 'registered', on: today, at: now,
      byName: actorName,
      note: doc.giverKind === 'self'
        ? `${name} — bought it themselves`
        : doc.giverName ? `${name} — from ${doc.giverName}` : name,
    });
    return NextResponse.json({ id: ref.id });
  }

  // ── Everything below operates on a single treasure ────────────────

  const treasureId = str(body.treasureId, 80);
  if (!treasureId) return NextResponse.json({ error: 'bad-treasure' }, { status: 400 });

  const ref = col.doc(treasureId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const t = snap.data() as Record<string, unknown>;
  const kidId = String(t.kidId || '');
  const access = await accessFor(famRef, { isParent, isHelper, uid, viewerChildId }, kidId);
  if (!access.canSee) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const isOwner = viewerChildId === kidId;
  const vis = String(t.visibility || 'private');
  const siblingAllowed = ['siblings', 'family'].includes(vis);
  if (!access.isOwnerOrStaff && !siblingAllowed) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  if (action === 'get') {
    const evSnap = await eventsCol.where('treasureId', '==', treasureId).get();
    const events = evSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => Number((a as { at?: number }).at || 0) - Number((b as { at?: number }).at || 0));

    const out: Record<string, unknown> = {
      treasure: { id: snap.id, ...t },
      events,
    };
    // D4/F14 · the value sub-document is returned to PARENTS ONLY. A
    // kid, a sibling and a helper never receive the field at all — not
    // redacted client-side, simply never sent.
    const pSnap = await privateCol.doc(treasureId).get();
    const pv = (pSnap.exists ? pSnap.data() : {}) as {
      valueCents?: number; currency?: string; purchasedOn?: string;
    };
    if (isParent) {
      if (pSnap.exists) out.private = { treasureId, ...(pSnap.data() as Record<string, unknown>) };
      // R5 · the falling number is parent-only. A child reading "worth
      // less now" hears "getting worse".
      if (Number(pv.valueCents) > 0) {
        const from = String(pv.purchasedOn || t.givenOn || today);
        out.worthNowCents = Math.round(
          Number(pv.valueCents) * residual(String(t.categoryId || 'other'), yearsSince(from, today)),
        );
      }
    }

    // D4 · what the CHILD gets instead: the same value expressed in the
    // effort it actually took. This is the whole educational move — a
    // 9-year-old cannot act on "TZS 420,000" but can act on "about six
    // weeks of chores" — and it carries no money figure at all, so it is
    // safe on any screen.
    if (Number(pv.valueCents) > 0) {
      const famSnap = await famRef.get();
      const hive = (famSnap.data() as { hiveConfig?: { hpToHoneyRate?: number; honeyToCashRate?: number } } | undefined)?.hiveConfig;
      const points = effortPointsFor(Number(pv.valueCents), String(pv.currency || 'TZS'), hive);
      const kidSnap = await famRef.collection('children').doc(kidId).get();
      const kidData = (kidSnap.exists ? kidSnap.data() : {}) as { lifetimePoints?: number; totalPoints?: number; joinedOn?: string };
      const lifetime = Math.max(Number(kidData.lifetimePoints || 0), Number(kidData.totalPoints || 0));
      const weeksInKaya = kidData.joinedOn
        ? Math.max(1, daysBetween(String(kidData.joinedOn), today) / 7)
        : 0;
      // Only claim a "weeks of chores" figure once there is enough of
      // their own history to make it true. Otherwise: points only.
      const pointsPerWeek = weeksInKaya >= 3 && lifetime > 0 ? lifetime / weeksInKaya : 0;
      out.effort = { points, pointsPerWeek: Math.round(pointsPerWeek) };
    }
    return NextResponse.json(out);
  }

  // Writes below. A sibling may do exactly one thing: add a sighting to
  // something that is missing (D10) — helping to find it is the only
  // interaction that makes sense across children.
  const canWriteOwn = isParent || isOwner;

  if (action === 'sighting') {
    const where = str(body.where, 120);
    if (!where) return NextResponse.json({ error: 'bad-where' }, { status: 400 });
    if (String(t.status) !== 'lost') {
      return NextResponse.json({ error: 'not-missing' }, { status: 409 });
    }
    const sighting = { where, on: today, byName: actorName, at: Date.now() };
    await ref.update({
      sightings: FieldValue.arrayUnion(sighting),
      updatedAt: Date.now(),
      updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'sighting', on: today, at: Date.now(),
      byName: actorName, note: `Seen: ${where}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'found') {
    // D18 · a helper may mark found — they are often the person who
    // actually finds the shoe.
    if (!canWriteOwn && !access.helperMayAct) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const where = str(body.where, 120);
    const lostSince = str(t.lostSince, 20);
    const days = lostSince ? daysBetween(lostSince, today) : 0;
    const patch: Record<string, unknown> = {
      status: 'kept',
      missedChecks: 0,
      lastCheckResult: 'have',
      lostSince: FieldValue.delete(),
      updatedAt: Date.now(),
      updatedByName: actorName,
    };
    if (where) patch.lastSeenWhere = where;
    await ref.update(patch);
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'found', on: today, at: Date.now(), byName: actorName,
      note: `${String(t.name || 'It')} — found${days > 0 ? ` after ${days} day${days === 1 ? '' : 's'}` : ''}${where ? ` (${where})` : ''}`,
    });
    // R1 · the alert ladder is closed by appending to the SAME entry,
    // never by sending a second alarming message. The append happens in
    // the reminder engine (T4/T7) which reads this event.
    return NextResponse.json({ ok: true, days });
  }

  // Every remaining action mutates the treasure itself. Only a parent or
  // the owner may do any of them — siblings and helpers stop here (D5 ·
  // D18); the two things they legitimately do (sighting, found) are
  // handled above.
  if (!canWriteOwn) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (action === 'update') {
    const patchIn = (body.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: Date.now(), updatedByName: actorName };
    const name = str(patchIn.name, 80);
    if (name) patch.name = name;
    if (patchIn.categoryId !== undefined) patch.categoryId = str(patchIn.categoryId, 30) || 'other';
    if (patchIn.emoji !== undefined) patch.emoji = str(patchIn.emoji, 8) || '📦';
    if (patchIn.occasion !== undefined) patch.occasion = str(patchIn.occasion, 80);
    if (patchIn.giverName !== undefined) patch.giverName = str(patchIn.giverName, 60);
    if (patchIn.giverKind !== undefined) patch.giverKind = giverKind(patchIn.giverKind);
    if (isDate(patchIn.givenOn)) patch.givenOn = patchIn.givenOn;
    if (patchIn.visibility !== undefined) patch.visibility = visibility(patchIn.visibility);
    if (patchIn.ownership !== undefined) patch.ownership = ownership(patchIn.ownership);
    if (patchIn.watchlisted !== undefined) patch.watchlisted = patchIn.watchlisted !== false;
    if (patchIn.travels !== undefined) patch.travels = patchIn.travels === true;
    const photoUrl = str(patchIn.photoUrl, 600);
    if (photoUrl) patch.photoUrl = photoUrl;
    const thumbUrl = str(patchIn.thumbUrl, 600);
    if (thumbUrl) patch.thumbUrl = thumbUrl;
    const photoId = str(patchIn.photoId, 80);
    if (photoId) patch.photoId = photoId;
    await ref.update(patch);
    if (patchIn.visibility !== undefined && patch.visibility !== 'private') {
      await logEvent(eventsCol, {
        treasureId, kidId, kind: 'shared', on: today, at: Date.now(), byName: actorName,
        note: patch.visibility === 'family' ? 'Shared with the family' : 'Shared with brothers & sisters',
      });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'story-set') {
    const story = str(body.story, 1200);
    await ref.update({ story, updatedAt: Date.now(), updatedByName: actorName });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'story', on: today, at: Date.now(),
      byName: actorName, note: 'Wrote why it matters',
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'delete') {
    // D6 · the ONLY true deletion. Parents only, mis-entries only, and
    // only inside the window — because the record is the whole point.
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const age = Date.now() - Number(t.createdAt || 0);
    if (age > HARD_DELETE_WINDOW_MS) {
      return NextResponse.json({ error: 'too-late-retire-instead' }, { status: 409 });
    }
    const evSnap = await eventsCol.where('treasureId', '==', treasureId).get();
    const batch = db.batch();
    evSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(privateCol.doc(treasureId));
    batch.delete(ref);
    await batch.commit();
    return NextResponse.json({ ok: true });
  }

  // ── Condition (D7) ────────────────────────────────────────────────

  if (action === 'condition') {
    const status = str(body.status, 20);
    if (!['broken', 'repaired', 'lost', 'kept'].includes(status)) {
      return NextResponse.json({ error: 'bad-status' }, { status: 400 });
    }
    const note = str(body.note, 400);
    const now = Date.now();
    // D7 · the child reporting their OWN loss or break is the behaviour
    // we want, so it is the behaviour we credit. Nothing is ever
    // deducted for the accident itself.
    const selfReported = isOwner && (status === 'broken' || status === 'lost');
    const patch: Record<string, unknown> = {
      status, updatedAt: now, updatedByName: actorName,
    };
    if (status === 'lost') {
      patch.lostSince = today;
      const where = str(body.lastSeenWhere, 120);
      if (where) { patch.lastSeenWhere = where; patch.lastSeenOn = today; }
    }
    if (status === 'kept' || status === 'repaired') {
      patch.lostSince = FieldValue.delete();
      patch.missedChecks = 0;
    }
    if (selfReported) patch.ownedIt = true;
    await ref.update(patch);
    await logEvent(eventsCol, {
      treasureId, kidId,
      kind: status === 'kept' ? 'found' : (status as 'broken' | 'repaired' | 'lost'),
      on: today, at: now, byName: actorName,
      note: note || undefined,
      ownedIt: selfReported || undefined,
    });
    return NextResponse.json({ ok: true, ownedIt: selfReported });
  }

  // ── Borrow & Return (D11) ─────────────────────────────────────────

  if (action === 'lend') {
    const toName = str(body.toName, 60);
    const dueOn = isDate(body.dueOn) ? body.dueOn : addDays(today, 7);
    if (!toName) return NextResponse.json({ error: 'bad-borrower' }, { status: 400 });
    if (ENDED.includes(String(t.status))) {
      return NextResponse.json({ error: 'already-ended' }, { status: 409 });
    }
    const borrow: Record<string, unknown> = { toName, since: today, dueOn };
    const toChildId = str(body.toChildId, 80);
    if (toChildId) borrow.toChildId = toChildId;
    const lending = (t.lending ?? {}) as { out?: number; backOnTime?: number; backLate?: number };
    await ref.update({
      status: 'lent',
      borrow,
      lending: {
        out: Number(lending.out || 0) + 1,
        backOnTime: Number(lending.backOnTime || 0),
        backLate: Number(lending.backLate || 0),
      },
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'lent', on: today, at: Date.now(), byName: actorName,
      note: `Lent to ${toName} · back by ${dueOn}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'lend-extend') {
    const dueOn = isDate(body.dueOn) ? body.dueOn : addDays(today, 7);
    const borrow = (t.borrow ?? {}) as Record<string, unknown>;
    if (!borrow.toName) return NextResponse.json({ error: 'not-lent' }, { status: 409 });
    await ref.update({
      borrow: { ...borrow, dueOn },
      updatedAt: Date.now(), updatedByName: actorName,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'return') {
    const borrow = (t.borrow ?? {}) as { dueOn?: string; toName?: string };
    if (String(t.status) !== 'lent') return NextResponse.json({ error: 'not-lent' }, { status: 409 });
    const late = !!borrow.dueOn && today > borrow.dueOn;
    const lending = (t.lending ?? {}) as { out?: number; backOnTime?: number; backLate?: number };
    await ref.update({
      status: 'kept',
      borrow: FieldValue.delete(),
      lending: {
        out: Math.max(0, Number(lending.out || 1) - 1),
        backOnTime: Number(lending.backOnTime || 0) + (late ? 0 : 1),
        backLate: Number(lending.backLate || 0) + (late ? 1 : 0),
      },
      lastCheckResult: 'have',
      missedChecks: 0,
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'returned', on: today, at: Date.now(), byName: actorName,
      note: `Back from ${borrow.toName || 'a borrower'}${late ? ' (late)' : ''}`,
    });
    return NextResponse.json({ ok: true, late });
  }

  // ── Values, parents only (D4) ─────────────────────────────────────

  if (action === 'private-set') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const patchIn = (body.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { treasureId, kidId };
    if (patchIn.valueCents !== undefined) patch.valueCents = num(patchIn.valueCents, 0, 1e11, 0);
    if (patchIn.currency !== undefined) patch.currency = str(patchIn.currency, 8) || 'TZS';
    if (isDate(patchIn.purchasedOn)) patch.purchasedOn = patchIn.purchasedOn;
    if (patchIn.serial !== undefined) patch.serial = str(patchIn.serial, 80);
    if (patchIn.note !== undefined) patch.note = str(patchIn.note, 600);
    if (patchIn.warrantyMonths !== undefined) {
      const months = num(patchIn.warrantyMonths, 0, 120, 0);
      patch.warrantyMonths = months;
      const from = isDate(patchIn.purchasedOn) ? patchIn.purchasedOn : String(t.givenOn || today);
      if (months > 0) patch.warrantyEndsOn = addDays(from, Math.round(months * 30.44));
    }
    if (Array.isArray(patchIn.receiptUrls)) {
      patch.receiptUrls = patchIn.receiptUrls
        .map((u) => str(u, 600)).filter(Boolean).slice(0, 6);
    }
    if (patchIn.vaultAssetId !== undefined) patch.vaultAssetId = str(patchIn.vaultAssetId, 80);
    await privateCol.doc(treasureId).set(patch, { merge: true });
    await logEvent(eventsCol, {
      treasureId, kidId,
      kind: patchIn.vaultAssetId ? 'vault_promoted' : 'value_set',
      on: today, at: Date.now(), byName: actorName,
      // The note never carries the number — events are readable by the
      // child, and the value never is (D4).
      note: patchIn.vaultAssetId ? 'Added to the family Vault' : 'Value recorded',
    });
    return NextResponse.json({ ok: true });
  }

  // ── The Giver's Thread (D17) ──────────────────────────────────────

  if (action === 'thankyou-set') {
    const kind = str(body.kind, 10) === 'audio' ? 'audio' : 'text';
    const thankYou: Record<string, unknown> = { kind, status: 'draft', at: Date.now() };
    const text = str(body.text, 600);
    if (text) thankYou.text = text;
    const audioUrl = str(body.audioUrl, 600);
    if (audioUrl) thankYou.audioUrl = audioUrl;
    if (!text && !audioUrl) return NextResponse.json({ error: 'empty' }, { status: 400 });
    await ref.update({ thankYou, updatedAt: Date.now(), updatedByName: actorName });
    return NextResponse.json({ ok: true });
  }

  if (action === 'thankyou-send') {
    // F17 · the child composes, the PARENT sends. Kaya never asks a
    // child for anyone's email address and never sends on their behalf.
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const thankYou = (t.thankYou ?? {}) as Record<string, unknown>;
    if (!thankYou.kind) return NextResponse.json({ error: 'nothing-to-send' }, { status: 409 });
    await ref.update({
      thankYou: { ...thankYou, status: 'sent', sentAt: Date.now() },
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'thanked', on: today, at: Date.now(), byName: actorName,
      note: `Thank-you sent to ${String(t.giverName || 'the giver')}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'reply-add') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const text = str(body.text, 600);
    if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
    const byName = str(body.byName, 60) || String(t.giverName || 'They');
    await ref.update({
      giverReply: { text, at: Date.now(), byName },
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'reply', on: today, at: Date.now(), byName,
      note: `${byName} wrote back`,
    });
    return NextResponse.json({ ok: true });
  }

  // ── Endings (D6 · D12 · D13) ──────────────────────────────────────

  if (action === 'end') {
    const how = str(body.how, 20);
    if (!ENDED.includes(how)) return NextResponse.json({ error: 'bad-ending' }, { status: 400 });
    // D18 · a helper never hands a treasure on.
    if (!isParent && !isOwner) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const now = Date.now();
    const note = str(body.note, 400);
    const patch: Record<string, unknown> = {
      status: how, endedOn: today, updatedAt: now, updatedByName: actorName,
    };
    if (note) patch.endedNote = note;
    const saleRef = str(body.saleRef, 120);
    if (saleRef) patch.saleRef = saleRef;

    let newTreasureId: string | undefined;
    const toChildId = str(body.toChildId, 80);
    if (how === 'handed_on' && toChildId) {
      // D12 · the OBJECT's history travels; the person's Care Score does
      // not. The new keeper starts neutral, and the giver thread comes
      // with it so the original gift is still honoured.
      const kidSnap = await famRef.collection('children').doc(toChildId).get();
      if (!kidSnap.exists) return NextResponse.json({ error: 'no-such-kid' }, { status: 404 });
      const carried: Record<string, unknown> = {
        kidId: toChildId,
        name: t.name,
        categoryId: t.categoryId,
        emoji: t.emoji,
        giverKind: t.giverKind,
        giverName: t.giverName,
        givenOn: today,
        status: 'kept',
        ownership: t.ownership || 'kid',
        visibility: 'private',
        watchlisted: true,
        travels: t.travels === true,
        missedChecks: 0,
        handedFromTreasureId: treasureId,
        handedFromKidId: kidId,
        occasion: `Handed on${t.giverName ? ` — first given by ${String(t.giverName)}` : ''}`,
        createdAt: now,
        createdBy: uid,
        createdByName: actorName,
      };
      if (t.photoUrl) carried.photoUrl = t.photoUrl;
      if (t.thumbUrl) carried.thumbUrl = t.thumbUrl;
      if (t.story) carried.story = t.story;
      const created = await col.add(carried);
      newTreasureId = created.id;
      patch.handedToChildId = toChildId;
      patch.handedToTreasureId = created.id;

      await logEvent(eventsCol, {
        treasureId: created.id, kidId: toChildId, kind: 'registered',
        on: today, at: now, byName: actorName,
        note: `${String(t.name || 'It')} — handed on, and its whole story came with it`,
      });
    }

    await ref.update(patch);
    await logEvent(eventsCol, {
      treasureId, kidId, kind: how as 'handed_on' | 'donated' | 'sold' | 'outgrown' | 'retired',
      on: today, at: now, byName: actorName, note: note || undefined,
    });
    return NextResponse.json({ ok: true, newTreasureId });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}

// ── Keeper Check submission (D7 · D8 · D9 · D23) ────────────────────

interface SubmitArgs {
  db: Firestore;
  col: FirebaseFirestore.CollectionReference;
  eventsCol: FirebaseFirestore.CollectionReference;
  privateCol: FirebaseFirestore.CollectionReference;
  kidId: string;
  results: unknown;
  today: string;
  actorName: string;
  isOwner: boolean;
}

async function submitCheck(a: SubmitArgs): Promise<NextResponse> {
  const rows = Array.isArray(a.results) ? a.results : [];
  if (!rows.length) return NextResponse.json({ error: 'empty-check' }, { status: 400 });

  const batch = a.db.batch();
  let ownedIt = 0;
  let missing = 0;
  const now = Date.now();

  for (const raw of rows.slice(0, 200)) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const id = str(r.treasureId, 80);
    const result = checkResult(r.result);
    if (!id || !result) continue;

    const ref = a.col.doc(id);
    const snap = await ref.get();
    if (!snap.exists) continue;
    const t = snap.data() as Record<string, unknown>;
    if (String(t.kidId) !== a.kidId) continue;

    const patch: Record<string, unknown> = {
      lastCheckedOn: a.today,
      lastCheckResult: result,
      updatedAt: now,
      updatedByName: a.actorName,
    };

    if (result === 'have') {
      patch.missedChecks = 0;
      if (String(t.status) === 'lost') {
        patch.status = 'kept';
        patch.lostSince = FieldValue.delete();
      }
    } else if (result === 'fix') {
      // R3 · breakage is NEUTRAL. It never moves the Care Score and it
      // is never described as a failure.
      patch.missedChecks = 0;
      patch.status = 'broken';
      if (a.isOwner) { patch.ownedIt = true; ownedIt += 1; }
    } else {
      missing += 1;
      patch.status = 'lost';
      patch.missedChecks = Number(t.missedChecks || 0) + 1;
      if (!t.lostSince) patch.lostSince = a.today;
      const where = str(r.lastSeenWhere, 120);
      if (where) { patch.lastSeenWhere = where; patch.lastSeenOn = a.today; }
      // D7 · reporting it yourself, at the check, inside the window is
      // exactly the behaviour we want — so it earns 🫱 Owned It.
      if (a.isOwner) {
        const since = str(t.lostSince, 20);
        if (!since || daysBetween(since, a.today) <= OWNED_IT_WINDOW_DAYS) {
          patch.ownedIt = true; ownedIt += 1;
        }
      }
    }
    batch.update(ref, patch);

    if (result !== 'have') {
      const evRef = a.eventsCol.doc();
      batch.set(evRef, {
        treasureId: id, kidId: a.kidId,
        kind: result === 'fix' ? 'broken' : 'lost',
        on: a.today, at: now, byName: a.actorName,
        note: result === 'fix' ? 'Needs fixing (found at the Keeper Check)' : 'Missing (reported at the Keeper Check)',
        ...(a.isOwner ? { ownedIt: true } : {}),
      });
    }
  }

  // One check event for the sweep itself — the thing the streak, the
  // parent roll-up and the D23 escalation ladder all read.
  const checkRef = a.eventsCol.doc();
  batch.set(checkRef, {
    treasureId: `check__${a.kidId}`, kidId: a.kidId, kind: 'check',
    on: a.today, at: now, byName: a.actorName,
    note: `Keeper Check · ${rows.length} things${missing ? ` · ${missing} to find` : ' · all accounted for'}`,
  });

  // D23 · completing the check at ANY rung closes the escalation ladder.
  batch.set(a.privateCol.doc(`settings__${a.kidId}`), {
    kidId: a.kidId, lastDoneOn: a.today, escalationStage: 0,
  }, { merge: true });

  await batch.commit();
  return NextResponse.json({ ok: true, ownedIt, missing });
}

// ── Helpers ─────────────────────────────────────────────────────────

async function logEvent(
  eventsCol: FirebaseFirestore.CollectionReference,
  ev: Record<string, unknown>,
): Promise<void> {
  // Firestore (Admin) rejects `undefined` — strip before writing.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) if (v !== undefined) clean[k] = v;
  await eventsCol.add(clean);
}

interface SettingsOut {
  cadence: string; dayOfWeek: number; hour: number; enabled: boolean;
  escalatePushAfterDays: number; escalateEmailAfterDays: number;
  extraEmails?: string[]; lastDoneOn?: string; escalationStage?: number;
}

async function readSettings(
  privateCol: FirebaseFirestore.CollectionReference, kidId: string,
): Promise<SettingsOut> {
  const snap = await privateCol.doc(`settings__${kidId}`).get();
  const s = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  return {
    cadence: CADENCE_DAYS[String(s.cadence)] ? String(s.cadence) : 'fortnightly',
    dayOfWeek: Number.isFinite(Number(s.dayOfWeek)) ? Number(s.dayOfWeek) : 0,
    hour: Number.isFinite(Number(s.hour)) ? Number(s.hour) : 9,
    enabled: s.enabled !== false,
    escalatePushAfterDays: Number.isFinite(Number(s.escalatePushAfterDays))
      ? Number(s.escalatePushAfterDays) : 1,
    escalateEmailAfterDays: Number.isFinite(Number(s.escalateEmailAfterDays))
      ? Number(s.escalateEmailAfterDays) : 3,
    ...(Array.isArray(s.extraEmails) ? { extraEmails: s.extraEmails as string[] } : {}),
    ...(s.lastDoneOn ? { lastDoneOn: String(s.lastDoneOn) } : {}),
    ...(s.escalationStage !== undefined ? { escalationStage: Number(s.escalationStage) } : {}),
  };
}

async function resolveViewerChildId(
  famRef: FirebaseFirestore.DocumentReference,
  uid: string,
  user: { role?: string; childId?: string; email?: string } | undefined,
): Promise<string> {
  if (user?.role !== 'kid') return '';
  if (user.childId) return user.childId;
  const kids = await famRef.collection('children').get();
  const email = (user.email || '').toLowerCase();
  for (const d of kids.docs) {
    const c = d.data() as { uid?: string; email?: string };
    if (c.uid && c.uid === uid) return d.id;
    if (email && c.email && c.email.toLowerCase() === email) return d.id;
  }
  return '';
}

interface Access { canSee: boolean; isOwnerOrStaff: boolean; helperMayAct: boolean }

/** D5 · who may look at this kid's treasures at all. Sibling filtering
 *  by visibility happens on the rows themselves — a sibling can reach
 *  the endpoint, but only ever receives promoted items. */
async function accessFor(
  famRef: FirebaseFirestore.DocumentReference,
  who: { isParent: boolean; isHelper: boolean; uid: string; viewerChildId: string },
  kidId: string,
): Promise<Access> {
  if (who.isParent) return { canSee: true, isOwnerOrStaff: true, helperMayAct: false };
  if (who.viewerChildId === kidId) {
    return { canSee: true, isOwnerOrStaff: true, helperMayAct: false };
  }
  if (who.viewerChildId) {
    // A sibling. Rows are filtered to promoted ones after this.
    return { canSee: true, isOwnerOrStaff: false, helperMayAct: false };
  }
  if (who.isHelper) {
    const act = await helperCanAct(famRef, who.uid, kidId);
    return { canSee: act, isOwnerOrStaff: act, helperMayAct: act };
  }
  return { canSee: false, isOwnerOrStaff: false, helperMayAct: false };
}

/** D18 · a helper may act on a kid's treasures when they hold the Sparks
 *  act-grant AND the kid is in their `kidIds`. They can find things and
 *  run a check; they never see values, never create, never hand on. */
async function helperCanAct(
  famRef: FirebaseFirestore.DocumentReference,
  uid: string,
  kidId: string,
): Promise<boolean> {
  const snap = await famRef.collection('helpers').doc(uid).get();
  if (!snap.exists) return false;
  const link = snap.data() as {
    status?: string; kidIds?: string[];
    modules?: string[]; moduleAccess?: Record<string, { view?: boolean; act?: boolean }>;
  };
  if (link.status !== 'active') return false;
  if (!Array.isArray(link.kidIds) || !link.kidIds.includes(kidId)) return false;
  if (link.moduleAccess && 'sparks' in link.moduleAccess) return !!link.moduleAccess.sparks?.act;
  return Array.isArray(link.modules) && link.modules.includes('sparks');
}
