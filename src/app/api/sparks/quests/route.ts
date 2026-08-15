// Kaya Sparks · Quests Admin-API gateway (2026-08-15).
//
// EVERY quest read + write flows through here — the client never touches
// the `sparks_quest*` collections directly. That is what makes two things
// real at once:
//
//   1. D3/R6 · the honest "starting point" note lives in
//      `sparks_quest_private` and is returned to PARENTS ONLY. It can't
//      leak through a shared screen, an export or an AI reply, because
//      no non-parent request ever receives the field at all.
//   2. D18 · ZERO firestore.rules deploys. Unlisted collection paths are
//      default-deny for clients, so the Admin SDK here is the only door.
//
// Access matrix:
//   · parent            → full read/write on every kid in the family,
//                         plus the private starting-point note
//   · kid (owner)       → read own quests; complete their own steps;
//                         never creates/edits/deletes a quest; NEVER
//                         receives the starting point
//   · kid (sibling)     → read only quests promoted to 'siblings'/'family';
//                         no writes, no starting point
//   · helper (sparks act, kid in kidIds)
//                       → mark a step done + attach proof ONLY (F15)
//   · anyone else       → 403
//
// Storage: /families/{familyId}/sparks_quests|_steps|_markers|_private.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type DayOfWeek = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DOW_KEYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const MAX_ACTIVE_QUESTS = 2;

type Action =
  | 'list' | 'get' | 'create' | 'update' | 'delete'
  | 'pathway-set' | 'private-set' | 'pause' | 'resume';

const ALL_ACTIONS: Action[] = [
  'list', 'get', 'create', 'update', 'delete',
  'pathway-set', 'private-set', 'pause', 'resume',
];

// ── Small validators ────────────────────────────────────────────────

const isDate = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const isHHmm = (v: unknown): v is string =>
  typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);

function str(v: unknown, max: number, fallback = ''): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : fallback;
}

function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function days(v: unknown): DayOfWeek[] {
  if (!Array.isArray(v)) return ['mon', 'tue', 'wed', 'thu', 'fri'];
  const out = v.filter((d): d is DayOfWeek => DOW_KEYS.includes(d as DayOfWeek));
  return out.length ? Array.from(new Set(out)) : ['mon', 'tue', 'wed', 'thu', 'fri'];
}

const VISIBILITIES = ['private', 'siblings', 'family'] as const;
type Visibility = typeof VISIBILITIES[number];
const visibility = (v: unknown): Visibility =>
  VISIBILITIES.includes(v as Visibility) ? (v as Visibility) : 'private';

const DIFFICULTIES = ['easy', 'medium', 'stretch'] as const;
type Difficulty = typeof DIFFICULTIES[number];
const difficulty = (v: unknown): Difficulty =>
  DIFFICULTIES.includes(v as Difficulty) ? (v as Difficulty) : 'medium';

const PROOF_KINDS = ['note', 'photo', 'scan', 'audio', 'video'] as const;
type ProofKind = typeof PROOF_KINDS[number];
const proofKind = (v: unknown): ProofKind | undefined =>
  PROOF_KINDS.includes(v as ProofKind) ? (v as ProofKind) : undefined;

const MARKER_KINDS = ['rubric', 'stars', 'count'] as const;

interface MarkerIn {
  id?: unknown; label?: unknown; kind?: unknown; unit?: unknown;
  higherIsBetter?: unknown; target?: unknown; proofKind?: unknown;
}

/** Sanitise the marker list. Max 3 (F8) — more than three and neither
 *  the parent nor the kid can hold the picture in their head. */
function markers(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  return v.slice(0, 3).map((raw, i) => {
    const m = (raw ?? {}) as MarkerIn;
    const kind = MARKER_KINDS.includes(m.kind as typeof MARKER_KINDS[number])
      ? (m.kind as string) : 'rubric';
    const out: Record<string, unknown> = {
      id: str(m.id, 40) || `m${i + 1}`,
      label: str(m.label, 120) || 'Progress check',
      kind,
    };
    // Firestore (Admin) rejects `undefined` — only set what exists.
    if (kind === 'count') {
      const unit = str(m.unit, 24);
      if (unit) out.unit = unit;
      out.higherIsBetter = m.higherIsBetter !== false;
    }
    if (Number.isFinite(Number(m.target))) out.target = Number(m.target);
    const pk = proofKind(m.proofKind);
    if (pk) out.proofKind = pk;
    return out;
  });
}

interface StepIn {
  date?: unknown; phase?: unknown; title?: unknown; how?: unknown;
  minutes?: unknown; tone?: unknown; proofKindWanted?: unknown; source?: unknown;
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
  const questsCol = famRef.collection('sparks_quests');

  /** Resolve which child (if any) this caller IS. `childId` can legally
   *  be '' on a kid user doc, so fall back to a uid/email match on the
   *  children collection — never `kids[0]`. */
  const viewerChildId = await resolveViewerChildId(db, famRef, uid, user);

  // ── Action dispatch ───────────────────────────────────────────────

  if (action === 'list') {
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    if (!(await canSeeKid(db, famRef, { isParent, isHelper, uid, viewerChildId }, kidId))) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }
    const snap = await questsCol.where('kidId', '==', kidId).get();
    const isOwnKid = viewerChildId === kidId;
    const quests = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .filter((q) => {
        if (isParent || isHelper || isOwnKid) return true;
        // A sibling only ever sees promoted quests (D12).
        const v = (q as { visibility?: string }).visibility || 'private';
        return v === 'siblings' || v === 'family';
      })
      .filter((q) => (q as { status?: string }).status !== 'archived')
      .sort((a, b) => Number((b as { createdAt?: number }).createdAt || 0)
        - Number((a as { createdAt?: number }).createdAt || 0));
    return NextResponse.json({ quests });
  }

  // Everything below operates on a single quest.
  const questId = str(body.questId, 80);
  if (action !== 'create' && !questId) {
    return NextResponse.json({ error: 'bad-quest' }, { status: 400 });
  }

  if (action === 'create') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const kidId = str(body.kidId, 80);
    if (!kidId) return NextResponse.json({ error: 'bad-kid' }, { status: 400 });
    const kidSnap = await famRef.collection('children').doc(kidId).get();
    if (!kidSnap.exists) return NextResponse.json({ error: 'no-such-kid' }, { status: 404 });

    // D14 · two active slots per kid, enforced server-side so it can't
    // be clicked around.
    const activeSnap = await questsCol.where('kidId', '==', kidId).where('status', '==', 'active').get();
    if (activeSnap.size >= MAX_ACTIVE_QUESTS) {
      return NextResponse.json({ error: 'too-many-active', max: MAX_ACTIVE_QUESTS }, { status: 409 });
    }

    const now = Date.now();
    const doc: Record<string, unknown> = {
      kidId,
      title: str(body.title, 80) || 'New quest',
      goal: str(body.goal, 600),
      difficulty: difficulty(body.difficulty),
      status: 'active',
      visibility: visibility(body.visibility),
      emoji: str(body.emoji, 8) || '🚀',
      colour: str(body.colour, 16) || '#5A3CB8',
      minutesPerDay: num(body.minutesPerDay, 1, 120, 10),
      activeDays: days(body.activeDays),
      cutoffHHmm: isHHmm(body.cutoffHHmm) ? body.cutoffHHmm : '17:00',
      markers: markers(body.markers),
      streak: { current: 0, best: 0, shields: 1, repairUsed: false },
      pointsPerStep: num(body.pointsPerStep, 0, 20, 2),
      graduationPoints: num(body.graduationPoints, 0, 200, 25),
      remindersEnabled: body.remindersEnabled !== false,
      pathwayApproved: false,
      createdAt: now,
      createdBy: uid,
      createdByName: actorName,
    };
    if (isDate(body.deadline)) doc.deadline = body.deadline;
    const extras = emailList(body.extraEmails);
    if (extras.length) doc.extraEmails = extras;

    const ref = await questsCol.add(doc);

    // D3 · the honest starting point NEVER lands on the quest document.
    const startingPoint = str(body.startingPoint, 1200);
    if (startingPoint) {
      await famRef.collection('sparks_quest_private').doc(ref.id).set({
        questId: ref.id, kidId, startingPoint, byUid: uid, byName: actorName, at: now,
      });
    }
    return NextResponse.json({ id: ref.id });
  }

  const questRef = questsCol.doc(questId);
  const questSnap = await questRef.get();
  if (!questSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const quest = questSnap.data() as Record<string, unknown>;
  const kidId = String(quest.kidId || '');

  const isOwner = !!viewerChildId && viewerChildId === kidId;
  const questVisibility = String(quest.visibility || 'private');
  const helperMayAct = isHelper && await helperCanAct(db, famRef, uid, kidId);

  const mayRead = isParent
    || isOwner
    || helperMayAct
    || (!!viewerChildId && (questVisibility === 'siblings' || questVisibility === 'family'));
  if (!mayRead) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  if (action === 'get') {
    const [stepsSnap, readingsSnap] = await Promise.all([
      famRef.collection('sparks_quest_steps').where('questId', '==', questId).get(),
      famRef.collection('sparks_quest_markers').where('questId', '==', questId).get(),
    ]);
    const steps = stepsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => {
        const ad = String((a as { date?: string }).date || '');
        const bd = String((b as { date?: string }).date || '');
        if (ad !== bd) return ad < bd ? -1 : 1;
        return Number((a as { seq?: number }).seq || 0) - Number((b as { seq?: number }).seq || 0);
      });
    const readings = readingsSnap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => Number((a as { at?: number }).at || 0) - Number((b as { at?: number }).at || 0));

    const out: Record<string, unknown> = { quest: { id: questId, ...quest }, steps, readings };
    // D3 · PARENTS ONLY. Non-parents don't get the field at all — there
    // is nothing to hide client-side because nothing is sent.
    if (isParent) {
      const priv = await famRef.collection('sparks_quest_private').doc(questId).get();
      out.startingPoint = priv.exists ? (priv.data()?.startingPoint ?? null) : null;
    }
    return NextResponse.json(out);
  }

  // ── Writes below this line are parent-only (D12/F15). Helpers act on
  // steps, which live in the Q2 action set, not here.
  if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });

  const now = Date.now();
  const stamp = { updatedAt: now, updatedBy: uid, updatedByName: actorName };

  if (action === 'update') {
    const patch = (body.patch ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = { ...stamp };
    if ('title' in patch) out.title = str(patch.title, 80) || 'Quest';
    if ('goal' in patch) out.goal = str(patch.goal, 600);
    if ('emoji' in patch) out.emoji = str(patch.emoji, 8) || '🚀';
    if ('colour' in patch) out.colour = str(patch.colour, 16) || '#5A3CB8';
    if ('difficulty' in patch) out.difficulty = difficulty(patch.difficulty);
    if ('visibility' in patch) out.visibility = visibility(patch.visibility);
    if ('minutesPerDay' in patch) out.minutesPerDay = num(patch.minutesPerDay, 1, 120, 10);
    if ('activeDays' in patch) out.activeDays = days(patch.activeDays);
    if ('cutoffHHmm' in patch) out.cutoffHHmm = isHHmm(patch.cutoffHHmm) ? patch.cutoffHHmm : '17:00';
    if ('markers' in patch) out.markers = markers(patch.markers);
    if ('pointsPerStep' in patch) out.pointsPerStep = num(patch.pointsPerStep, 0, 20, 2);
    if ('graduationPoints' in patch) out.graduationPoints = num(patch.graduationPoints, 0, 200, 25);
    if ('remindersEnabled' in patch) out.remindersEnabled = patch.remindersEnabled !== false;
    if ('extraEmails' in patch) out.extraEmails = emailList(patch.extraEmails);
    if ('deadline' in patch) {
      out.deadline = isDate(patch.deadline) ? patch.deadline : FieldValue.delete();
    }
    if ('status' in patch) {
      const s = String(patch.status);
      if (['draft', 'active', 'paused', 'graduated', 'archived'].includes(s)) {
        // Re-activating has to respect the two-slot rule too.
        if (s === 'active' && quest.status !== 'active') {
          const activeSnap = await questsCol
            .where('kidId', '==', kidId).where('status', '==', 'active').get();
          if (activeSnap.size >= MAX_ACTIVE_QUESTS) {
            return NextResponse.json({ error: 'too-many-active', max: MAX_ACTIVE_QUESTS }, { status: 409 });
          }
          out.pausedUntil = FieldValue.delete();
        }
        out.status = s;
      }
    }
    await questRef.update(out);
    return NextResponse.json({ ok: true });
  }

  if (action === 'private-set') {
    const startingPoint = str(body.startingPoint, 1200);
    const privRef = famRef.collection('sparks_quest_private').doc(questId);
    if (!startingPoint) await privRef.delete().catch(() => {});
    else await privRef.set({ questId, kidId, startingPoint, byUid: uid, byName: actorName, at: now });
    return NextResponse.json({ ok: true });
  }

  if (action === 'pause') {
    const until = isDate(body.until) ? body.until : '';
    if (!until) return NextResponse.json({ error: 'bad-date' }, { status: 400 });
    await questRef.update({ status: 'paused', pausedUntil: until, ...stamp });
    return NextResponse.json({ ok: true });
  }

  if (action === 'resume') {
    const activeSnap = await questsCol
      .where('kidId', '==', kidId).where('status', '==', 'active').get();
    if (activeSnap.size >= MAX_ACTIVE_QUESTS) {
      return NextResponse.json({ error: 'too-many-active', max: MAX_ACTIVE_QUESTS }, { status: 409 });
    }
    await questRef.update({ status: 'active', pausedUntil: FieldValue.delete(), ...stamp });
    return NextResponse.json({ ok: true });
  }

  if (action === 'pathway-set') {
    const drafts = Array.isArray(body.steps) ? body.steps.slice(0, 400) : [];
    const stepsCol = famRef.collection('sparks_quest_steps');
    const existing = await stepsCol.where('questId', '==', questId).get();

    // Completed steps are HISTORY — a re-plan never erases what a kid
    // already did. We only replace the not-yet-done ones.
    const keepDates = new Set<string>();
    const batchDeletes: FirebaseFirestore.DocumentReference[] = [];
    for (const d of existing.docs) {
      const s = d.data() as { done?: boolean; date?: string };
      if (s.done) keepDates.add(`${s.date}`);
      else batchDeletes.push(d.ref);
    }

    let batch = db.batch();
    let ops = 0;
    const flush = async () => { if (ops) { await batch.commit(); batch = db.batch(); ops = 0; } };

    for (const ref of batchDeletes) {
      batch.delete(ref); ops++;
      if (ops >= 400) await flush();
    }

    let seq = 0;
    let lastDate = '';
    for (const raw of drafts) {
      const s = (raw ?? {}) as StepIn;
      const date = isDate(s.date) ? s.date : '';
      if (!date || keepDates.has(date)) continue;
      seq = date === lastDate ? seq + 1 : 0;
      lastDate = date;
      const doc: Record<string, unknown> = {
        questId, kidId, date,
        phase: str(s.phase, 40) || 'Warm up',
        title: str(s.title, 120) || 'Practice',
        how: str(s.how, 600),
        minutes: num(s.minutes, 1, 120, Number(quest.minutesPerDay) || 10),
        tone: s.tone === 'fun' ? 'fun' : 'serious',
        source: s.source === 'ai' ? 'ai' : 'parent',
        seq,
        done: false,
      };
      const pk = proofKind(s.proofKindWanted);
      if (pk) doc.proofKindWanted = pk;
      batch.set(stepsCol.doc(), doc); ops++;
      if (ops >= 400) await flush();
    }
    await flush();

    const patch: Record<string, unknown> = { ...stamp };
    if (body.approve !== false) {
      patch.pathwayApproved = true;
      patch.pathwayApprovedAt = now;
      patch.pathwayApprovedByName = actorName;
    }
    const weeks = Number(body.weeks);
    if (Number.isFinite(weeks) && weeks > 0) patch.pathwayWeeks = Math.min(52, Math.round(weeks));
    await questRef.update(patch);
    return NextResponse.json({ ok: true, planted: drafts.length });
  }

  if (action === 'delete') {
    const stepsCol = famRef.collection('sparks_quest_steps');
    const [steps, readings] = await Promise.all([
      stepsCol.where('questId', '==', questId).get(),
      famRef.collection('sparks_quest_markers').where('questId', '==', questId).get(),
    ]);
    let batch = db.batch();
    let ops = 0;
    for (const d of [...steps.docs, ...readings.docs]) {
      batch.delete(d.ref); ops++;
      if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
    }
    if (ops) await batch.commit();
    await famRef.collection('sparks_quest_private').doc(questId).delete().catch(() => {});
    await questRef.delete();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}

// ── Shared helpers ──────────────────────────────────────────────────

/** Kid-owner resolution. `childId` is legitimately '' on some kid user
 *  docs, so fall back to a uid / email match against the children
 *  collection. Never assume `kids[0]`. */
async function resolveViewerChildId(
  db: Firestore,
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

/** May this caller list quests for `kidId` at all? Sibling filtering by
 *  visibility happens on the rows themselves. */
async function canSeeKid(
  db: Firestore,
  famRef: FirebaseFirestore.DocumentReference,
  who: { isParent: boolean; isHelper: boolean; uid: string; viewerChildId: string },
  kidId: string,
): Promise<boolean> {
  if (who.isParent) return true;
  if (who.viewerChildId) return true; // own or sibling — rows are filtered after
  if (who.isHelper) return helperCanAct(db, famRef, who.uid, kidId);
  return false;
}

/** F15 · a helper may act on a kid's quest steps when they hold the
 *  Sparks act-grant AND the kid is in their `kidIds`. They never see
 *  the starting point and never edit a quest. */
async function helperCanAct(
  db: Firestore,
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

/** D11 · extra reminder recipients — grandparent, tutor, coach. */
function emailList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .slice(0, 8);
}
