'use client';

// Compact plan-of-the-month card for the Hive Home. When no plan is set,
// shows a nudge to start one. When a plan exists, shows the headline
// "$X of $Y spent" with the top category line.

import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { PLAN_CATEGORIES } from '@/lib/hive';
import { formatCash } from './format';

export default function PlanSummaryCard() {
  const { monthlyPlan, monthSpending, config } = useHive();

  if (!monthlyPlan || !monthlyPlan.budget || Object.keys(monthlyPlan.budget).length === 0) {
    return (
      <Link
        href="/hive/plan"
        className="block rounded-hive border-2 border-dashed border-hive-line p-4 mb-4 text-center font-nunito font-extrabold text-[13px] text-hive-muted hover:border-hive-honey hover:text-hive-honey-dk transition-colors no-underline"
      >
        🗓️ Set up this month&apos;s spending plan →
      </Link>
    );
  }

  const planned = monthlyPlan.totalCents || 0;
  const spent = Object.values(monthSpending).reduce<number>((sum, v) => sum + (v || 0), 0);
  const remaining = Math.max(0, planned - spent);
  const pct = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : 0;
  const overall = planned > 0 && spent > planned;

  // Pick the most-used category for the line under the headline.
  const top = Object.entries(monthSpending).sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
  const topAmount = top ? (top[1] || 0) : 0;
  const topMeta = top ? PLAN_CATEGORIES.find((c) => c.id === top[0]) : null;
  const topPlanned = top ? ((monthlyPlan.budget as any)[top[0]] || 0) : 0;

  return (
    <Link
      href="/hive/plan"
      className="block rounded-hive bg-hive-paper border border-hive-line p-4 mb-4 no-underline text-inherit hover:border-hive-honey transition-colors"
    >
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-nunito font-extrabold text-[13px]">🗓️ This month&apos;s plan</p>
        <span className={`text-[11px] font-nunito font-extrabold ${overall ? 'text-hive-rose' : 'text-hive-honey-dk'}`}>
          {formatCash(spent, config.currency)} / {formatCash(planned, config.currency)}
        </span>
      </div>
      <div className="h-2 bg-hive-line rounded-hive-pill overflow-hidden mb-2">
        <div
          className={`h-full rounded-hive-pill transition-[width] ${overall ? 'bg-hive-rose' : 'bg-hive-honey'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-[11px] text-hive-muted">
        {overall ? (
          <>⚠️ <strong className="text-hive-rose">{formatCash(spent - planned, config.currency)} over</strong> the plan</>
        ) : (
          <><strong className="text-hive-navy">{formatCash(remaining, config.currency)}</strong> left this month</>
        )}
        {topMeta && topAmount > 0 && (
          <> · top: {topMeta.emoji} {topMeta.label}{topPlanned > 0 ? ` (${formatCash(topAmount, config.currency)} of ${formatCash(topPlanned, config.currency)})` : ''}</>
        )}
      </p>
    </Link>
  );
}
