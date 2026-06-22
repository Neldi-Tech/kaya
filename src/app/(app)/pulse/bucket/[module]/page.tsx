'use client';

// /pulse/bucket/[module] — Kaya Pulse · Budget bucket drill-down (§2a).
// Opens from a tappable Dashboard bucket row. Shows the month's CASH spend
// for this module vs its cap, a daily trend with a run-rate projection to
// month-end, the savings potential (projected vs cap + what trimming buys),
// and the module's metered trackables (the consumption lens) for context.
// Parent-only.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL, budgetMonthKeyFor,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';
import { PulseHeader, PulseHero, PulseBreadcrumb } from '@/components/pulse/ui';
import { toDisplayDate } from '@/lib/dates';
import {
  type PulseReading, type Trackable,
  subscribeToReadingsInMonth, subscribeToTrackables,
  projectMonthSpendCents, pacing, pacingLabel,
} from '@/lib/pulse';

const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
// Payroll counts on its work period (a May salary paid 7 Jun is May spend), not
// the pay-out day; everything else on its close date. Mirrors budgetMonthKeyFor.
const countDateOf = (r: PurchaseRequest): Date | null => {
  if (r.module === 'payroll' && r.payrollCycle?.periodStart) {
    const d = new Date(r.payrollCycle.periodStart);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return r.closedAt?.toDate?.() ?? null;
};
const VALID_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'dineOut', 'home', 'subscriptions', 'contributions'];

export default function BucketDrillDownPage() {
  const router = useRouter();
  const params = useParams<{ module: string }>();
  const moduleParam = (params?.module as string) ?? '';
  const moduleKey = (VALID_MODULES.includes(moduleParam as PurchaseModule) ? moduleParam : 'pantry') as PurchaseModule;
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const thisMonth = monthKeyOf();

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
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

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const cap = ((family?.householdBudgets ?? {}) as Record<string, number | undefined>)[moduleKey] ?? 0;

  // CASH spend this month for this module + per-day series.
  const { spent, byDay } = useMemo(() => {
    const series: number[] = Array(daysInMonth + 1).fill(0); // 1-indexed
    let total = 0;
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      if ((r.module ?? 'pantry') !== moduleKey) continue;
      if (budgetMonthKeyFor(r) !== thisMonth) continue;   // payroll → work-period month
      const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
      total += cents;
      const d = countDateOf(r)?.getDate() ?? 0;
      if (d >= 1 && d <= daysInMonth) series[d] += cents;
    }
    return { spent: total, byDay: series };
  }, [recent, moduleKey, thisMonth, daysInMonth]);

  const avgPerDay = dayOfMonth > 0 ? Math.round(spent / dayOfMonth) : 0;
  const projected = projectMonthSpendCents(spent, dayOfMonth, daysInMonth);
  const pace = pacing(spent, cap, dayOfMonth, daysInMonth);
  const savings = cap - projected;
  const overBy = projected - cap;

  // Daily bars: actual for elapsed days, flat run-rate for the rest.
  const chart = useMemo(() => {
    const bars: { day: number; cents: number; projected: boolean }[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      if (d <= dayOfMonth) bars.push({ day: d, cents: byDay[d] ?? 0, projected: false });
      else bars.push({ day: d, cents: avgPerDay, projected: true });
    }
    const max = Math.max(1, ...bars.map((b) => b.cents));
    return bars.map((b) => ({ ...b, pct: Math.round((b.cents / max) * 100) }));
  }, [byDay, avgPerDay, dayOfMonth, daysInMonth]);

  // Closed transactions in this bucket this month — feeds the new
  // tap-to-drill list at the bottom of the page (→ /pulse/txn/[id]).
  const txns = useMemo(() => {
    const out: PurchaseRequest[] = [];
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      if ((r.module ?? 'pantry') !== moduleKey) continue;
      if (budgetMonthKeyFor(r) !== thisMonth) continue;   // payroll → work-period month
      out.push(r);
    }
    return out.sort((a, b) => (b.closedAt?.toMillis?.() ?? 0) - (a.closedAt?.toMillis?.() ?? 0));
  }, [recent, moduleKey, thisMonth]);

  // Metered trackables in this module (consumption lens for context).
  const metered = useMemo(() => {
    const tks = trackables.filter((t) => t.module === moduleKey);
    const cost: Record<string, number> = {};
    for (const r of readings) cost[r.trackableId] = (cost[r.trackableId] ?? 0) + (r.deltaCost ?? 0);
    return tks
      .map((t) => ({ t, cents: cost[t.id] ?? 0 }))
      .sort((a, b) => b.cents - a.cents);
  }, [trackables, readings, moduleKey]);

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  const paceTone =
    pace.flag === 'over' ? 'text-pulse-coral'
    : pace.flag === 'behind' ? 'text-[#B58A2F]'
    : pace.flag === 'on_track' ? 'text-pulse-green'
    : 'text-hive-muted';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseBreadcrumb trail={[]} current={MODULE_LABEL[moduleKey]} />
      <PulseHeader
        eyebrow="Budget bucket"
        title={`${MODULE_EMOJI[moduleKey]} ${MODULE_LABEL[moduleKey]}`}
        subtitle="Cash spend · this month"
      />

      {/* Hero — spend vs cap + run-rate */}
      <div className="mt-4">
        <PulseHero>
          <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Spent this month</div>
          <div className="text-3xl font-nunito font-black mt-1">
            {formatCents(spent, currency)}
            <span className="text-sm opacity-80 font-bold"> / {cap > 0 ? formatCents(cap, currency) : '—'}</span>
          </div>
          <div className="text-[12px] opacity-90 mt-1">
            avg {formatCents(avgPerDay, currency)}/day · Day {dayOfMonth}/{daysInMonth}
          </div>
          {cap > 0 && (
            <>
              <div className="h-2 bg-white/20 rounded-full mt-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pace.capPct)}%`, background: '#D4A847' }} />
              </div>
              <div className="flex justify-between text-[10px] font-black mt-2 opacity-90">
                <span>{pace.capPct}% of cap</span>
                <span>{pace.monthPct}% of month</span>
              </div>
            </>
          )}
        </PulseHero>
      </div>

      {/* Daily trend + projection */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl p-4 mt-3 shadow-[0_4px_16px_rgba(15,31,68,0.06)]">
        <div className="text-[11px] font-nunito font-black text-pulse-navy mb-2">Daily spend + projection</div>
        {spent === 0 ? (
          <p className="text-hive-muted text-sm py-6 text-center">No closed spend in {MODULE_LABEL[moduleKey]} yet this month.</p>
        ) : (
          <>
            <div className="flex items-end gap-[2px] h-24">
              {chart.map((b) => (
                <div
                  key={b.day}
                  title={`Day ${b.day} · ${formatCents(b.cents, currency)}${b.projected ? ' (projected)' : ''}`}
                  className="flex-1 rounded-t"
                  style={{
                    height: `${Math.max(2, b.pct)}%`,
                    minHeight: '2px',
                    background: b.projected ? 'repeating-linear-gradient(45deg,#D4A84766,#D4A84766 2px,transparent 2px,transparent 4px)' : '#D4A847',
                    border: b.projected ? '1px solid #D4A84799' : 'none',
                  }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-hive-muted font-bold mt-1">
              <span>solid = actual</span>
              <span>hatched = projected</span>
            </div>
          </>
        )}
      </div>

      {/* Savings potential (run-rate) */}
      {cap > 0 && (
        <div className="bg-[#f3faf6] border border-[#bfe0d0] rounded-2xl p-4 mt-3">
          <div className="text-[9px] font-black uppercase tracking-[1px] text-pulse-green">Savings potential</div>
          <div className="text-[13px] text-pulse-navy font-bold mt-1 leading-snug">
            {savings >= 0 ? (
              <>At this pace you&apos;ll spend <b>{formatCents(projected, currency)}</b> — under your {formatCents(cap, currency)} cap, on track to save <b>{formatCents(savings, currency)}</b> for Kaya Wealth.</>
            ) : (
              <>At this pace you&apos;ll hit <b>{formatCents(projected, currency)}</b> — {Math.round((overBy / cap) * 100)}% over your {formatCents(cap, currency)} cap. Trimming <b>≈ {formatCents(overBy, currency)}/mo</b> gets you back on track.</>
            )}
          </div>
          <div className={`text-[11px] font-black mt-2 ${paceTone}`}>● {pacingLabel(pace.flag)}</div>
        </div>
      )}

      {/* Transactions this month — tap a row for the full receipt + AI insight (PR 2 + PR 3). */}
      {txns.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-5 mb-2">
            <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px]">Transactions · {txns.length}</div>
            <span className="text-[10px] text-hive-muted font-bold">tap to drill</span>
          </div>
          <div className="flex flex-col gap-2">
            {txns.map((t) => {
              const at = t.closedAt?.toDate?.();
              const dayKey = at ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}` : '';
              const cents = t.actualTotalCents ?? t.estimatedTotalCents ?? 0;
              return (
                <Link
                  key={t.id}
                  href={`/pulse/txn/${t.id}`}
                  className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center gap-3 no-underline hover:bg-pulse-cream/40"
                >
                  <div className="w-11 shrink-0 text-center">
                    <div className="font-nunito font-black text-pulse-navy text-base leading-none">{at ? at.getDate() : '?'}</div>
                    <div className="text-[8.5px] font-black tracking-[0.5px] text-hive-muted uppercase mt-0.5">{at ? at.toLocaleDateString('en-US', { month: 'short' }) : ''}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-black text-sm text-pulse-navy truncate">{t.name || (dayKey ? toDisplayDate(dayKey) : 'Purchase')}</div>
                    <div className="text-[10.5px] text-hive-muted font-bold">
                      {(t.items?.length ?? 0) > 0 && <span>{t.items.length} item{t.items.length === 1 ? '' : 's'}</span>}
                      {t.receiptUrl && <span> · 🧾</span>}
                      {t.createdByRole === 'helper' && <span> · helper</span>}
                    </div>
                  </div>
                  <div className="text-[13px] font-black text-pulse-navy shrink-0">{formatCents(cents, currency)}</div>
                  <span className="text-pulse-gold-dk text-sm shrink-0">›</span>
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* Metered trackables (consumption lens) */}
      <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px] mt-5 mb-2">Metered in this bucket</div>
      {metered.length === 0 ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-4 text-center text-[12px] text-hive-muted">
          No meters mapped to {MODULE_LABEL[moduleKey]}. Add one in{' '}
          <Link href="/pulse/admin" className="text-pulse-gold-dk font-bold underline">Task setup</Link> to see usage trends here.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {metered.map(({ t, cents }) => (
            <Link key={t.id} href={`/pulse/trackable/${t.id}`} className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center justify-between no-underline hover:bg-pulse-cream/40">
              <span className="font-bold text-pulse-navy text-[13px]">{t.emoji} {t.name}</span>
              <span className="font-nunito font-black text-pulse-navy text-[13px]">{formatCents(cents, currency)} ›</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
