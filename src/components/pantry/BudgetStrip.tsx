'use client';

// Compact budget summary for the Pantry Home + Active list. Shows the
// month's total spent / planned with a per-category mini-bar grid (only
// categories with a budget render). When no budget is set, renders a
// dashed CTA pointing to /pantry/budget.

import Link from 'next/link';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import { STAPLE_CATEGORIES, monthLabel } from '@/lib/pantry';
import { formatCents } from './format';

export default function BudgetStrip() {
  const { budget, monthSpentByCategory, monthSpentTotalCents, monthKey } = usePantry();
  const { config } = useHive();
  const currency = config.currency;

  if (!budget || !budget.categoryBudgets || Object.keys(budget.categoryBudgets).length === 0) {
    return (
      <Link
        href="/pantry/budget"
        className="block rounded-hive border-2 border-dashed border-hive-line p-3 mb-3 text-center font-nunito font-extrabold text-[12px] text-hive-muted hover:border-pantry-leaf hover:text-pantry-leaf-dk transition-colors no-underline"
      >
        💰 Set up {monthLabel(monthKey)}&apos;s budget →
      </Link>
    );
  }

  const planned = budget.totalBudgetCents || 0;
  const spent = monthSpentTotalCents;
  const remaining = Math.max(0, planned - spent);
  const overall = planned > 0 && spent > planned;
  const pct = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : 0;

  // Only show categories that have a budget set.
  const lines = STAPLE_CATEGORIES
    .map((c) => {
      const b = (budget.categoryBudgets as any)[c.id] as number | undefined;
      if (!b || b <= 0) return null;
      const s = (monthSpentByCategory as any)[c.id] || 0;
      const p = Math.min(100, Math.round((s / b) * 100));
      const over = s > b;
      return { ...c, planned: b, spent: s, pct: p, over };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return (
    <Link
      href="/pantry/budget"
      className={`block rounded-hive-lg p-4 mb-3 no-underline text-inherit hover:brightness-[1.02] transition ${
        overall ? 'bg-gradient-to-br from-[#FCEAEA] to-white border border-hive-rose/60' : 'bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf'
      }`}
    >
      <div className="flex items-baseline justify-between mb-2">
        <p className={`font-nunito font-extrabold text-[12px] uppercase tracking-[2px] ${overall ? 'text-hive-rose' : 'text-pantry-leaf-dk'}`}>
          {monthLabel(monthKey)}
        </p>
        <span className={`text-[11px] font-nunito font-extrabold ${overall ? 'text-hive-rose' : 'text-pantry-leaf-dk'}`}>
          Edit →
        </span>
      </div>
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className={`font-nunito font-black text-2xl ${overall ? 'text-hive-rose' : 'text-hive-navy'}`}>
          {formatCents(spent, currency)}
        </span>
        <span className="text-[12px] text-hive-muted font-bold">of {formatCents(planned, currency)}</span>
        <span className="ml-auto text-[12px] font-nunito font-extrabold">
          {overall
            ? <span className="text-hive-rose">⚠️ {formatCents(spent - planned, currency)} over</span>
            : <span className="text-pantry-leaf-dk">{formatCents(remaining, currency)} left</span>}
        </span>
      </div>
      <div className="h-2 bg-white/60 rounded-hive-pill overflow-hidden mb-3">
        <div
          className={`h-full rounded-hive-pill transition-[width] ${overall ? 'bg-hive-rose' : 'bg-pantry-leaf'}`}
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
                  className={`h-full rounded-hive-pill ${l.over ? 'bg-hive-rose' : 'bg-pantry-leaf'}`}
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
