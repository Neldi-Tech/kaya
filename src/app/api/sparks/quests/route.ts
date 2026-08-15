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
  | 'pathway-set' | 'private-set' | 'pause' | 'resume'
  | 'step-done' | 'step-undo' | 'streak-repair'
  | 'marker-add' | 'marker-delete';

const ALL_ACTIONS: Action[] = [
  'list', 'get', 'create', 'update', 'delete',
  'pathway-set', 'private-set', 'pause', 'resume',
  'step-done', 'step-undo', 'streak-repair',
  'marker-add', 'marker-delete',
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

  // ── Step actions — the ONE place a kid or a helper may write ───────
  //
  // D13 · one action, one SERVER-minted award. Nothing about points is
  // decided on the client, so a kid can't mint their own.
  if (action === 'step-done' || action === 'step-undo') {
    const mayAct = isParent || isOwner || helperMayAct;
    if (!mayAct) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const stepId = str(body.stepId, 80);
    if (!stepId) return NextResponse.json({ error: 'bad-step' }, { status: 400 });
    const stepRef = famRef.collection('sparks_quest_steps').doc(stepId);
    const stepSnap = await stepRef.get();
    if (!stepSnap.exists) return NextResponse.json({ error: 'no-such-step' }, { status: 404 });
    const step = stepSnap.data() as Record<string, unknown>;
    if (String(step.questId) !== questId) {
      return NextResponse.json({ error: 'step-mismatch' }, { status: 400 });
    }

    const nowMs = Date.now();
    const streak = readStreak(quest.streak);

    if (action === 'step-undo') {
      // Un-ticking never claws back points already awarded — same rule
      // the workplan uses. It just re-opens the step.
      await stepRef.update({
        done: false,
        doneAt: FieldValue.delete(),
        doneLate: FieldValue.delete(),
      });
      return NextResponse.json({ ok: true });
    }

    if (step.done) return NextResponse.json({ ok: true, already: true });

    const stepDate = String(step.date || '');
    const note = str(body.note, 4000);
    const proofs = proofList(body.proofs);
    const attachReflection = body.attachReflection === true;
    const claimReflection = body.claimReflection === true;

    // R1 · did this land after the quest's cut-off? Drives the quiet
    // "done late" append on the alert-log entry — never a second alarm.
    const cutoff = String(quest.cutoffHHmm || '17:00');
    const doneLate = stepDate < todayInTZ() || (stepDate === todayInTZ() && nowInTZ() > cutoff);

    // ── streak (D10) ──
    const advanced = advanceStreak(
      streak,
      stepDate,
      days(quest.activeDays),
      typeof quest.pausedUntil === 'string' ? quest.pausedUntil : '',
    );

    // ── D8 · reflection linkage. ATTACH, never overwrite. ──
    let reflectionAttachedDate = '';
    let reflectionClaimed = false;
    if (attachReflection || claimReflection) {
      const res = await attachToReflection(famRef, kidId, stepDate, {
        questId, stepId,
        title: String(step.title || 'Practice'),
        note,
        proofUrl: proofs.length ? String(proofs[0].url) : undefined,
        claim: claimReflection,
      });
      reflectionAttachedDate = res.attached ? stepDate : '';
      reflectionClaimed = res.claimed;
    }

    // ── D13 · the award, minted here and only here ──
    let pointsAwarded = 0;
    const points = num(quest.pointsPerStep, 0, 20, 2);
    if (points > 0 && !Number(step.awardedPoints)) {
      try {
        await famRef.collection('awards').add({
          childId: kidId,
          kind: 'regular',
          points,
          reason: `Quest — ${String(quest.title || 'Quest')}: ${String(step.title || 'step')}`,
          category: 'sparks',
          awardedBy: 'system',
          awardedByName: 'Kaya Quests',
          senderRole: 'parent',
          createdAt: FieldValue.serverTimestamp(),
        });
        const childRef = famRef.collection('children').doc(kidId);
        const cSnap = await childRef.get();
        const c = cSnap.exists
          ? (cSnap.data() as { totalPoints?: number; weeklyPoints?: number; lifetimePoints?: number })
          : {};
        await childRef.update({
          totalPoints: (c.totalPoints ?? 0) + points,
          weeklyPoints: (c.weeklyPoints ?? 0) + points,
          lifetimePoints: Math.max(c.lifetimePoints ?? 0, c.totalPoints ?? 0) + points,
        });
        pointsAwarded = points;
      } catch {
        /* best-effort: the step still ticks even if the award write fails */
      }
      // 🏅 Badges 2.0 picks Quests up for free through the shared tally.
      void bumpCounters(db, familyId, kidId, { quest_step: 1 });
    }

    const patch: Record<string, unknown> = {
      done: true,
      doneAt: nowMs,
      doneBy: uid,
      doneByName: actorName,
    };
    if (note) patch.note = note;
    if (proofs.length) patch.proofs = proofs;
    if (pointsAwarded) patch.awardedPoints = pointsAwarded;
    if (doneLate) patch.doneLate = true;
    if (reflectionAttachedDate) patch.reflectionAttachedDate = reflectionAttachedDate;
    if (reflectionClaimed) patch.reflectionClaimed = true;
    await stepRef.update(patch);
    await questRef.update({ streak: advanced });

    return NextResponse.json({
      ok: true, pointsAwarded, streak: advanced, doneLate,
      reflectionAttached: !!reflectionAttachedDate, reflectionClaimed,
    });
  }

  // ── Marker readings (D9 · F8) ──────────────────────────────────────
  //
  // The GROWTH track. A kid may record their own reading for rubric and
  // count markers (they're capturing a performance, not grading it);
  // `stars` markers are a parent's read by definition.
  if (action === 'marker-add') {
    const markerId = str(body.markerId, 40);
    const defined = Array.isArray(quest.markers) ? quest.markers as Array<{ id?: string; kind?: string }> : [];
    const marker = defined.find((m) => m.id === markerId);
    if (!marker) return NextResponse.json({ error: 'no-such-marker' }, { status: 404 });

    const kidMayRecord = marker.kind !== 'stars';
    const mayAct = isParent || (isOwner && kidMayRecord) || (helperMayAct && kidMayRecord);
    if (!mayAct) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    const value = Number(body.value);
    if (!Number.isFinite(value)) return NextResponse.json({ error: 'bad-value' }, { status: 400 });

    const col = famRef.collection('sparks_quest_markers');
    // The BASELINE is whatever landed first for this marker — captured
    // once, on day one, and never re-declared. Every later reading is
    // compared against it, which is what makes "then vs now" honest.
    const existing = await col
      .where('questId', '==', questId)
      .where('markerId', '==', markerId)
      .get();
    const isBaseline = existing.empty;

    const doc: Record<string, unknown> = {
      questId, kidId, markerId,
      value: marker.kind === 'stars'
        ? Math.min(5, Math.max(1, Math.round(value)))
        : marker.kind === 'rubric'
          ? Math.min(100, Math.max(0, Math.round(value)))
          : value,
      at: Date.now(),
      by: uid,
      byName: actorName,
    };
    if (isBaseline) doc.isBaseline = true;
    const proofUrl = String(body.proofUrl ?? '');
    if (proofUrl.startsWith('https://')) {
      doc.proofUrl = proofUrl.slice(0, 2048);
      const pk = proofKind(body.proofKind);
      if (pk) doc.proofKind = pk;
    }
    const note = str(body.note, 600);
    if (note) doc.note = note;

    const ref = await col.add(doc);
    return NextResponse.json({ ok: true, id: ref.id, isBaseline });
  }

  // ── Writes below this line are parent-only (D12/F15). Helpers act on
  // steps and non-star markers only, which is handled above.
  if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });

  if (action === 'marker-delete') {
    const readingId = str(body.readingId, 80);
    if (!readingId) return NextResponse.json({ error: 'bad-reading' }, { status: 400 });
    const ref = famRef.collection('sparks_quest_markers').doc(readingId);
    const snap = await ref.get();
    if (!snap.exists || String(snap.data()?.questId) !== questId) {
      return NextResponse.json({ error: 'not-found' }, { status: 404 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  }

  if (action === 'streak-repair') {
    // D10 · 🩹 the one-time repair. Once spent it never comes back, so a
    // family gets exactly one "that week was rough" pass per quest.
    const streak = readStreak(quest.streak);
    if (streak.repairUsed) return NextResponse.json({ error: 'repair-spent' }, { status: 409 });
    const restored = Math.max(streak.current, streak.best);
    await questRef.update({
      streak: { ...streak, current: restored, repairUsed: true, lastDoneDate: todayInTZ() },
    });
    return NextResponse.json({ ok: true, current: restored });
  }

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

// ── Local-day helpers (day boundaries are LOCAL, never UTC) ─────────

const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';

function todayInTZ(d = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return p; // en-CA formats as YYYY-MM-DD
}

function nowInTZ(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const h = parts.find((x) => x.type === 'hour')?.value ?? '00';
  const m = parts.find((x) => x.type === 'minute')?.value ?? '00';
  return `${h === '24' ? '00' : h}:${m}`;
}

function shiftDay(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n));
  return dt.toISOString().slice(0, 10);
}

function dowOf(date: string): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return DOW_KEYS[new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay()];
}

// ── Streak (D10) ────────────────────────────────────────────────────

interface Streak {
  current: number; best: number; lastDoneDate?: string;
  shields: number; repairUsed?: boolean; shieldedDates?: string[];
}

function readStreak(v: unknown): Streak {
  const s = (v ?? {}) as Partial<Streak>;
  return {
    current: Number(s.current) || 0,
    best: Number(s.best) || 0,
    lastDoneDate: typeof s.lastDoneDate === 'string' ? s.lastDoneDate : undefined,
    shields: Number.isFinite(Number(s.shields)) ? Number(s.shields) : 1,
    repairUsed: s.repairUsed === true,
    shieldedDates: Array.isArray(s.shieldedDates) ? s.shieldedDates.slice(-30) : [],
  };
}

/** Advance the streak for a step completed on `date`.
 *
 *  Rest days (any day not in `activeDays`) and paused days are SKIPPED
 *  entirely — they can neither extend nor break a streak. A gap of real
 *  missed active days is absorbed by 🛡️ shields while any remain; only
 *  once the shields are gone does the streak restart at 1. That is the
 *  whole point of D10: a streak that snaps on one sick day turns a
 *  growth tool into an anxiety tool. */
function advanceStreak(
  s: Streak, date: string, activeDays: DayOfWeek[], pausedUntil: string,
): Streak {
  const out: Streak = { ...s, shieldedDates: [...(s.shieldedDates ?? [])] };
  if (!s.lastDoneDate) {
    out.current = 1;
  } else if (s.lastDoneDate === date) {
    return out; // same day, nothing to do
  } else if (s.lastDoneDate > date) {
    return out; // backfilling an older day never rewrites the run
  } else {
    // Count the ACTIVE days strictly between lastDoneDate and date.
    let missed = 0;
    const missedDates: string[] = [];
    for (let cur = shiftDay(s.lastDoneDate, 1); cur < date; cur = shiftDay(cur, 1)) {
      if (pausedUntil && cur <= pausedUntil) continue;
      if (!activeDays.includes(dowOf(cur))) continue;
      missed++;
      missedDates.push(cur);
      if (missed > 30) break;
    }
    if (missed === 0) {
      out.current = s.current + 1;
    } else if (missed <= out.shields) {
      out.shields -= missed;
      out.shieldedDates = [...(out.shieldedDates ?? []), ...missedDates].slice(-30);
      out.current = s.current + 1;
    } else {
      out.current = 1;
    }
  }
  out.best = Math.max(out.best, out.current);
  out.lastDoneDate = date;
  // Earn a shield back every 10 days of real consistency (cap 2) so the
  // safety net refills for the families who are actually showing up.
  if (out.current > 0 && out.current % 10 === 0) out.shields = Math.min(2, out.shields + 1);
  return out;
}

// ── Proof ───────────────────────────────────────────────────────────

interface ProofIn { kind?: unknown; url?: unknown; seconds?: unknown }

function proofList(v: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(v)) return [];
  const now = Date.now();
  return v.slice(0, 6).map((raw) => {
    const p = (raw ?? {}) as ProofIn;
    const out: Record<string, unknown> = {
      kind: proofKind(p.kind) ?? 'photo',
      url: String(p.url ?? '').slice(0, 2048),
      at: now,
    };
    if (Number.isFinite(Number(p.seconds))) out.seconds = Math.round(Number(p.seconds));
    return out;
  }).filter((p) => String(p.url).startsWith('https://'));
}

// ── D8 · reflection linkage ─────────────────────────────────────────

/** Attach a completed step to the kid's reflection for that day.
 *
 *  ATTACH NEVER OVERWRITES. This function touches exactly one field —
 *  `quest_notes` — plus, when the kid explicitly claimed the day AND the
 *  reflection has no words of its own yet, `text`. The reflection's own
 *  text, scan and retake trail are never written here, which is what
 *  makes the "attach, never overwrite" rule structural rather than a
 *  promise (F2).
 *
 *  R5 · a claim needs a note of real substance. A four-word practice
 *  note attaches happily but does not get to stand in for the day's
 *  reflection — otherwise the reflection habit is quietly hollowed out. */
const CLAIM_MIN_CHARS = 60;

async function attachToReflection(
  famRef: FirebaseFirestore.DocumentReference,
  kidId: string,
  date: string,
  args: { questId: string; stepId: string; title: string; note: string; proofUrl?: string; claim: boolean },
): Promise<{ attached: boolean; claimed: boolean }> {
  if (!date) return { attached: false, claimed: false };
  const ref = famRef.collection('sparks_reflections').doc(`${kidId}_${date}`);
  const snap = await ref.get();
  const existing = snap.exists
    ? (snap.data() as { text?: string; scanUrl?: string } | undefined)
    : undefined;

  const entry: Record<string, unknown> = {
    questId: args.questId,
    stepId: args.stepId,
    title: args.title,
    at: Date.now(),
  };
  if (args.note) entry.note = args.note;
  if (args.proofUrl) entry.proofUrl = args.proofUrl;

  const claimable = args.claim
    && args.note.trim().length >= CLAIM_MIN_CHARS
    && !(existing?.text && existing.text.trim())
    && !existing?.scanUrl;

  const patch: Record<string, unknown> = {
    kidId,
    date,
    quest_notes: FieldValue.arrayUnion(entry),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (claimable) {
    patch.text = args.note.trim();
    patch.source = 'typed';
  }
  if (!snap.exists) {
    patch.createdAt = FieldValue.serverTimestamp();
    // A doc created purely by an attach carries no words of its own and
    // therefore does not count as a reflection day — see
    // computeReflectionStreak, which requires text or a scan.
    if (!claimable) patch.text = '';
  }
  await ref.set(patch, { merge: true });
  return { attached: true, claimed: claimable };
}

// ── 🏅 Badge tallies (shared with every other area) ─────────────────

async function bumpCounters(
  db: Firestore, familyId: string, childId: string, deltas: Record<string, number>,
): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const [k, n] of Object.entries(deltas)) {
    if (!k || !Number.isFinite(n) || n === 0) continue;
    patch[`badgeCounters.${k}`] = FieldValue.increment(n);
  }
  if (!Object.keys(patch).length) return;
  try {
    await db.collection('families').doc(familyId).collection('children').doc(childId).update(patch);
  } catch { /* tallies are best-effort */ }
}

/** D11 · extra reminder recipients — grandparent, tutor, coach. */
function emailList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .slice(0, 8);
}
