'use client';

// Prominent budget strip for /hive/cash-out — keeps the spending plan
// in front of the kid every time they're about to spend. Shows total
// progress + a compact per-category bar grid. When no plan is set,
// renders the same "+ Set up this month's plan" prompt as the home card
// (so the kid always has a one-tap path into /hive/plan).

import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { PLAN_CATEGORIES } from '@/lib/hive';
import { formatCash } from './format';

export default function PlanProgressStrip() {
  const { monthlyPlan, monthSpending, config } = useHive();

  if (!monthlyPlan || !monthlyPlan.budget || Object.keys(monthlyPlan.budget).length === 0) {
    return (
      <Link
        href="/hive/plan"
        className="block rounded-hive border-2 border-dashed border-hive-line p-3.5 mb-3 text-center font-nunito font-extrabold text-[13px] text-hive-muted hover:border-hive-honey hover:text-hive-honey-dk transition-colors no-underline"
      >
        🗓️ Set up this month&apos;s spending plan →
      </Link>
    );
  }

  const planned = monthlyPlan.totalCents || 0;
  const spent = Object.values(monthSpending).reduce<number>((sum, v) => sum + (v || 0), 0);
  const remaining = Math.max(0, planned - spent);
  const overall = planned > 0 && spent > planned;
  const pct = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : 0;

  // Only show category mini-bars for categories that have a budget set.
  const lines = PLAN_CATEGORIES
    .map((c) => {
      const b = (monthlyPlan.budget as any)[c.id] as number | undefined;
      if (!b || b <= 0) return null;
      const s = (monthSpending as any)[c.id] || 0;
      const p = Math.min(100, Math.round((s / b) * 100));
      const over = s > b;
      return { ...c, planned: b, spent: s, pct: p, over };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <Link
      href="/hive/plan"
      className="block rounded-hive-lg bg-gradient-to-br from-[#FFE9C2] to-hive-honey-soft p-4 mb-3 no-underline text-inherit hover:brightness-[1.02] transition"
    >
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-nunito font-extrabold text-[13px] uppercase tracking-[2px] text-hive-honey-dk">This month&apos;s plan</p>
        <span className="text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">Edit →</span>
      </div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={`font-nunito font-black text-2xl ${overall ? 'text-hive-rose' : 'text-hive-navy'}`}>
          {formatCash(spent, config.currency)}
        </span>
        <span className="text-[12px] text-hive-muted font-bold">of {formatCash(planned, config.currency)}</span>
        <span className="ml-auto text-[12px] font-nunito font-extrabold">
          {overall
            ? <span className="text-hive-rose">⚠️ {formatCash(spent - planned, config.currency)} over</span>
            : <span className="text-hive-honey-dk">{formatCash(remaining, config.currency)} left</span>}
        </span>
      </div>
      <div className="h-2 bg-white/60 rounded-hive-pill overflow-hidden mb-3">
        <div
          className={`h-full rounded-hive-pill transition-[width] ${overall ? 'bg-hive-rose' : 'bg-hive-honey'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {lines.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {lines.map((l) => (
            <div key={l.id} className="bg-white/70 rounded-[10px] px-2 py-1.5">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">{l.emoji}</span>
                <span className="font-nunito font-extrabold text-[11px] truncate">{l.label}</span>
                <span className={`ml-auto text-[10px] font-extrabold ${l.over ? 'text-hive-rose' : 'text-hive-muted'}`}>
                  {l.over ? '!' : `${l.pct}%`}
                </span>
              </div>
              <div className="mt-1 h-1 bg-hive-line rounded-hive-pill overflow-hidden">
                <div
                  className={`h-full rounded-hive-pill ${l.over ? 'bg-hive-rose' : 'bg-hive-honey'}`}
                  style={{ width: `${l.over ? 100 : l.pct}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}
