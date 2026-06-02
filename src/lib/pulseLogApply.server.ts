// Kaya Pulse · apply a reading (server, Admin SDK) — the single write path.
//
// Shared by /api/pulse/log (a reader or parent logs) and /api/pulse/assist
// (a parent approves a helper's on-behalf entry) so the consumption /
// anomaly / reading-write / award logic lives in ONE place.
//
// Capture defaults to the task's own owner (a reader logging their own task).
// Override capturedBy/capturedByKind/loggedBy + set awardKid:false for an
// on-behalf write (parent log, or a parent-approved helper assist) — the
// reading is recorded + attributed, but the kid earns no points/streak.

type Dir = 'up' | 'down';
type Event = 'normal' | 'topup' | 'rollback';
type Firestore = FirebaseFirestore.Firestore;

function computeConsumption(direction: Dir, prev: number | null, curr: number): { consumedUnits: number; event: Event; toppedUpUnits?: number } {
  if (prev == null) return { consumedUnits: 0, event: 'normal' };
  if (direction === 'up') {
    if (curr >= prev) return { consumedUnits: curr - prev, event: 'normal' };
    return { consumedUnits: 0, event: 'rollback' };
  }
  if (curr <= prev) return { consumedUnits: prev - curr, event: 'normal' };
  return { consumedUnits: 0, event: 'topup', toppedUpUnits: curr - prev };
}

const ANOMALY_MULT = 2;
function detectAnomaly(consumed: number, avg: number): { isAnomaly: boolean; reason?: string } {
  if (avg <= 0) return { isAnomaly: false };
  if (consumed > ANOMALY_MULT * avg) return { isAnomaly: true, reason: `${(consumed / avg).toFixed(1)}× recent average` };
  return { isAnomaly: false };
}

const STREAK_BONUS: Record<number, number> = { 7: 25, 14: 50, 30: 150 };

function prevDayKey(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export interface ApplyReadingParams {
  familyId: string;
  taskId: string;
  value: number;
  /** Attribution overrides — default to the task's own owner (reader's log).
   *  Set these + awardKid:false for an on-behalf write. */
  capturedBy?: string;
  capturedByKind?: 'kid' | 'helper' | 'parent';
  loggedBy?: string;
  /** Award the kid points/streak. Defaults to (owner is a kid). */
  awardKid?: boolean;
  /** Optional task note (e.g. "Logged by parent"). */
  note?: string;
}

export interface ApplyReadingResult {
  ok: boolean;
  alreadyLogged?: boolean;
  consumedUnits: number;
  deltaCost: number;
  event: Event;
  points: number;
  isAnomaly: boolean;
  streak: number;
  error?: string;
  errorStatus?: number;
}

/** Compute + write the reading, close the task, award the kid if applicable,
 *  raise an anomaly alert. Returns a result (error/errorStatus on failure). */
export async function applyReadingLog(db: Firestore, p: ApplyReadingParams): Promise<ApplyReadingResult> {
  const base = { ok: true as const, consumedUnits: 0, deltaCost: 0, event: 'normal' as Event, points: 0, isAnomaly: false, streak: 0 };
  const famRef = db.collection('families').doc(p.familyId);
  const taskRef = famRef.collection('pulseTasks').doc(p.taskId);
  const now = new Date();

  const taskSnap = await taskRef.get();
  if (!taskSnap.exists) return { ...base, ok: false, error: 'task-not-found', errorStatus: 404 };
  const task = taskSnap.data() as {
    trackableId?: string; trackableSource?: string; ownerId?: string; ownerKind?: string;
    pointsValue?: number; dayKey?: string; status?: string;
  };
  if (!task.trackableId || !task.ownerId) return { ...base, ok: false, error: 'task-malformed', errorStatus: 400 };

  // Idempotent: a logged/closed task is not re-written or re-awarded.
  if (task.status === 'logged' || task.status === 'closed') return { ...base, alreadyLogged: true };

  // Resolve attribution — default to the task's own owner.
  const ownerKind = (task.ownerKind ?? 'kid') as 'kid' | 'helper';
  const capturedBy = p.capturedBy || task.ownerId;
  const capturedByKind = p.capturedByKind ?? ownerKind;
  const loggedBy = p.loggedBy || task.ownerId;
  const awardKid = p.awardKid ?? (ownerKind === 'kid');

  // Resolve the trackable → direction, unit price, budget module.
  const isMeter = (task.trackableSource ?? 'meter') === 'meter';
  const tRef = isMeter
    ? famRef.collection('utilityMeters').doc(task.trackableId)
    : famRef.collection('trackables').doc(task.trackableId);
  const tSnap = await tRef.get();
  if (!tSnap.exists) return { ...base, ok: false, error: 'trackable-not-found', errorStatus: 404 };
  const t = tSnap.data() as { direction?: Dir; pricePerUnitCents?: number; type?: string; module?: string };
  const direction: Dir = t.direction ?? (t.type === 'water' ? 'up' : 'down');
  const price = Number(t.pricePerUnitCents ?? 0);
  const moduleKey = isMeter ? 'utility' : t.module ?? 'utility';

  // Previous reading value + rolling average of recent normal usage.
  let prev: number | null = null;
  let avg = 0;
  try {
    const rs = await famRef.collection('readings').where('trackableId', '==', task.trackableId).get();
    const recent = rs.docs
      .map((d) => d.data() as { value?: number; consumedUnits?: number; event?: string; capturedAt?: FirebaseFirestore.Timestamp })
      .sort((a, b) => (b.capturedAt?.toMillis?.() ?? 0) - (a.capturedAt?.toMillis?.() ?? 0));
    if (recent[0]?.value != null) prev = Number(recent[0].value);
    const normals = recent.filter((r) => (r.event ?? 'normal') === 'normal').slice(0, 7).map((r) => Number(r.consumedUnits ?? 0));
    if (normals.length) avg = normals.reduce((s, n) => s + n, 0) / normals.length;
  } catch {
    /* first reading / transient → prev stays null */
  }

  const { consumedUnits, event, toppedUpUnits } = computeConsumption(direction, prev, p.value);
  const deltaCost = Math.round(consumedUnits * price);
  const { isAnomaly, reason } = detectAnomaly(consumedUnits, avg);

  // 1) Immutable reading.
  const readingRef = famRef.collection('readings').doc();
  await readingRef.set({
    trackableId: task.trackableId,
    trackableSource: task.trackableSource ?? 'meter',
    taskId: p.taskId,
    value: p.value,
    consumedUnits,
    deltaCost,
    event,
    ...(toppedUpUnits != null ? { toppedUpUnits } : {}),
    module: moduleKey,
    capturedBy,
    capturedByKind,
    ...(capturedByKind !== ownerKind ? { onBehalf: true } : {}),
    capturedAt: now,
    dayKey: task.dayKey ?? '',
    isAnomaly,
    ...(reason ? { anomalyReason: reason } : {}),
  });

  // 2) Task → logged (or review when an anomaly needs a parent tap).
  await taskRef.update({
    status: isAnomaly ? 'review' : 'logged',
    readingId: readingRef.id,
    loggedAt: now,
    loggedBy,
    pointsAwarded: awardKid,
    ...(p.note ? { note: p.note } : {}),
    assistProposedValue: null, // clear any assist proposal now it's resolved
  });

  const points = Number(task.pointsValue ?? 0);
  let streak = 0;

  // 3) Reward — kid only, and only when the kid did it themselves.
  if (awardKid && ownerKind === 'kid') {
    const today = task.dayKey ?? '';
    const profRef = famRef.collection('pulseProfiles').doc(task.ownerId);
    const profSnap = await profRef.get();
    const prof = profSnap.exists
      ? (profSnap.data() as { currentStreak?: number; longestStreak?: number; lastActiveDayKey?: string; lastBonusAwarded?: number })
      : {};
    let current = prof.currentStreak ?? 0;
    if (prof.lastActiveDayKey === today) {
      // already counted today — no change
    } else if (prof.lastActiveDayKey === prevDayKey(today)) {
      current += 1;
    } else {
      current = 1;
    }
    streak = current;
    const longest = Math.max(prof.longestStreak ?? 0, current);
    let bonus = 0;
    let lastBonus = prof.lastBonusAwarded ?? 0;
    if (STREAK_BONUS[current] && current > lastBonus) {
      bonus = STREAK_BONUS[current];
      lastBonus = current;
    }
    await profRef.set(
      { ownerKind: 'kid', currentStreak: current, longestStreak: longest, lastActiveDayKey: today, lastBonusAwarded: lastBonus },
      { merge: true },
    );

    const totalPts = points + bonus;
    if (totalPts > 0) {
      try {
        await famRef.collection('awards').add({
          childId: task.ownerId,
          kind: 'regular',
          points: totalPts,
          reason: bonus > 0
            ? `Kaya Pulse — reading logged (+${points}) + ${current}-day streak bonus (+${bonus})`
            : 'Kaya Pulse — reading logged',
          category: 'pulse',
          awardedBy: 'system',
          awardedByName: 'Kaya Pulse',
          senderRole: 'parent',
          createdAt: now,
        });
        const childRef = famRef.collection('children').doc(task.ownerId);
        const cSnap = await childRef.get();
        const c = cSnap.exists ? (cSnap.data() as { totalPoints?: number; weeklyPoints?: number }) : {};
        await childRef.update({
          totalPoints: (c.totalPoints ?? 0) + totalPts,
          weeklyPoints: (c.weeklyPoints ?? 0) + totalPts,
        });
      } catch {
        /* best-effort: a reading + task update already succeeded */
      }
    }
  }

  // 4) Anomaly alert for the Trackable Detail screen.
  if (isAnomaly) {
    try {
      await famRef.collection('pulseAlerts').add({
        readingId: readingRef.id,
        trackableId: task.trackableId,
        severity: 'warn',
        title: 'Unusual reading',
        body: reason ? `Logged usage is ${reason}.` : 'Logged usage is well above the recent average.',
        acknowledged: false,
        createdAt: now,
      });
    } catch {
      /* best-effort */
    }
  }

  return { ...base, consumedUnits, deltaCost, event, points: awardKid ? points : 0, isAnomaly, streak };
}
