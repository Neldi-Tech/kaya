// Kaya Sparks · Treasures 2.0 — 🗄 The Family Cupboard gateway (2026-08-22).
//
// Family-owned 📚 books and 🎲 games live in the SAME `sparks_treasures`
// collection as every kid's register (D24) — same lifecycle, same
// events trail, same zero-rules posture (D42). This gateway exists
// because the access matrix is different: the Cupboard is OURS, not
// MINE.
//
// Access matrix (D26):
//   · parent            → everything: add, edit, lend, end, settings,
//                         confirm hand-typed names
//   · kid (any child)   → see every shelf item; add family things or
//                         their OWN (shared) book/game; edit / lend /
//                         report family things; end only their own
//   · helper            → ONLY if a parent listed them in
//                         cupboardSettings.helperUids (and the helper
//                         link is active): see, add family things, log,
//                         lend/return/report. Never end, never settings.
//   · anyone else       → 403
//
// Money values are never read here at all (D26). A kid's own book on
// the shelf keeps its value in `sparks_treasure_private`, parents-only,
// behind the main gateway — this route never opens that sub-document.
//
// Storage:
//   /families/{f}/sparks_treasures/{id}           kidId === 'family' for
//                                                  family-owned things
//   /families/{f}/sparks_treasure_events/{id}     append-only trail
//   /families/{f}/sparks_treasure_private/cupboard__settings

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { bumpBadgeCountersAdmin } from '@/lib/badgeCountersAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';

/** D25 · sentinel kidId for family-owned things (lib/sparks/treasures.ts). */
const FAMILY_OWNER_ID = 'family';
const SETTINGS_DOC = 'cupboard__settings';

const ENDED = ['handed_on', 'donated', 'sold', 'outgrown', 'retired'];
const GAME_KINDS = ['party', 'strategy', 'cards', 'puzzle', 'outdoor', 'other'];
const NAME_SOURCES = ['lookup', 'vision', 'manual'];
const READING_MODES = ['off', 'daily', 'weekdays', 'weekly'];

type Action =
  | 'shelf' | 'item' | 'add' | 'update'
  | 'condition' | 'found' | 'sighting' | 'lend' | 'return' | 'end'
  | 'settings-get' | 'settings-set' | 'helpers'
  | 'my-reading' | 'reading-start' | 'reading-mark' | 'reading-finish'
  | 'reading-reminder' | 'reading-invite' | 'reading-invite-respond';

const ALL_ACTIONS: Action[] = [
  'shelf', 'item', 'add', 'update',
  'condition', 'found', 'sighting', 'lend', 'return', 'end',
  'settings-get', 'settings-set', 'helpers',
  'my-reading', 'reading-start', 'reading-mark', 'reading-finish',
  'reading-reminder', 'reading-invite', 'reading-invite-respond',
];

const READING_MARKS_KEPT = 60;

/** D32 · is today a reading day for this reminder? `weekly` rides the
 *  weekday the reading started on, so it has a fixed place in the week. */
function isReadingDay(mode: string, startedOn: string, today: string): boolean {
  if (mode === 'off') return false;
  if (mode === 'daily') return true;
  const dow = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
  };
  if (mode === 'weekdays') { const w = dow(today); return w >= 1 && w <= 5; }
  if (mode === 'weekly') return dow(today) === dow(startedOn || today);
  return false;
}

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

/** Optional positive integer — absent / 0 / junk → undefined. */
function optInt(v: unknown, min: number, max: number): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < min) return undefined;
  return Math.min(max, n);
}

function todayInTZ(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
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

/** D29 · the dedupe key. Mirrors normaliseTitle in lib/sparks/cupboard.ts. */
function titleKey(name: string, author?: string): string {
  const n = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return `${n(name)}|${n(author || '')}`;
}

function cleanBarcode(v: unknown): string {
  const s = str(v, 40).replace(/[^0-9Xx]/g, '');
  return s.length >= 8 ? s.toUpperCase() : '';
}

// ── Meta sanitisers (D27) ───────────────────────────────────────────

function bookMeta(v: unknown): Record<string, unknown> {
  const b = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const author = str(b.author, 120); if (author) out.author = author;
  const isbn = cleanBarcode(b.isbn); if (isbn) out.isbn = isbn;
  const pages = optInt(b.pages, 1, 20000); if (pages) out.pages = pages;
  const year = optInt(b.year, 1400, 2100); if (year) out.year = year;
  const publisher = str(b.publisher, 120); if (publisher) out.publisher = publisher;
  const coverUrl = str(b.coverUrl, 600); if (/^https?:\/\//.test(coverUrl)) out.coverUrl = coverUrl;
  const ageMin = optInt(b.ageMin, 1, 18); if (ageMin) out.ageMin = ageMin;
  return out;
}

function gameMeta(v: unknown): Record<string, unknown> {
  const g = (v ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const ageMin = optInt(g.ageMin, 1, 18); if (ageMin) out.ageMin = ageMin;
  const pMin = optInt(g.playersMin, 1, 99); if (pMin) out.playersMin = pMin;
  const pMax = optInt(g.playersMax, 1, 99); if (pMax) out.playersMax = Math.max(pMax, pMin || 1);
  const minutes = optInt(g.minutes, 1, 600); if (minutes) out.minutes = minutes;
  const kind = str(g.gameKind, 20); if (GAME_KINDS.includes(kind)) out.gameKind = kind;
  const pieces = str(g.piecesNote, 200); if (pieces) out.piecesNote = pieces;
  return out;
}

// ── Settings (D26 · D32 · D36 · D38 · D40 · N8) ─────────────────────

interface Settings {
  helperUids: string[];
  reading: { mode: string; hour: number; quietLineDays: number };
  quiz: { enabled: boolean; minAge: number; points: boolean };
  gameNight: { enabled: boolean; dayOfWeek: number; hour: number; minute: number };
  dustDays: number;
  meetingLine: boolean;
}

const DEFAULTS: Settings = {
  helperUids: [],
  reading: { mode: 'daily', hour: 19, quietLineDays: 7 },
  quiz: { enabled: true, minAge: 6, points: false },
  gameNight: { enabled: true, dayOfWeek: 5, hour: 18, minute: 30 },
  dustDays: 90,
  meetingLine: true,
};

async function readSettings(
  privateCol: FirebaseFirestore.CollectionReference,
): Promise<Settings> {
  const snap = await privateCol.doc(SETTINGS_DOC).get();
  const s = (snap.exists ? snap.data() : {}) as Record<string, unknown>;
  const r = (s.reading ?? {}) as Record<string, unknown>;
  const q = (s.quiz ?? {}) as Record<string, unknown>;
  const g = (s.gameNight ?? {}) as Record<string, unknown>;
  return {
    helperUids: Array.isArray(s.helperUids) ? (s.helperUids as unknown[]).map((u) => str(u, 128)).filter(Boolean) : [],
    reading: {
      mode: READING_MODES.includes(String(r.mode)) ? String(r.mode) : DEFAULTS.reading.mode,
      hour: num(r.hour, 0, 23, DEFAULTS.reading.hour),
      quietLineDays: num(r.quietLineDays, 0, 30, DEFAULTS.reading.quietLineDays),
    },
    quiz: {
      enabled: q.enabled === undefined ? DEFAULTS.quiz.enabled : q.enabled !== false,
      minAge: num(q.minAge, 3, 18, DEFAULTS.quiz.minAge),
      points: q.points === true,
    },
    gameNight: {
      enabled: g.enabled === undefined ? DEFAULTS.gameNight.enabled : g.enabled !== false,
      dayOfWeek: num(g.dayOfWeek, 0, 6, DEFAULTS.gameNight.dayOfWeek),
      hour: num(g.hour, 0, 23, DEFAULTS.gameNight.hour),
      minute: [0, 15, 30, 45].includes(Number(g.minute)) ? Number(g.minute) : DEFAULTS.gameNight.minute,
    },
    dustDays: num(s.dustDays, 0, 365, DEFAULTS.dustDays),
    meetingLine: s.meetingLine === undefined ? DEFAULTS.meetingLine : s.meetingLine !== false,
  };
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
    ? (body.action as Action) : 'shelf';

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

  const viewerChildId = await resolveViewerChildId(famRef, uid, user);
  const today = todayInTZ();
  const settings = await readSettings(privateCol);

  // D26 · who may open the Cupboard at all.
  let member = isParent || !!viewerChildId;
  if (!member && isHelper) {
    member = settings.helperUids.includes(uid) && await helperLinkActive(famRef, uid);
  }
  if (!member) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const kidsSnap = await famRef.collection('children').get();
  const kidName = new Map<string, { name: string; emoji: string }>();
  for (const d of kidsSnap.docs) {
    const c = d.data() as { name?: string; avatarEmoji?: string };
    kidName.set(d.id, { name: str(c.name, 60) || 'Child', emoji: str(c.avatarEmoji, 8) || '🧒' });
  }

  const decorate = (id: string, t: Record<string, unknown>) => {
    const family = t.ownerScope === 'family' || String(t.kidId) === FAMILY_OWNER_ID;
    const owner = family ? undefined : kidName.get(String(t.kidId || ''));
    const keeper = t.keeperKidId ? kidName.get(String(t.keeperKidId)) : undefined;
    return {
      id, ...t,
      ownerName: owner?.name || '',
      ...(keeper ? { keeperName: keeper.name } : {}),
    };
  };

  /** D25 · what sits on the shelves: family-owned books/games + a kid's
   *  own book/game they shared with the family. Two equality queries. */
  async function shelfRows(): Promise<Array<Record<string, unknown> & { id: string }>> {
    const [bSnap, gSnap] = await Promise.all([
      col.where('categoryId', '==', 'book').get(),
      col.where('categoryId', '==', 'game').get(),
    ]);
    return [...bSnap.docs, ...gSnap.docs]
      .map((d): Record<string, unknown> & { id: string } => ({ ...(d.data() as Record<string, unknown>), id: d.id }))
      .filter((t) => t.ownerScope === 'family' || String(t.kidId) === FAMILY_OWNER_ID
        || String(t.visibility || 'private') === 'family');
  }

  // ── Reads ─────────────────────────────────────────────────────────

  if (action === 'shelf') {
    const rows = await shelfRows();
    const items = rows
      .map((t) => decorate(t.id, t))
      .sort((a, b) => Number((b as { createdAt?: number }).createdAt || 0)
        - Number((a as { createdAt?: number }).createdAt || 0));
    return NextResponse.json({
      items,
      kids: kidsSnap.docs.map((d) => ({ id: d.id, ...kidName.get(d.id)! })),
      settings,
      me: {
        role: isParent ? 'parent' : isHelper ? 'helper' : 'kid',
        childId: viewerChildId,
        canManage: isParent,
      },
    });
  }

  if (action === 'settings-get') {
    return NextResponse.json({ settings });
  }

  // ── 📖 my-reading — the one call My Day / Workplan / Sparks Today need ──
  if (action === 'my-reading') {
    const kidId = str(body.kidId, 80);
    if (!kidId || !kidName.has(kidId)) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    // A kid sees only their own; parents + allow-listed helpers any kid.
    if (!isParent && !isHelper && viewerChildId !== kidId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const bSnap = await col.where('categoryId', '==', 'book').get();
    const readings: Array<Record<string, unknown>> = [];
    const invites: Array<Record<string, unknown>> = [];
    for (const d of bSnap.docs) {
      const t = d.data() as Record<string, unknown>;
      if (ENDED.includes(String(t.status))) continue;
      const rs = Array.isArray(t.readings) ? (t.readings as Array<Record<string, unknown>>) : [];
      for (const r of rs) {
        if (String(r.readerKidId) !== kidId || r.finishedOn) continue;
        const rem = (r.reminder ?? {}) as { mode?: string; hour?: number };
        const dueToday = isReadingDay(String(rem.mode || 'off'), String(r.startedOn || today), today);
        const book = (t.book ?? {}) as { coverUrl?: string };
        readings.push({
          treasureId: d.id, readingId: String(r.id), name: String(t.name || ''), emoji: String(t.emoji || '📚'),
          ...(book.coverUrl ? { coverUrl: book.coverUrl } : {}),
          currentPage: Number(r.currentPage || 0), ...(r.pages ? { pages: Number(r.pages) } : {}),
          ...(r.lastMarkOn ? { lastMarkOn: String(r.lastMarkOn) } : {}),
          readNo: Number(r.readNo || 1),
          dueToday, openToday: String(r.lastMarkOn || '') !== today,
        });
      }
      const inv = Array.isArray(t.invites) ? (t.invites as Array<Record<string, unknown>>) : [];
      for (const i of inv) {
        if (String(i.toKidId) !== kidId || String(i.status) !== 'open') continue;
        invites.push({ treasureId: d.id, inviteId: String(i.id), name: String(t.name || ''), emoji: String(t.emoji || '📚'), fromName: String(i.fromName || ''), ...(i.note ? { note: String(i.note) } : {}) });
      }
    }
    const openCount = readings.filter((r) => r.dueToday && r.openToday).length + invites.length;
    return NextResponse.json({ date: today, readings, invites, openCount });
  }

  if (action === 'helpers') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const snap = await famRef.collection('helpers').get();
    const helpers = snap.docs.map((d) => {
      const h = d.data() as { displayName?: string; preset?: string; status?: string };
      return {
        uid: d.id,
        displayName: str(h.displayName, 60) || 'Helper',
        preset: str(h.preset, 20) || 'custom',
        active: h.status === 'active',
        allowed: settings.helperUids.includes(d.id),
      };
    }).sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName));
    return NextResponse.json({ helpers });
  }

  if (action === 'settings-set') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const p = (body.settings ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    if (Array.isArray(p.helperUids)) {
      // Only real helper links may be allow-listed.
      const links = await famRef.collection('helpers').get();
      const valid = new Set(links.docs.map((d) => d.id));
      next.helperUids = (p.helperUids as unknown[]).map((u) => str(u, 128)).filter((u) => valid.has(u)).slice(0, 20);
    }
    if (p.reading && typeof p.reading === 'object') {
      const r = p.reading as Record<string, unknown>;
      next.reading = {
        mode: READING_MODES.includes(String(r.mode)) ? String(r.mode) : settings.reading.mode,
        hour: r.hour === undefined ? settings.reading.hour : num(r.hour, 0, 23, settings.reading.hour),
        quietLineDays: r.quietLineDays === undefined ? settings.reading.quietLineDays : num(r.quietLineDays, 0, 30, 7),
      };
    }
    if (p.quiz && typeof p.quiz === 'object') {
      const q = p.quiz as Record<string, unknown>;
      next.quiz = {
        enabled: q.enabled === undefined ? settings.quiz.enabled : q.enabled !== false,
        minAge: q.minAge === undefined ? settings.quiz.minAge : num(q.minAge, 3, 18, 6),
        points: q.points === undefined ? settings.quiz.points : q.points === true,
      };
    }
    if (p.gameNight && typeof p.gameNight === 'object') {
      const g = p.gameNight as Record<string, unknown>;
      next.gameNight = {
        enabled: g.enabled === undefined ? settings.gameNight.enabled : g.enabled !== false,
        dayOfWeek: g.dayOfWeek === undefined ? settings.gameNight.dayOfWeek : num(g.dayOfWeek, 0, 6, 5),
        hour: g.hour === undefined ? settings.gameNight.hour : num(g.hour, 0, 23, 18),
        minute: [0, 15, 30, 45].includes(Number(g.minute)) ? Number(g.minute) : settings.gameNight.minute,
      };
    }
    if (p.dustDays !== undefined) next.dustDays = num(p.dustDays, 0, 365, 90);
    if (p.meetingLine !== undefined) next.meetingLine = p.meetingLine !== false;
    next.updatedAt = Date.now();
    next.updatedByName = actorName;
    await privateCol.doc(SETTINGS_DOC).set(next, { merge: true });
    return NextResponse.json({ ok: true, settings: await readSettings(privateCol) });
  }

  // ── Add (D25 · D27 · D28 · D29) ───────────────────────────────────

  if (action === 'add') {
    const kind = str(body.kind, 10) === 'game' ? 'game' : 'book';
    const name = str(body.name, 120);
    if (!name) return NextResponse.json({ error: 'bad-name' }, { status: 400 });
    const scope = str(body.ownerScope, 10) === 'kid' ? 'kid' : 'family';
    let kidId = FAMILY_OWNER_ID;
    if (scope === 'kid') {
      kidId = str(body.kidId, 80);
      // A kid registers only for themselves; a helper never registers a
      // kid's own thing (D18/D26); a parent may register for any child.
      if (!kidId || !kidName.has(kidId)) return NextResponse.json({ error: 'no-such-kid' }, { status: 404 });
      if (!isParent && viewerChildId !== kidId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const nameSource = NAME_SOURCES.includes(str(body.nameSource, 10)) ? str(body.nameSource, 10) : 'manual';
    const barcode = cleanBarcode(body.barcode);
    const book = kind === 'book' ? bookMeta(body.book) : {};
    const game = kind === 'game' ? gameMeta(body.game) : {};
    const isbn = kind === 'book' ? String(book.isbn || barcode || '') : '';
    const code = barcode || isbn;

    // D29 · dedupe — same barcode, else same normalised title+author,
    // among the things already on the shelf. Never a silent double.
    if (body.allowDuplicate !== true) {
      const rows = await shelfRows();
      const key = titleKey(name, String(book.author || ''));
      const dup = rows.find((t) => {
        if (ENDED.includes(String(t.status))) return false;
        if (String(t.categoryId) !== kind) return false;
        const tb = (t.book ?? {}) as { author?: string; isbn?: string };
        const tcode = String(t.barcode || tb.isbn || '');
        if (code && tcode && code === tcode) return true;
        return titleKey(String(t.name || ''), tb.author) === key;
      });
      if (dup) {
        const d = decorate(dup.id, dup);
        return NextResponse.json({
          duplicateOf: { id: dup.id, name: String(dup.name || ''), ownerName: d.ownerName },
        });
      }
    }

    const now = Date.now();
    const doc: Record<string, unknown> = {
      kidId,
      ownerScope: scope,
      name,
      categoryId: kind,
      emoji: str(body.emoji, 8) || (kind === 'game' ? '🎲' : '📚'),
      giverKind: 'unknown',
      giverName: '',
      givenOn: today,
      status: 'kept',
      ownership: scope === 'family' ? 'shared' : 'kid',
      // D25 · it is on the Cupboard shelf, so it is shared with the family
      // by definition — a kid adding their own book here is choosing that.
      visibility: 'family',
      watchlisted: scope === 'kid',
      travels: false,
      missedChecks: 0,
      nameSource,
      // D28 · hand-typed names wait for a parent; looked-up / read names
      // are canonical on arrival.
      nameConfirmed: nameSource !== 'manual' || isParent,
      createdAt: now,
      createdBy: uid,
      createdByName: actorName,
    };
    if (code) doc.barcode = code;
    if (Object.keys(book).length) doc.book = book;
    if (Object.keys(game).length) doc.game = game;
    const whereKept = str(body.whereKept, 120);
    if (whereKept) doc.whereKept = whereKept;
    const photoUrl = str(body.photoUrl, 600); if (photoUrl) doc.photoUrl = photoUrl;
    const thumbUrl = str(body.thumbUrl, 600); if (thumbUrl) doc.thumbUrl = thumbUrl;
    const photoId = str(body.photoId, 80); if (photoId) doc.photoId = photoId;

    const ref = await col.add(doc);
    await logEvent(eventsCol, {
      treasureId: ref.id, kidId, kind: 'registered', on: today, at: now, byName: actorName,
      note: scope === 'family'
        ? `${name} — added to the Family Cupboard`
        : `${name} — on the Family Cupboard shelf`,
    });
    return NextResponse.json({ id: ref.id });
  }

  // ── Everything below operates on one item ─────────────────────────

  const treasureId = str(body.treasureId, 80);
  if (!treasureId) return NextResponse.json({ error: 'bad-treasure' }, { status: 400 });
  const ref = col.doc(treasureId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const t = snap.data() as Record<string, unknown>;
  const familyOwned = t.ownerScope === 'family' || String(t.kidId) === FAMILY_OWNER_ID;
  const onShelf = (t.categoryId === 'book' || t.categoryId === 'game')
    && (familyOwned || String(t.visibility || 'private') === 'family');
  if (!onShelf) return NextResponse.json({ error: 'not-on-shelf' }, { status: 404 });
  const kidId = String(t.kidId || FAMILY_OWNER_ID);
  const isOwner = !familyOwned && viewerChildId === kidId;

  // Who may change what (D26 · D41):
  //   family thing → any member may edit / lend / report; only a parent
  //                  may end it (kids don't give away family property).
  //   kid's thing  → parent or the owner; a sibling or helper is read-only
  //                  here (the main gateway still lets them add a sighting).
  const canEdit = isParent || (familyOwned ? true : isOwner);
  const canEnd = isParent || (!familyOwned && isOwner);

  if (action === 'item') {
    const evSnap = await eventsCol.where('treasureId', '==', treasureId).get();
    const events = evSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => Number((a as { at?: number }).at || 0) - Number((b as { at?: number }).at || 0));
    return NextResponse.json({
      item: decorate(snap.id, t), events, canEdit, canEnd, canManage: isParent,
    });
  }

  if (action === 'sighting') {
    const where = str(body.where, 120);
    if (!where) return NextResponse.json({ error: 'bad-where' }, { status: 400 });
    if (String(t.status) !== 'lost') return NextResponse.json({ error: 'not-missing' }, { status: 409 });
    await ref.update({
      sightings: FieldValue.arrayUnion({ where, on: today, byName: actorName, at: Date.now() }),
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'sighting', on: today, at: Date.now(), byName: actorName, note: `Seen: ${where}`,
    });
    return NextResponse.json({ ok: true });
  }

  // ── 📖 The reading loop (D31 · D32 · D33 · D37 · N9) ──────────────
  //
  // Readings are per reader, on the book doc. Reading is not "editing":
  // any member may start a reading on any shelf book (their own, or —
  // parents/helpers — on a kid's behalf). A kid touches only their own.
  if (action.startsWith('reading-')) {
    if (t.categoryId !== 'book') return NextResponse.json({ error: 'not-a-book' }, { status: 409 });
    if (ENDED.includes(String(t.status))) return NextResponse.json({ error: 'already-ended' }, { status: 409 });
    const readings = (Array.isArray(t.readings) ? t.readings : []) as Array<Record<string, unknown>>;
    const invites = (Array.isArray(t.invites) ? t.invites : []) as Array<Record<string, unknown>>;
    const now = Date.now();
    const bookName = String(t.name || 'the book');
    const bookMetaPages = Number((t.book as { pages?: number } | undefined)?.pages || 0);

    /** Who is the reader of a new reading, and may this caller act for them? */
    const resolveReader = (requested: string): { readerKidId: string; readerUid?: string; readerName: string } | null => {
      if (requested) {
        if (!kidName.has(requested)) return null;
        if (!isParent && !isHelper && viewerChildId !== requested) return null;
        return { readerKidId: requested, readerName: kidName.get(requested)!.name };
      }
      if (viewerChildId) return { readerKidId: viewerChildId, readerName: kidName.get(viewerChildId)?.name || actorName };
      return { readerKidId: '', readerUid: uid, readerName: actorName };
    };
    /** May this caller act on an existing reading? */
    const mayTouch = (r: Record<string, unknown>) => {
      if (isParent) return true;
      if (viewerChildId) return String(r.readerKidId) === viewerChildId;
      if (isHelper) return !!r.readerKidId || String(r.readerUid) === uid; // on a kid's behalf, or their own
      return false;
    };
    const startFor = async (who: { readerKidId: string; readerUid?: string; readerName: string }, pages: number, togetherWith: string) => {
      const already = readings.find((r) => !r.finishedOn && String(r.readerKidId) === who.readerKidId && (who.readerKidId || String(r.readerUid) === who.readerUid));
      if (already) return { error: 'already-reading', readingId: String(already.id) };
      const before = readings.filter((r) => !!r.finishedOn && String(r.readerKidId) === who.readerKidId && (who.readerKidId || String(r.readerUid) === who.readerUid)).length;
      const reading: Record<string, unknown> = {
        id: `r${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        readerKidId: who.readerKidId, readerName: who.readerName,
        readNo: before + 1, startedOn: today, currentPage: 0,
        reminder: { mode: settings.reading.mode, hour: settings.reading.hour },
        marks: [],
      };
      if (who.readerUid) reading.readerUid = who.readerUid;
      if (pages > 0) reading.pages = pages;
      if (togetherWith) reading.togetherWith = togetherWith;
      await ref.update({ readings: [...readings, reading], lastReadOn: today, updatedAt: now, updatedByName: actorName });
      await logEvent(eventsCol, {
        treasureId, kidId, kind: 'read_start', on: today, at: now, byName: actorName,
        note: `${who.readerName} started reading${before > 0 ? ` — read #${before + 1} 🔁` : ''}${togetherWith ? ` · with ${togetherWith}` : ''}`,
      });
      return { readingId: String(reading.id), readNo: before + 1 };
    };

    if (action === 'reading-start') {
      const who = resolveReader(str(body.readerKidId, 80));
      if (!who) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      const pages = optInt(body.pages, 1, 20000) || bookMetaPages || 0;
      const r = await startFor(who, pages, str(body.togetherWith, 60));
      if ('error' in r) return NextResponse.json(r, { status: 409 });
      return NextResponse.json(r);
    }

    const readingId = str(body.readingId, 40);
    const idx = readings.findIndex((r) => String(r.id) === readingId);

    if (action === 'reading-mark') {
      if (idx < 0) return NextResponse.json({ error: 'no-such-reading' }, { status: 404 });
      const r = readings[idx];
      if (!mayTouch(r)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      if (r.finishedOn) return NextResponse.json({ error: 'already-finished' }, { status: 409 });
      const page = optInt(body.page, 0, 20000) ?? 0;
      const prev = Number(r.currentPage || 0);
      const marks = (Array.isArray(r.marks) ? r.marks : []) as Array<Record<string, unknown>>;
      const next: Record<string, unknown> = {
        ...r, currentPage: page, lastMarkOn: today,
        marks: [...marks, { on: today, page, at: now }].slice(-READING_MARKS_KEPT),
      };
      const togetherWith = str(body.togetherWith, 60);
      if (togetherWith) next.togetherWith = togetherWith;
      const list = readings.slice(); list[idx] = next;
      await ref.update({ readings: list, lastReadOn: today, updatedAt: now, updatedByName: actorName });
      // D37 · pages read → badge counters (kids only; never deducted).
      if (r.readerKidId && page > prev) {
        await bumpBadgeCountersAdmin(db, familyId, String(r.readerKidId), { pagesRead: page - prev });
      }
      return NextResponse.json({ ok: true, currentPage: page });
    }

    if (action === 'reading-finish') {
      if (idx < 0) return NextResponse.json({ error: 'no-such-reading' }, { status: 404 });
      const r = readings[idx];
      if (!mayTouch(r)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      if (r.finishedOn) return NextResponse.json({ ok: true, readNo: Number(r.readNo || 1) });
      const pages = Number(r.pages || 0);
      const list = readings.slice();
      list[idx] = { ...r, finishedOn: today, lastMarkOn: today, currentPage: pages > 0 ? pages : Number(r.currentPage || 0) };
      await ref.update({
        readings: list, lastReadOn: today,
        readingsDone: Number(t.readingsDone || 0) + 1,
        updatedAt: now, updatedByName: actorName,
      });
      const readNo = Number(r.readNo || 1);
      await logEvent(eventsCol, {
        treasureId, kidId, kind: 'read_finish', on: today, at: now, byName: actorName,
        note: `${String(r.readerName || 'Someone')} finished ${bookName} 🏁${readNo > 1 ? ` — read #${readNo} 🔁` : ''}`,
      });
      if (r.readerKidId) {
        const deltas: Record<string, number> = { booksFinished: 1 };
        if (readNo > 1) deltas.readAgain = 1;
        if (pages > Number(r.currentPage || 0)) deltas.pagesRead = pages - Number(r.currentPage || 0);
        await bumpBadgeCountersAdmin(db, familyId, String(r.readerKidId), deltas);
      }
      return NextResponse.json({ ok: true, readNo });
    }

    if (action === 'reading-reminder') {
      if (idx < 0) return NextResponse.json({ error: 'no-such-reading' }, { status: 404 });
      const r = readings[idx];
      if (!mayTouch(r)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      const mode = READING_MODES.includes(str(body.mode, 10)) ? str(body.mode, 10) : settings.reading.mode;
      const hour = num(body.hour, 0, 23, settings.reading.hour);
      const list = readings.slice(); list[idx] = { ...r, reminder: { mode, hour } };
      await ref.update({ readings: list, updatedAt: now, updatedByName: actorName });
      return NextResponse.json({ ok: true });
    }

    if (action === 'reading-invite') {
      const toKidId = str(body.toKidId, 80);
      if (!toKidId || !kidName.has(toKidId)) return NextResponse.json({ error: 'no-such-kid' }, { status: 404 });
      if (viewerChildId && viewerChildId === toKidId) return NextResponse.json({ error: 'invite-yourself' }, { status: 409 });
      if (invites.some((i) => String(i.toKidId) === toKidId && String(i.status) === 'open')) {
        return NextResponse.json({ ok: true, already: true });
      }
      const note = str(body.note, 160);
      const invite: Record<string, unknown> = {
        id: `i${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        toKidId, fromName: actorName, fromUid: uid, on: today, at: now, status: 'open',
      };
      if (note) invite.note = note;
      await ref.update({ invites: [...invites, invite], updatedAt: now, updatedByName: actorName });
      await logEvent(eventsCol, {
        treasureId, kidId, kind: 'read_invite', on: today, at: now, byName: actorName,
        note: `${actorName} invited ${kidName.get(toKidId)!.name} to read ${bookName}${note ? ` — “${note}”` : ''}`,
      });
      // 🔔 the invitee hears about it (bell); My Day shows it anyway.
      const kidDoc = await famRef.collection('children').doc(toKidId).get();
      const kidUid = String((kidDoc.data() as { uid?: string } | undefined)?.uid || '');
      if (kidUid) {
        await famRef.collection('notifications').add({
          type: 'cupboard-invite',
          title: `💌 ${actorName} thinks you’d love ${bookName}`,
          message: note || 'Open the Family Cupboard to start reading.',
          read: false, forUserId: kidUid, link: `/sparks/treasures/cupboard/${treasureId}`,
          createdAt: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }
      return NextResponse.json({ ok: true });
    }

    if (action === 'reading-invite-respond') {
      const inviteId = str(body.inviteId, 40);
      const iIdx = invites.findIndex((i) => String(i.id) === inviteId);
      if (iIdx < 0) return NextResponse.json({ error: 'no-such-invite' }, { status: 404 });
      const inv = invites[iIdx];
      const toKidId = String(inv.toKidId || '');
      if (!isParent && viewerChildId !== toKidId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
      const accept = body.accept === true;
      const list = invites.slice(); list[iIdx] = { ...inv, status: accept ? 'accepted' : 'dismissed', respondedAt: now };
      await ref.update({ invites: list, updatedAt: now, updatedByName: actorName });
      if (!accept) return NextResponse.json({ ok: true });
      const who = resolveReader(toKidId);
      if (!who) return NextResponse.json({ ok: true });
      const r = await startFor(who, bookMetaPages, '');
      return NextResponse.json({ ok: true, readingId: r.readingId });
    }

    return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
  }

  if (!canEdit) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (action === 'update') {
    const p = (body.patch ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: Date.now(), updatedByName: actorName };
    // D28 · the canonical name is a PARENT's to change; confirming a
    // hand-typed one is too.
    if (p.name !== undefined) {
      if (!isParent) return NextResponse.json({ error: 'parents-only-name' }, { status: 403 });
      const name = str(p.name, 120);
      if (name) { patch.name = name; patch.nameConfirmed = true; }
    }
    if (p.nameConfirmed !== undefined) {
      if (!isParent) return NextResponse.json({ error: 'parents-only-name' }, { status: 403 });
      patch.nameConfirmed = p.nameConfirmed !== false;
    }
    if (p.emoji !== undefined) patch.emoji = str(p.emoji, 8) || (t.categoryId === 'game' ? '🎲' : '📚');
    if (p.whereKept !== undefined) patch.whereKept = str(p.whereKept, 120);
    if (p.keeperKidId !== undefined) {
      const k = str(p.keeperKidId, 80);
      patch.keeperKidId = k && kidName.has(k) ? k : FieldValue.delete();
    }
    if (p.book !== undefined && t.categoryId === 'book') {
      patch.book = { ...((t.book ?? {}) as Record<string, unknown>), ...bookMeta(p.book) };
    }
    if (p.game !== undefined && t.categoryId === 'game') {
      patch.game = { ...((t.game ?? {}) as Record<string, unknown>), ...gameMeta(p.game) };
    }
    if (p.barcode !== undefined) { const c = cleanBarcode(p.barcode); if (c) patch.barcode = c; }
    const photoUrl = str(p.photoUrl, 600); if (photoUrl) patch.photoUrl = photoUrl;
    const thumbUrl = str(p.thumbUrl, 600); if (thumbUrl) patch.thumbUrl = thumbUrl;
    const photoId = str(p.photoId, 80); if (photoId) patch.photoId = photoId;
    await ref.update(patch);
    return NextResponse.json({ ok: true });
  }

  // ── Lifecycle (D41 · same semantics as Treasures 1.0) ─────────────

  if (action === 'condition') {
    const status = str(body.status, 20);
    if (!['broken', 'repaired', 'lost', 'kept'].includes(status)) {
      return NextResponse.json({ error: 'bad-status' }, { status: 400 });
    }
    const note = str(body.note, 400);
    const now = Date.now();
    // D7 · a child reporting their OWN thing's loss/break earns Owned It;
    // a family thing is nobody's failure — neutral, no flag.
    const selfReported = isOwner && (status === 'broken' || status === 'lost');
    const patch: Record<string, unknown> = { status, updatedAt: now, updatedByName: actorName };
    if (status === 'lost') {
      patch.lostSince = today;
      const where = str(body.lastSeenWhere, 120) || str(t.whereKept, 120);
      if (where) { patch.lastSeenWhere = where; patch.lastSeenOn = today; }
    }
    if (status === 'kept' || status === 'repaired') { patch.lostSince = FieldValue.delete(); patch.missedChecks = 0; }
    if (selfReported) patch.ownedIt = true;
    await ref.update(patch);
    await logEvent(eventsCol, {
      treasureId, kidId,
      kind: status === 'kept' ? 'found' : status,
      on: today, at: now, byName: actorName,
      note: note || undefined, ownedIt: selfReported || undefined,
    });
    return NextResponse.json({ ok: true, ownedIt: selfReported });
  }

  if (action === 'found') {
    const where = str(body.where, 120);
    const lostSince = str(t.lostSince, 20);
    const days = lostSince ? daysBetween(lostSince, today) : 0;
    const patch: Record<string, unknown> = {
      status: 'kept', missedChecks: 0, lastCheckResult: 'have',
      lostSince: FieldValue.delete(), updatedAt: Date.now(), updatedByName: actorName,
    };
    if (where) patch.lastSeenWhere = where;
    await ref.update(patch);
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'found', on: today, at: Date.now(), byName: actorName,
      note: `${String(t.name || 'It')} — found${days > 0 ? ` after ${days} day${days === 1 ? '' : 's'}` : ''}${where ? ` (${where})` : ''}`,
    });
    return NextResponse.json({ ok: true, days });
  }

  if (action === 'lend') {
    const toName = str(body.toName, 60);
    const dueOn = isDate(body.dueOn) ? body.dueOn : addDays(today, 14);
    if (!toName) return NextResponse.json({ error: 'bad-borrower' }, { status: 400 });
    if (ENDED.includes(String(t.status))) return NextResponse.json({ error: 'already-ended' }, { status: 409 });
    const borrow: Record<string, unknown> = { toName, since: today, dueOn };
    const toChildId = str(body.toChildId, 80);
    if (toChildId) borrow.toChildId = toChildId;
    const lending = (t.lending ?? {}) as { out?: number; backOnTime?: number; backLate?: number };
    await ref.update({
      status: 'lent', borrow,
      lending: { out: Number(lending.out || 0) + 1, backOnTime: Number(lending.backOnTime || 0), backLate: Number(lending.backLate || 0) },
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'lent', on: today, at: Date.now(), byName: actorName,
      note: `Lent to ${toName} · back by ${dueOn}`,
    });
    return NextResponse.json({ ok: true });
  }

  if (action === 'return') {
    const borrow = (t.borrow ?? {}) as { dueOn?: string; toName?: string };
    if (String(t.status) !== 'lent') return NextResponse.json({ error: 'not-lent' }, { status: 409 });
    const late = !!borrow.dueOn && today > borrow.dueOn;
    const lending = (t.lending ?? {}) as { out?: number; backOnTime?: number; backLate?: number };
    await ref.update({
      status: 'kept', borrow: FieldValue.delete(),
      lending: {
        out: Math.max(0, Number(lending.out || 1) - 1),
        backOnTime: Number(lending.backOnTime || 0) + (late ? 0 : 1),
        backLate: Number(lending.backLate || 0) + (late ? 1 : 0),
      },
      lastCheckResult: 'have', missedChecks: 0,
      updatedAt: Date.now(), updatedByName: actorName,
    });
    await logEvent(eventsCol, {
      treasureId, kidId, kind: 'returned', on: today, at: Date.now(), byName: actorName,
      note: `Back from ${borrow.toName || 'a borrower'}${late ? ' (late)' : ''}`,
    });
    return NextResponse.json({ ok: true, late });
  }

  if (action === 'end') {
    if (!canEnd) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const how = str(body.how, 20);
    if (!ENDED.includes(how)) return NextResponse.json({ error: 'bad-ending' }, { status: 400 });
    const now = Date.now();
    const note = str(body.note, 400);
    const patch: Record<string, unknown> = { status: how, endedOn: today, updatedAt: now, updatedByName: actorName };
    if (note) patch.endedNote = note;

    // D12 · a hand-on to a child carries the object's story into THEIR
    // register (the new row is theirs; the Cupboard keeps the memory).
    const toChildId = str(body.toChildId, 80);
    if (how === 'handed_on' && toChildId && kidName.has(toChildId)) {
      const carried: Record<string, unknown> = {
        kidId: toChildId, ownerScope: 'kid',
        name: t.name, categoryId: t.categoryId, emoji: t.emoji,
        giverKind: 'family', giverName: 'The family', givenOn: today,
        status: 'kept', ownership: 'kid', visibility: 'private',
        watchlisted: true, travels: false, missedChecks: 0,
        handedFromTreasureId: treasureId, handedFromKidId: kidId,
        occasion: 'Handed on from the Family Cupboard',
        nameSource: t.nameSource || 'manual', nameConfirmed: t.nameConfirmed !== false,
        createdAt: now, createdBy: uid, createdByName: actorName,
      };
      for (const k of ['photoUrl', 'thumbUrl', 'photoId', 'book', 'game', 'barcode', 'whereKept'] as const) {
        if (t[k] !== undefined) carried[k] = t[k];
      }
      const created = await col.add(carried);
      patch.handedToChildId = toChildId;
      patch.handedToTreasureId = created.id;
      await logEvent(eventsCol, {
        treasureId: created.id, kidId: toChildId, kind: 'registered', on: today, at: now, byName: actorName,
        note: `${String(t.name || 'It')} — handed on from the Family Cupboard, story included`,
      });
    }
    await ref.update(patch);
    await logEvent(eventsCol, {
      treasureId, kidId, kind: how, on: today, at: now, byName: actorName, note: note || undefined,
    });
    return NextResponse.json({ ok: true, newTreasureId: patch.handedToTreasureId });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}

// ── Helpers ─────────────────────────────────────────────────────────

async function logEvent(
  eventsCol: FirebaseFirestore.CollectionReference,
  ev: Record<string, unknown>,
): Promise<void> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev)) if (v !== undefined) clean[k] = v;
  await eventsCol.add(clean);
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

/** D26 · an allow-listed helper still needs a live helper link. */
async function helperLinkActive(
  famRef: FirebaseFirestore.DocumentReference, uid: string,
): Promise<boolean> {
  const snap = await famRef.collection('helpers').doc(uid).get();
  if (!snap.exists) return false;
  return (snap.data() as { status?: string }).status === 'active';
}
