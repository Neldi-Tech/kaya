// Drivers v2 — vehicle service due math (2026-07-05).
//
// Pure functions, no Firestore: shared by the service status card
// (detail page), the due-service nudge (kind picker), the Vehicle
// Health Card, and the service-reminders cron. Locked decision A:
// due = interval km OR interval months, WHICHEVER FIRST. The system
// projects the expected date from real usage (km/day run-rate) and
// pins the time-interval date as the hard stop it must not cross.
//
// All distances canonical km; all dates local YYYY-MM-DD strings.

export interface ServiceDueInput {
  /** Service every N km. */
  intervalKm?: number;
  /** And/or every N months. */
  intervalMonths?: number;
  /** Odometer at the last service (km). */
  baselineKm?: number;
  /** Date of the last service (YYYY-MM-DD). */
  baselineDate?: string;
  /** Latest known odometer reading (km). */
  latestKm?: number | null;
  /** Average km driven per day (run-rate from the ledger). */
  kmPerDay?: number | null;
  /** "Today" as YYYY-MM-DD (caller supplies — keeps this pure and
   *  lets the cron pin the family timezone). */
  todayIso: string;
  // ── v2.1 explicit targets (2026-07-05) — the workshop sticker ─────
  /** Next-service odometer typed by the parent. WINS over
   *  baseline + intervalKm whenever set. */
  nextKmOverride?: number;
  /** Next-service date typed by the parent (YYYY-MM-DD). WINS over
   *  baseline + intervalMonths whenever set. */
  nextDateOverride?: string;
}

export interface ServiceDueState {
  /** False when the vehicle has no interval configured at all. */
  configured: boolean;
  /** Odometer at which service is due (baselineKm + intervalKm). */
  dueKm?: number;
  /** Km remaining to dueKm (negative = over). */
  kmLeft?: number;
  /** Time-based due date — the HARD STOP (baselineDate + months). */
  hardStopIso?: string;
  /** Days to the hard stop (negative = past it). */
  daysToHardStop?: number;
  /** Usage-projected date the km interval runs out. */
  expectedIso?: string;
  /** 0..1+ — how much of the interval is used (max of km + time). */
  pctUsed: number;
  /** v2.1 — false when no denominator exists for a honest % (e.g. a
   *  sticker target with no interval and no baseline). UI shows a
   *  plain countdown instead of a fake ring percent. */
  pctComputable: boolean;
  /** v2.1 — true when the due came from typed targets (sticker),
   *  not derived from baseline + interval. */
  explicitTargets: boolean;
  /** True once either trigger has tripped. */
  overdue: boolean;
  /** Km past due when overdue via km (positive). */
  overdueKm?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isoToUtcMs(iso: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function msToIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** baselineDate + N months, clamping the day into the target month
 *  (31-Jan + 1 month → 28/29-Feb, not 3-Mar). */
export function addMonthsIso(iso: string, months: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]); const mo = Number(m[2]) - 1; const day = Number(m[3]);
  const targetMonth = mo + months;
  const daysInTarget = new Date(Date.UTC(y, targetMonth + 1, 0)).getUTCDate();
  return msToIso(Date.UTC(y, targetMonth, Math.min(day, daysInTarget)));
}

export function computeServiceDue(input: ServiceDueInput): ServiceDueState {
  const {
    intervalKm, intervalMonths, baselineKm, baselineDate, latestKm, kmPerDay,
    todayIso, nextKmOverride, nextDateOverride,
  } = input;
  const hasKmTrack = !!intervalKm && intervalKm > 0 && typeof baselineKm === 'number';
  const hasTimeTrack = !!intervalMonths && intervalMonths > 0 && !!baselineDate;
  // v2.1 — explicit sticker targets. Either one alone arms a countdown,
  // and each WINS over its derived counterpart when set.
  const hasKmTarget = typeof nextKmOverride === 'number' && nextKmOverride > 0;
  const hasDateTarget = !!nextDateOverride && isoToUtcMs(nextDateOverride) != null;
  if (!hasKmTrack && !hasTimeTrack && !hasKmTarget && !hasDateTarget) {
    return { configured: false, pctUsed: 0, pctComputable: false, explicitTargets: false, overdue: false };
  }

  const todayMs = isoToUtcMs(todayIso) ?? 0;
  const dueKm: number | undefined = hasKmTarget
    ? (nextKmOverride as number)
    : hasKmTrack ? (baselineKm as number) + (intervalKm as number) : undefined;
  let kmLeft: number | undefined;
  let expectedIso: string | undefined;
  let kmPct: number | null = null;
  if (dueKm != null && typeof latestKm === 'number' && latestKm > 0) {
    kmLeft = dueKm - latestKm;
    // Honest % only with a real denominator: the interval when known,
    // else the km driven since last service vs the target span.
    if (hasKmTrack) {
      kmPct = (latestKm - (baselineKm as number)) / (intervalKm as number);
    } else if (typeof baselineKm === 'number' && dueKm > baselineKm) {
      kmPct = (latestKm - baselineKm) / (dueKm - baselineKm);
    }
    if (kmLeft > 0 && kmPerDay && kmPerDay > 0) {
      expectedIso = msToIso(todayMs + Math.round(kmLeft / kmPerDay) * DAY_MS);
    } else if (kmLeft <= 0) {
      expectedIso = todayIso;
    }
  }

  const hardStopIso: string | undefined = hasDateTarget
    ? (nextDateOverride as string)
    : hasTimeTrack ? addMonthsIso(baselineDate as string, intervalMonths as number) ?? undefined : undefined;
  let daysToHardStop: number | undefined;
  let timePct: number | null = null;
  if (hardStopIso) {
    const dueMs = isoToUtcMs(hardStopIso) ?? 0;
    daysToHardStop = Math.round((dueMs - todayMs) / DAY_MS);
    const baseMs = baselineDate ? isoToUtcMs(baselineDate) : null;
    if (baseMs != null && dueMs > baseMs) {
      timePct = (todayMs - baseMs) / (dueMs - baseMs);
    }
  }

  const pcts = [kmPct, timePct].filter((p): p is number => p != null);
  const overKm = typeof kmLeft === 'number' && kmLeft < 0;
  const overTime = typeof daysToHardStop === 'number' && daysToHardStop < 0;
  return {
    configured: true,
    ...(dueKm != null ? { dueKm } : {}),
    ...(kmLeft != null ? { kmLeft } : {}),
    ...(hardStopIso ? { hardStopIso } : {}),
    ...(daysToHardStop != null ? { daysToHardStop } : {}),
    ...(expectedIso ? { expectedIso } : {}),
    pctUsed: pcts.length ? Math.max(0, Math.max(...pcts)) : 0,
    pctComputable: pcts.length > 0,
    explicitTargets: hasKmTarget || hasDateTarget,
    overdue: overKm || overTime,
    ...(overKm ? { overdueKm: Math.abs(kmLeft as number) } : {}),
  };
}

/** Whichever due signal lands sooner, for display: the usage-expected
 *  date, capped by the hard stop ("expected 24-Jul · not past 15-Aug"). */
export function effectiveDueIso(s: ServiceDueState): string | null {
  if (!s.configured) return null;
  if (s.expectedIso && s.hardStopIso) {
    return (isoToUtcMs(s.expectedIso) ?? 0) <= (isoToUtcMs(s.hardStopIso) ?? 0)
      ? s.expectedIso : s.hardStopIso;
  }
  return s.expectedIso ?? s.hardStopIso ?? null;
}

/** Reminder trigger check (lock B): fires when ≤ N km left OR ≤ N days
 *  left to the effective due date. */
export function serviceReminderState(
  s: ServiceDueState,
  thresholds: { kmLeft: number; daysLeft: number },
  todayIso: string,
): 'none' | 'upcoming' | 'overdue' {
  if (!s.configured) return 'none';
  if (s.overdue) return 'overdue';
  const kmTrip = typeof s.kmLeft === 'number' && s.kmLeft <= thresholds.kmLeft;
  const due = effectiveDueIso(s);
  let dayTrip = false;
  if (due) {
    const days = Math.round(((isoToUtcMs(due) ?? 0) - (isoToUtcMs(todayIso) ?? 0)) / DAY_MS);
    dayTrip = days <= thresholds.daysLeft;
  }
  return kmTrip || dayTrip ? 'upcoming' : 'none';
}

/** Local today as YYYY-MM-DD (client-side convenience — the cron
 *  passes its own TZ-pinned key instead). */
export function localTodayIso(): string {
  return new Date().toLocaleDateString('en-CA');
}
