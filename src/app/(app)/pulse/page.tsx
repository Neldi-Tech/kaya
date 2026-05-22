'use client';

// /pulse — Kaya Pulse · Family Dashboard (Premium, parent default).
//
// Two money lenses, deliberately separate (never summed):
//   • CASH      — closed purchaseRequests this month vs householdBudgets caps.
//                 This is the savings basis (what feeds Kaya Wealth).
//   • CONSUMPTION — metered cost from readings (usage × price). The Pulse
//                 intelligence layer that spots spikes early.
// Kids/helpers are redirected to their Today feed.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { PulseHeader, PulseHero } from '@/components/pulse/ui';
import {
  type PulseReading, type Trackable,
  subscribeToReadingsInMonth, subscribeToTrackables,
} from '@/lib/pulse';

const LIVE_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll'];
const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export default function PulseDashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const thisMonth = monthKeyOf();

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [readings, setReadings] = useState<PulseReading[]>([]);
  const [trackables, setTrackables] = useState<Trackable[]>([]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const u1 = subscribeToRecentRequests(profile.familyId, setRecent);
    const u2 = subscribeToReadingsInMonth(profile.familyId, thisMonth, setReadings);
    const u3 = subscribeToTrackables(profile.familyId, setTrackables);
    return () => { u1(); u2(); u3(); };
  }, [profile?.familyId, profile?.role, thisMonth]);

  // CASH lens.
  const cash = useMemo(() => {
    const per: Record<string, { spent: number; cap: number }> = {};
    LIVE_MODULES.forEach((m) => { per[m] = { spent: 0, cap: 0 }; });
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      if (per[m]) per[m].spent += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    const budgets = (family?.householdBudgets ?? {}) as Record<string, number | undefined>;
    LIVE_MODULES.forEach((m) => { per[m].cap = budgets[m] ?? 0; });
    const totalSpent = LIVE_MODULES.reduce((s, m) => s + per[m].spent, 0);
    const totalCap = LIVE_MODULES.reduce((s, m) => s + per[m].cap, 0);
    return { per, totalSpent, totalCap };
  }, [recent, family?.householdBudgets, thisMonth]);

  // CONSUMPTION lens.
  const consumption = useMemo(() => {
    const byTrackable: Record<string, number> = {};
    let total = 0;
    for (const r of readings) {
      byTrackable[r.trackableId] = (byTrackable[r.trackableId] ?? 0) + (r.deltaCost ?? 0);
      total += r.deltaCost ?? 0;
    }
    const rows = Object.entries(byTrackable)
      .map(([id, cents]) => ({ id, cents, tk: trackables.find((t) => t.id === id) }))
      .sort((a, b) => b.cents - a.cents);
    return { rows, total };
  }, [readings, trackables]);

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  const { totalSpent, totalCap, per } = cash;
  const savings = Math.max(0, totalCap - totalSpent);
  const pct = totalCap > 0 ? Math.min(100, Math.round((totalSpent / totalCap) * 100)) : 0;
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const buckets = LIVE_MODULES
    .map((m) => ({ m, ...per[m] }))
    .filter((b) => b.spent > 0 || b.cap > 0)
    .sort((a, b) => b.spent - a.spent)
    .slice(0, 5);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseHeader eyebrow="Dashboard" title={monthLabel()} subtitle="Spend, savings pace + metered consumption" />

      {/* Hero — cash lens (savings basis) */}
      <div className="mt-4">
        <PulseHero>
          <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Spent this month</div>
          <div className="text-3xl font-nunito font-black mt-1">
            {formatCentsBudgetNeat(totalSpent, currency)}
            <span className="text-sm opacity-80 font-bold"> / {totalCap > 0 ? formatCentsBudgetNeat(totalCap, currency) : '—'}</span>
          </div>
          {totalCap > 0 ? (
            <>
              <div className="text-[12px] opacity-90 mt-1">
                {savings > 0 ? `On pace to save ${formatCentsBudgetNeat(savings, currency)}` : 'Over cap this month'}
              </div>
              <div className="h-2 bg-white/20 rounded-full mt-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#D4A847' }} />
              </div>
              <div className="flex justify-between text-[10px] font-black mt-2 opacity-90">
                <span>{pct}% of cap</span>
                <span>Day {dayOfMonth} / {daysInMonth}</span>
              </div>
            </>
          ) : (
            <div className="text-[12px] opacity-90 mt-1">
              Set caps in <Link href="/pantry/budget" className="underline">Budget</Link> to track savings.
            </div>
          )}
        </PulseHero>
      </div>

      {/* Top buckets — cash */}
      <div className="flex items-center justify-between mt-6 mb-2">
        <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px]">Top buckets</div>
        <Link href="/pantry/finances" className="text-[10px] text-pulse-gold-dk font-bold">Finances ›</Link>
      </div>
      {buckets.length === 0 ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center text-sm text-hive-muted">No spend yet this month.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {buckets.map((b) => {
            const over = b.cap > 0 && b.spent > b.cap;
            const bpct = b.cap > 0 ? Math.min(100, Math.round((b.spent / b.cap) * 100)) : 0;
            return (
              <div key={b.m} className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base">{MODULE_EMOJI[b.m]}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-black text-sm text-pulse-navy">{MODULE_LABEL[b.m]}</div>
                  <div className="text-[11px] text-hive-muted font-bold">
                    {formatCents(b.spent, currency)}{b.cap > 0 ? ` / ${formatCents(b.cap, currency)}` : ''}
                  </div>
                </div>
                {b.cap > 0 && (
                  <span className={`text-[9px] font-black px-2 py-1 rounded-lg ${over ? 'bg-[#fde6e6] text-pulse-coral' : 'bg-[#e3f2e6] text-pulse-green'}`}>{bpct}%</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Metered consumption — Pulse lens */}
      <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px] mt-6 mb-2">Metered consumption</div>
      {consumption.rows.length === 0 ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center text-sm text-hive-muted">
          No readings yet this month. Set up trackables + tasks in{' '}
          <Link href="/pulse/admin" className="text-pulse-gold-dk font-bold underline">Task setup</Link>.
        </div>
      ) : (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-3">
          <div className="flex justify-between items-baseline mb-2">
            <span className="text-[11px] text-hive-muted font-bold">This month's metered cost</span>
            <span className="font-nunito font-black text-pulse-navy">{formatCents(consumption.total, currency)}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {consumption.rows.map((row) => (
              <Link key={row.id} href={`/pulse/trackable/${row.id}`} className="flex items-center justify-between text-[12px] no-underline">
                <span className="font-bold text-pulse-navy">{row.tk?.emoji ?? '📊'} {row.tk?.name ?? 'Trackable'}</span>
                <span className="font-nunito font-black text-pulse-navy">{formatCents(row.cents, currency)} ›</span>
              </Link>
            ))}
          </div>
          <p className="text-[10px] text-hive-muted mt-2 leading-snug">
            Consumption telemetry (usage × price) — kept separate from cash spend above; it's how Pulse catches spikes early.
          </p>
        </div>
      )}
    </div>
  );
}
