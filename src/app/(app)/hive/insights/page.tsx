'use client';

// /hive/insights — quick read on how the kid is doing this week.
// - 7-day earnings bar chart (cash incoming + Honey conversions counted in cents).
// - Save rate (this month).
// - Top earning category.
// - One behavioral tip from a small static pool.
//
// Charts are pure SVG — no dependency added.

import { useMemo } from 'react';
import { useHive } from '@/contexts/HiveContext';
import KidSwitcher from '@/components/hive/KidSwitcher';
import BackButton from '@/components/ui/BackButton';
import { formatCash } from '@/components/hive/format';

const TIPS = [
  'Try saving 30% of your next allowance into Honey. Future-you will thank you.',
  'When the bar chart dips, you didn\'t earn that day. Pick one routine to nail tomorrow.',
  'Goals get reached faster than you expect. Pick something specific.',
  'Spending isn\'t bad — *unplanned* spending is. Make a quick request and let it sit overnight.',
  'Donations count too — generosity makes save rate feel different from stinginess.',
  'A 50% save rate over a year is a superpower. Most adults don\'t hit that.',
];

export default function InsightsPage() {
  const { transactions, weeklyEarningsCents, saveRate, config } = useHive();

  // 7-day cash-in bar chart data.
  const days = useMemo(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    start.setDate(start.getDate() - 6);
    const labels = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const buckets: { label: string; date: Date; cents: number }[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + i * 86_400_000);
      const idx = d.getDay() === 0 ? 6 : d.getDay() - 1;
      buckets.push({ label: labels[idx], date: d, cents: 0 });
    }
    for (const t of transactions) {
      if (t.layer !== 'cash' || t.direction !== 'in') continue;
      const ts = (t.createdAt as any)?.toMillis?.();
      if (typeof ts !== 'number') continue;
      const day = new Date(ts);
      const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const idx = Math.floor((dayStart.getTime() - start.getTime()) / 86_400_000);
      if (idx < 0 || idx >= 7) continue;
      buckets[idx].cents += t.amount;
    }
    return buckets;
  }, [transactions]);

  const maxCents = Math.max(1, ...days.map((d) => d.cents));

  // Top spending category this month — used in the side card.
  const topCategory = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const totals: Record<string, number> = {};
    for (const t of transactions) {
      // Spendable pockets (Honey Pot + Cash); skip internal Pot↔Cash transfers
      // and business reinvest so the top-category reflects real spending.
      if (t.layer !== 'cash' && t.layer !== 'treasury') continue;
      if (t.direction !== 'out' || t.category === 'convert' || t.category === 'business') continue;
      const ts = (t.createdAt as any)?.toMillis?.();
      if (typeof ts !== 'number' || ts < monthStart) continue;
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    }
    const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    return entries[0] || null;
  }, [transactions]);

  // Pick a deterministic tip per day so it doesn't churn on each render.
  const tip = TIPS[new Date().getDate() % TIPS.length];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Insights</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">How am I doing? 📊</h1>
      </div>

      <KidSwitcher />

      {/* Earnings bar chart */}
      <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-4">
        <div className="flex items-baseline justify-between mb-3">
          <h3 className="font-nunito font-extrabold text-[14px]">Earned this week</h3>
          <p className="font-nunito font-black text-lg text-hive-green">
            +{formatCash(weeklyEarningsCents, config.currency)}
          </p>
        </div>
        <div className="h-32 flex items-end gap-1.5">
          {days.map((d, i) => {
            const h = d.cents === 0 ? 4 : Math.max(8, Math.round((d.cents / maxCents) * 96));
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                <div className="w-full flex-1 flex items-end">
                  <div
                    className={`w-full rounded-t-[6px] transition-all ${d.cents > 0 ? 'bg-hive-honey' : 'bg-hive-line'}`}
                    style={{ height: `${h}px` }}
                    title={`${d.label}: ${formatCash(d.cents, config.currency)}`}
                  />
                </div>
                <span className="text-[10px] text-hive-muted font-bold">{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Save rate + top category */}
      <div className="grid grid-cols-2 gap-2.5 mb-4">
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
          <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted">Save rate</p>
          <p className="font-nunito font-black text-3xl mt-1 text-hive-honey-dk">
            {saveRate === null ? '—' : `${saveRate}%`}
          </p>
          <p className="text-[11px] text-hive-muted mt-1 leading-snug">
            % of cash kept this month.
          </p>
        </div>
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
          <p className="text-[10px] uppercase tracking-[1.5px] font-bold text-hive-muted">Top spend</p>
          {topCategory ? (
            <>
              <p className="font-nunito font-black text-xl mt-1 capitalize">{topCategory[0]}</p>
              <p className="text-[11px] text-hive-muted mt-1">
                {formatCash(topCategory[1], config.currency)} this month
              </p>
            </>
          ) : (
            <>
              <p className="font-nunito font-black text-xl mt-1">—</p>
              <p className="text-[11px] text-hive-muted mt-1">No spending yet</p>
            </>
          )}
        </div>
      </div>

      {/* Tip from Kaya */}
      <div className="rounded-hive-lg p-5 bg-gradient-to-br from-[#FFE9C2] to-hive-honey-soft">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Tip from Kaya</p>
        <p className="font-nunito font-bold text-[14px] mt-2 leading-relaxed">
          {tip}
        </p>
      </div>
    </div>
  );
}
