// 🔥 Saver Streak (CASH UPGRADE, design §5) — consecutive weeks where the
// kid's save rate stayed ≥ 50%. Computed client-side from the Hive ledger:
// per local calendar week (Mon–Sun), rate = money-in ÷ (in + out) across the
// spendable pockets (Pot + Cash), skipping internal transfers. Quiet weeks
// (no activity) neither grow nor break the streak — kids shouldn't lose a
// flame for a week at grandma's. Week boundaries are LOCAL time.

import type { HiveTransaction } from './hive';

export const SAVER_MILESTONES = [
  { weeks: 4,  badgeId: 'saver-4',  emoji: '🥉', name: 'Bronze Saver' },
  { weeks: 12, badgeId: 'saver-12', emoji: '🥈', name: 'Silver Saver' },
  { weeks: 26, badgeId: 'saver-26', emoji: '🥇', name: 'Gold Saver' },
] as const;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Start of the local week (Monday 00:00) containing `d`. */
function weekStart(d: Date): number {
  const day = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
  return start.getTime();
}

export interface SaverStreakResult {
  /** Active weeks (≥50% save rate) in the current unbroken run. */
  weeks: number;
  /** This week's rate so far (null = no activity yet this week). */
  currentRate: number | null;
}

export function computeSaverStreak(transactions: HiveTransaction[]): SaverStreakResult {
  // Bucket spendable-pocket activity by local week.
  const inByWeek = new Map<number, number>();
  const outByWeek = new Map<number, number>();
  for (const t of transactions) {
    if ((t.layer !== 'cash' && t.layer !== 'treasury') || t.category === 'convert') continue;
    const ts = (t.createdAt as any)?.toMillis?.();
    if (typeof ts !== 'number') continue;
    const wk = weekStart(new Date(ts));
    if (t.direction === 'in') inByWeek.set(wk, (inByWeek.get(wk) || 0) + t.amount);
    else if (t.category !== 'business') outByWeek.set(wk, (outByWeek.get(wk) || 0) + t.amount);
  }

  const thisWeek = weekStart(new Date());
  const rateOf = (wk: number): number | null => {
    const inc = inByWeek.get(wk) || 0;
    const out = outByWeek.get(wk) || 0;
    const total = inc + out;
    return total === 0 ? null : inc / total;
  };

  // Walk back from this week: active weeks with rate ≥ 50% grow the streak,
  // quiet weeks are neutral, an active week below 50% breaks it. Capped at
  // 52 weeks of lookback so a long ledger stays cheap.
  let weeks = 0;
  for (let i = 0; i < 52; i++) {
    const rate = rateOf(thisWeek - i * WEEK_MS);
    if (rate === null) continue;
    if (rate >= 0.5) weeks += 1;
    else break;
  }
  return { weeks, currentRate: rateOf(thisWeek) };
}
