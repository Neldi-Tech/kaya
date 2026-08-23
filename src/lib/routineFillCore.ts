// HP2 · Routine-fill RAG — pure core (no Firebase imports) so the client
// tab, the weekly snapshot cron and the weekly email all compute the
// SAME colour for the same day. (Helper Performance 2.0, D3/D4, 2026-08-23)
//
// One colour per helper per day:
//   expected slots = assigned kids × periods from expectedFrequency
//     both → morning + evening · morning → morning · evening → evening
//     flexible / undefined → any ONE period per kid counts
//   a slot is FILLED when a rating doc exists for that kid/date/period
//   with ratedBy === helper (partial marks inside the slot still count —
//   the Ratings % already gives partial credit; the RAG stays readable)
//
//   🟢 green  — all expected slots filled
//   🟡 amber  — some filled, not all
//   🔴 red    — none filled
//   ⚪ off    — not a work day
//   ⚪ na     — before the helper joined / no kids assigned
//   ◌ today   — live (not tallied until the day closes)
//   ·  future — nothing yet
//
// Fill % = filled ÷ expected across SETTLED days (green/amber/red only).

export type FillStatus = 'green' | 'amber' | 'red' | 'off' | 'na' | 'today' | 'future';
export type FillPeriod = 'morning' | 'evening';

export interface FillRatingLite {
  date: string;                  // YYYY-MM-DD
  childId: string;
  period: FillPeriod | string;
  ratedBy: string;
}

export interface FillHelperLite {
  uid: string;
  kidIds: string[];
  expectedFrequency?: 'morning' | 'evening' | 'both' | 'flexible';
  workDays?: string[] | null;    // absent / empty = all 7
  /** YYYY-MM-DD the helper was added (days before are 'na'). */
  joinedDate?: string | null;
}

export interface KidSlotFill {
  /** true = filled, false = expected but missing, null = not expected */
  morning: boolean | null;
  evening: boolean | null;
}

export interface DayFill {
  date: string;                  // YYYY-MM-DD
  dow: number;                   // 0 = Sun … 6 = Sat (local)
  status: FillStatus;
  expected: number;              // slots expected that day
  filled: number;                // slots filled
  perKid: Record<string, KidSlotFill>;
}

export interface FillSummary {
  days: DayFill[];
  green: number;
  amber: number;
  red: number;
  off: number;
  /** Settled days only (green+amber+red). */
  settledDays: number;
  expectedSlots: number;
  filledSlots: number;
  /** 0–100, null when nothing was expected yet. */
  fillPct: number | null;
}

const DOW_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Local YYYY-MM-DD for a Date. */
export function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** Parse YYYY-MM-DD as a LOCAL date (noon — DST-safe). */
export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
export function addDays(s: string, n: number): string {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymdLocal(d);
}
/** Monday of the week containing `s` (ISO weeks, Mon–Sun). */
export function mondayOf(s: string): string {
  const d = parseYmd(s);
  const dow = d.getDay(); // 0 Sun
  const back = dow === 0 ? 6 : dow - 1;
  d.setDate(d.getDate() - back);
  return ymdLocal(d);
}
/** ISO week key, e.g. 2026-W34 (for the Monday of that week). */
export function isoWeekKey(s: string): string {
  const d = parseYmd(s);
  // ISO: week with the year's first Thursday is week 1.
  const t = new Date(d.getTime());
  t.setHours(0, 0, 0, 0);
  t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
  const week1 = new Date(t.getFullYear(), 0, 4);
  const wk = 1 + Math.round(((t.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${String(wk).padStart(2, '0')}`;
}

export function expectedPeriods(freq: FillHelperLite['expectedFrequency']): FillPeriod[] | 'any' {
  if (freq === 'both') return ['morning', 'evening'];
  if (freq === 'morning') return ['morning'];
  if (freq === 'evening') return ['evening'];
  return 'any';
}

/** Compute the day-by-day fill for [from, to] inclusive (YYYY-MM-DD). */
export function computeRoutineFill(
  helper: FillHelperLite,
  ratings: FillRatingLite[],
  from: string,
  to: string,
  today: string,
): FillSummary {
  const kids = helper.kidIds ?? [];
  const periods = expectedPeriods(helper.expectedFrequency);
  const workDays = helper.workDays && helper.workDays.length > 0 ? helper.workDays : null;

  // Index ratings by date → kid → period
  const byDate = new Map<string, Map<string, Set<string>>>();
  for (const r of ratings) {
    if (r.ratedBy !== helper.uid) continue;
    let kidMap = byDate.get(r.date);
    if (!kidMap) { kidMap = new Map(); byDate.set(r.date, kidMap); }
    let set = kidMap.get(r.childId);
    if (!set) { set = new Set(); kidMap.set(r.childId, set); }
    set.add(r.period);
  }

  const days: DayFill[] = [];
  let green = 0, amber = 0, red = 0, off = 0, expectedSlots = 0, filledSlots = 0;
  for (let s = from; s <= to; s = addDays(s, 1)) {
    const d = parseYmd(s);
    const dow = d.getDay();
    const perKid: Record<string, KidSlotFill> = {};
    const kidMap = byDate.get(s);
    let expected = 0, filled = 0;
    for (const kid of kids) {
      const have = kidMap?.get(kid) ?? new Set<string>();
      if (periods === 'any') {
        const any = have.size > 0;
        perKid[kid] = { morning: have.has('morning') ? true : null, evening: have.has('evening') ? true : null };
        if (!any) perKid[kid] = { morning: false, evening: false };
        expected += 1; if (any) filled += 1;
      } else {
        const m = periods.includes('morning') ? have.has('morning') : null;
        const e = periods.includes('evening') ? have.has('evening') : null;
        perKid[kid] = { morning: m, evening: e };
        for (const p of periods) { expected += 1; if (have.has(p)) filled += 1; }
      }
    }

    let status: FillStatus;
    if (workDays && !workDays.includes(DOW_KEY[dow])) status = 'off';
    else if ((helper.joinedDate && s < helper.joinedDate) || kids.length === 0) status = 'na';
    else if (s > today) status = 'future';
    else if (s === today) status = 'today';
    else if (expected === 0) status = 'na';
    else if (filled >= expected) status = 'green';
    else if (filled > 0) status = 'amber';
    else status = 'red';

    if (status === 'green') green++;
    else if (status === 'amber') amber++;
    else if (status === 'red') red++;
    else if (status === 'off') off++;
    if (status === 'green' || status === 'amber' || status === 'red') {
      expectedSlots += expected; filledSlots += filled;
    }
    days.push({ date: s, dow, status, expected, filled, perKid });
  }
  const settledDays = green + amber + red;
  const fillPct = expectedSlots > 0 ? Math.round((filledSlots / expectedSlots) * 100) : null;
  return { days, green, amber, red, off, settledDays, expectedSlots, filledSlots, fillPct };
}

/** Compact 7-char code string for a week (G/A/R/O/N/T/F) — stored on
 *  weekly snapshots + used in emails/WhatsApp (🟢🟡🔴⚪). */
export function fillCodes(days: DayFill[]): string {
  return days.map((d) => (
    d.status === 'green' ? 'G' : d.status === 'amber' ? 'A' : d.status === 'red' ? 'R' :
    d.status === 'off' ? 'O' : d.status === 'na' ? 'N' : d.status === 'today' ? 'T' : 'F'
  )).join('');
}
export function fillEmoji(code: string): string {
  return code.split('').map((c) => (
    c === 'G' ? '🟢' : c === 'A' ? '🟡' : c === 'R' ? '🔴' : c === 'O' || c === 'N' ? '⚪' : c === 'T' ? '◌' : '·'
  )).join('');
}
