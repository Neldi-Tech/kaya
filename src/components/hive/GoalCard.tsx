'use client';

// Goal card with progress bar, % complete, ETA at current pace. Section 6
// in the v2 mockup. ETA is a rough estimate based on weekly cash earnings
// — it's a hint, not a promise.

import type { Goal } from '@/lib/hive';
import { formatCash, formatHoney } from './format';

export default function GoalCard({
  goal,
  weeklyEarningsCents,
  currency = 'USD',
}: {
  goal: Goal;
  weeklyEarningsCents: number;
  currency?: string;
}) {
  const pct = goal.targetAmount > 0
    ? Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100))
    : 0;
  const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
  const fmt = (n: number) => goal.layer === 'cash' ? formatCash(n, currency) : `${formatHoney(n)} 🍯`;

  // ETA at current pace. Cash goals use the weekly earning rate; honey
  // goals don't have a weekly rate yet so we just show "—".
  const eta = (() => {
    if (goal.layer !== 'cash' || weeklyEarningsCents <= 0 || remaining <= 0) return null;
    const weeks = Math.ceil(remaining / weeklyEarningsCents);
    if (weeks > 52) return `${Math.round(weeks / 52)} years at current pace`;
    if (weeks > 8) return `${Math.round(weeks / 4)} months at current pace`;
    return `${weeks} week${weeks === 1 ? '' : 's'} at current pace`;
  })();

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-[14px] bg-hive-honey-soft/60 flex items-center justify-center text-2xl shrink-0">
          {goal.icon || '🎯'}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-[14px] leading-tight">{goal.title}</p>
          <p className="text-[11px] text-hive-muted mt-0.5">
            {fmt(goal.currentAmount)} / {fmt(goal.targetAmount)}
            {goal.status === 'completed' && <span className="ml-2 text-hive-green font-bold">✓ Reached</span>}
          </p>
        </div>
        <span className="font-nunito font-black text-lg text-hive-honey-dk shrink-0">{pct}%</span>
      </div>
      <div className="mt-3 h-2 bg-hive-line rounded-hive-pill overflow-hidden">
        <div
          className="h-full bg-hive-honey rounded-hive-pill transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {eta && (
        <p className="text-[11px] text-hive-muted mt-2">⏱ {eta}</p>
      )}
    </div>
  );
}
