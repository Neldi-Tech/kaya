'use client';

// /pulse — Kaya Pulse · Family Dashboard (Premium, parent default).
//
// Two money lenses, deliberately separate (never summed):
//   • CASH      — closed purchaseRequests this month vs householdBudgets caps.
//                 This is the savings basis (what feeds Kaya Wealth).
//   • CONSUMPTION — metered cost from readings (usage × price). The Pulse
//                 intelligence layer that spots spikes early.
// Kids/helpers are redirected to their Today feed.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { subscribeToSpendLedger, type SpendLedgerEntry } from '@/lib/spendLedger';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { PulseHeader, PulseHero } from '@/components/pulse/ui';
import AskKaya from '@/components/pulse/AskKaya';
import {
  type PulseReading, type Trackable,
  subscribeToReadingsInMonth, subscribeToTrackables,
  projectMonthSpendCents,
} from '@/lib/pulse';
import { dayKeyInTZ, toDisplayDate } from '@/lib/dates';

// Cash lens covers all 9 Household buckets. Subscriptions + Contributions
// come from spend_ledger (server-written when a sub cycle is marked paid
// or a contribution is logged); the other 7 come from purchaseRequests.
const LIVE_MODULES: PurchaseModule[] = [
  'pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'dineOut', 'home',
  'subscriptions', 'contributions',
];
const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// Daily scrubber — the new Daily card on top of Metered Consumption lets a
// parent step backwards a day at a time, or tap the date label to pop the
// native calendar and jump straight to a past day. We cap how far back you can
// scrub so we don't pull arbitrary months into memory.
const PULSE_TZ = 'Africa/Dar_es_Salaam';
const SCRUB_MAX_DAYS = 90;                 // ~3 months back
const monthOfDayKey = (dayKey: string) => dayKey.slice(0, 7);
const prevMonth = (mk: string): string => {
  const [y, m] = mk.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const todayDayKey = () => dayKeyInTZ(new Date(), PULSE_TZ);
/** N days before the day-key, returned as a fresh YYYY-MM-DD. */
const shiftDayKey = (dayKey: string, delta: number): string => {
  const [y, m, d] = dayKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};

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
  const [ledger, setLedger] = useState<SpendLedgerEntry[]>([]);
  const [readings, setReadings] = useState<PulseReading[]>([]);
  const [trackables, setTrackables] = useState<Trackable[]>([]);
  // Daily scrubber state + cache of readings from previous months that the
  // user has scrubbed into (keyed by YYYY-MM).
  const today = useMemo(() => todayDayKey(), []);
  const minScrubDay = useMemo(() => shiftDayKey(today, -SCRUB_MAX_DAYS), [today]);
  const [selectedDay, setSelectedDay] = useState<string>(today);
  const [extraMonth, setExtraMonth] = useState<Record<string, PulseReading[]>>({});
  // Track active month subscriptions so we don't double-subscribe on re-renders.
  const monthSubsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const u1 = subscribeToRecentRequests(profile.familyId, setRecent);
    const u2 = subscribeToReadingsInMonth(profile.familyId, thisMonth, setReadings);
    const u3 = subscribeToTrackables(profile.familyId, setTrackables);
    const u4 = subscribeToSpendLedger(profile.familyId, setLedger);
    return () => { u1(); u2(); u3(); u4(); };
  }, [profile?.familyId, profile?.role, thisMonth]);

  // Lazily subscribe to a previous month's readings when the user scrubs into
  // it. We never tear these down — once cached, the data stays for the rest of
  // the session, capped by SCRUB_MAX_DAYS, so the cache stays small (≤ 3 months).
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const m = monthOfDayKey(selectedDay);
    if (m === thisMonth) return;
    if (monthSubsRef.current.has(m)) return;
    monthSubsRef.current.add(m);
    const u = subscribeToReadingsInMonth(profile.familyId, m, (rs) => {
      setExtraMonth((prev) => ({ ...prev, [m]: rs }));
    });
    // We intentionally don't unsubscribe — the cache persists for the session
    // so back-and-forth scrubbing stays instant. (Cap = SCRUB_MAX_DAYS.)
    return () => { /* keep the sub alive; clean up on page unmount via React's GC of refs */
      // best-effort: drop the sub if the component truly unmounts
      u();
      monthSubsRef.current.delete(m);
    };
  }, [profile?.familyId, profile?.role, selectedDay, thisMonth]);

  // CASH lens.
  const cash = useMemo(() => {
    const per: Record<string, { spent: number; cap: number }> = {};
    LIVE_MODULES.forEach((m) => { per[m] = { spent: 0, cap: 0 }; });
    // purchaseRequests → 7 existing modules
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      if (per[m]) per[m].spent += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    // spend_ledger → subscriptions + contributions. Professional-tagged
    // entries are excluded per spec §5 (work expenses, not household).
    for (const e of ledger) {
      if (e.isProfessionalExpense) continue;
      const at = e.occurredOn?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      const m = e.sourceModule as PurchaseModule;
      if (per[m]) per[m].spent += e.amountHousehold || 0;
    }
    const budgets = (family?.householdBudgets ?? {}) as Record<string, number | undefined>;
    LIVE_MODULES.forEach((m) => { per[m].cap = budgets[m] ?? 0; });
    const totalSpent = LIVE_MODULES.reduce((s, m) => s + per[m].spent, 0);
    const totalCap = LIVE_MODULES.reduce((s, m) => s + per[m].cap, 0);
    return { per, totalSpent, totalCap };
  }, [recent, ledger, family?.householdBudgets, thisMonth]);

  // CONSUMPTION lens (monthly).
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

  // CONSUMPTION lens (daily — for the scrubber). Reads from `readings` when
  // the selected day is in `thisMonth`, otherwise from the lazily-cached
  // previous-month bucket. Spike flag is row-level so the UI can decorate.
  const daily = useMemo(() => {
    const m = monthOfDayKey(selectedDay);
    const src = m === thisMonth ? readings : (extraMonth[m] ?? []);
    const dayReads = src.filter((r) => r.dayKey === selectedDay);
    const byTrackable: Record<string, { cents: number; anomaly: boolean }> = {};
    let total = 0;
    for (const r of dayReads) {
      if (!byTrackable[r.trackableId]) byTrackable[r.trackableId] = { cents: 0, anomaly: false };
      byTrackable[r.trackableId].cents += r.deltaCost ?? 0;
      if (r.isAnomaly) byTrackable[r.trackableId].anomaly = true;
      total += r.deltaCost ?? 0;
    }
    const rows = Object.entries(byTrackable)
      .map(([id, v]) => ({ id, cents: v.cents, anomaly: v.anomaly, tk: trackables.find((t) => t.id === id) }))
      .sort((a, b) => b.cents - a.cents);
    return { rows, total, hasReadings: dayReads.length > 0, loadingMonth: m !== thisMonth && !extraMonth[m] };
  }, [selectedDay, thisMonth, readings, extraMonth, trackables]);

  // Day-scrub controls. Stepping past today or before SCRUB_MAX_DAYS is a
  // no-op so the buttons stay UI-disabled instead of throwing.
  const canStepBack = selectedDay > minScrubDay;
  const canStepForward = selectedDay < today;
  const stepDay = (delta: number) => {
    const next = shiftDayKey(selectedDay, delta);
    if (next > today || next < minScrubDay) return;
    setSelectedDay(next);
  };
  const dayLabel = (k: string): string => {
    if (k === today) return 'Today';
    if (k === shiftDayKey(today, -1)) return 'Yesterday';
    const [y, mo, d] = k.split('-').map(Number);
    const dow = new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'short' });
    return `${dow}, ${toDisplayDate(k)}`;
  };
  const daysAgo = (k: string): number => {
    const a = new Date(`${today}T00:00:00`);
    const b = new Date(`${k}T00:00:00`);
    return Math.round((a.getTime() - b.getTime()) / 86400000);
  };

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  const { totalSpent, totalCap, per } = cash;
  const pct = totalCap > 0 ? Math.min(100, Math.round((totalSpent / totalCap) * 100)) : 0;
  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  // Run-rate: scale spend-so-far to the full month, then project savings
  // vs cap (replaces the naive cap−spent, which over-promised early in
  // the month). §2a.
  const projectedSpend = projectMonthSpendCents(totalSpent, dayOfMonth, daysInMonth);
  const projectedSavings = totalCap - projectedSpend;

  // Top 5 by spend, then always append Subs + Contribs if they have a
  // cap or spend (2026-05-27 — keeps Subscriptions / Contributions
  // visible in this preview even when the top-5 spenders crowd them
  // out). Empty subs/contribs (no cap, no spend) still stay hidden.
  const rawBuckets = LIVE_MODULES
    .map((m) => ({ m, ...per[m] }))
    .filter((b) => b.spent > 0 || b.cap > 0)
    .sort((a, b) => b.spent - a.spent);
  const topFive = rawBuckets.slice(0, 5);
  const extras = (['subscriptions', 'contributions'] as PurchaseModule[])
    .map((m) => rawBuckets.find((b) => b.m === m))
    .filter((b): b is typeof rawBuckets[number] => !!b && !topFive.some((t) => t.m === b.m));
  const buckets = [...topFive, ...extras];

  // Pre-formatted facts for the "Ask Kaya" advisor (display strings only —
  // no PII). Cash buckets + run-rate + top metered consumption.
  const anomalyCount = readings.filter((r) => r.isAnomaly).length;
  const askKayaFacts: Record<string, string | number> = {
    'Total spent vs cap': `${formatCents(totalSpent, currency)} / ${totalCap > 0 ? formatCents(totalCap, currency) : 'no cap'}`,
    'Projected month-end (run-rate)': formatCents(projectedSpend, currency),
    'Pace': projectedSavings >= 0
      ? `on track to save ${formatCents(projectedSavings, currency)}`
      : `trending ${formatCents(-projectedSavings, currency)} over cap`,
    'Day of month': `${dayOfMonth} of ${daysInMonth}`,
  };
  for (const b of buckets) {
    const bpct = b.cap > 0 ? Math.round((b.spent / b.cap) * 100) : null;
    askKayaFacts[`Bucket · ${MODULE_LABEL[b.m]}`] =
      `${formatCents(b.spent, currency)}${b.cap > 0 ? ` / ${formatCents(b.cap, currency)} (${bpct}% used)` : ' (no cap)'}`;
  }
  for (const row of consumption.rows.slice(0, 5)) {
    askKayaFacts[`Metered · ${row.tk?.name ?? 'trackable'}`] = formatCents(row.cents, currency);
  }
  if (anomalyCount > 0) askKayaFacts['Spikes flagged this month'] = anomalyCount;

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
                {projectedSavings >= 0
                  ? `On track to save ${formatCentsBudgetNeat(projectedSavings, currency)}`
                  : `Trending ${formatCentsBudgetNeat(-projectedSavings, currency)} over cap`}
                <span className="opacity-70"> · run-rate</span>
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

      {/* Ask Kaya — on-demand AI advisor (parent-only; this whole page is) */}
      {profile?.familyId && (
        <AskKaya
          familyId={profile.familyId}
          monthKey={thisMonth}
          monthLabel={monthLabel()}
          currency={currency}
          facts={askKayaFacts}
        />
      )}

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
              <Link key={b.m} href={`/pulse/bucket/${b.m}`} className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center gap-3 no-underline hover:bg-pulse-cream/40">
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
                <span className="text-pulse-gold-dk text-sm">›</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Metered consumption — Pulse lens */}
      <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px] mt-6 mb-2">Metered consumption</div>
      {consumption.rows.length === 0 && Object.keys(extraMonth).length === 0 ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center text-sm text-hive-muted">
          No readings yet this month. Set up trackables + tasks in{' '}
          <Link href="/pulse/admin" className="text-pulse-gold-dk font-bold underline">Task setup</Link>.
        </div>
      ) : (
        <>
          {/* Daily card with day-scrubber. Tap the date label to pop the native
              calendar (an invisible <input type="date"> overlays the label so
              iOS / Android show their own picker). */}
          <div className="bg-white border-2 border-pulse-gold/60 rounded-2xl p-3 mb-2">
            <div className="flex items-center justify-between gap-2 mb-3">
              <button
                type="button"
                onClick={() => stepDay(-1)}
                disabled={!canStepBack}
                aria-label="Previous day"
                className="w-7 h-7 rounded-full bg-white border border-pulse-gold/60 text-pulse-navy flex items-center justify-center text-[14px] font-extrabold disabled:opacity-30 disabled:cursor-not-allowed"
              >‹</button>
              <div className="flex-1 text-center relative">
                <div className="font-nunito font-black text-[12.5px] text-pulse-navy">{dayLabel(selectedDay)}</div>
                <div className="text-[10px] text-hive-muted font-bold mt-0.5">
                  {selectedDay === today ? (
                    <span>{toDisplayDate(selectedDay)}</span>
                  ) : (
                    <>
                      <span>{daysAgo(selectedDay)} {daysAgo(selectedDay) === 1 ? 'day' : 'days'} ago · </span>
                      <button type="button" onClick={() => setSelectedDay(today)} className="text-pulse-gold-dk font-extrabold">Today</button>
                    </>
                  )}
                </div>
                <input
                  type="date"
                  value={selectedDay}
                  min={minScrubDay}
                  max={today}
                  onChange={(e) => { if (e.target.value) setSelectedDay(e.target.value); }}
                  aria-label="Pick a date"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
              </div>
              <button
                type="button"
                onClick={() => stepDay(1)}
                disabled={!canStepForward}
                aria-label="Next day"
                className="w-7 h-7 rounded-full bg-white border border-pulse-gold/60 text-pulse-navy flex items-center justify-center text-[14px] font-extrabold disabled:opacity-30 disabled:cursor-not-allowed"
              >›</button>
            </div>

            {daily.loadingMonth ? (
              <p className="text-[12px] text-hive-muted text-center py-3">Loading {selectedDay.slice(0, 7)}…</p>
            ) : daily.hasReadings ? (
              <>
                <div className="flex justify-between items-baseline mb-2">
                  <span className="text-[11px] text-hive-muted font-bold">This day&apos;s metered cost</span>
                  <span className="font-nunito font-black text-pulse-navy">{formatCents(daily.total, currency)}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {daily.rows.map((row) => (
                    <Link key={row.id} href={`/pulse/trackable/${row.id}`} className="flex items-center justify-between text-[12px] no-underline">
                      <span className="font-bold text-pulse-navy">{row.tk?.emoji ?? '📊'} {row.tk?.name ?? 'Trackable'}</span>
                      <span className="font-nunito font-black text-pulse-navy">
                        {formatCents(row.cents, currency)}
                        {row.anomaly && <span className="ml-1.5 inline-block px-1.5 py-[1px] rounded-full bg-pulse-coral/10 text-pulse-coral text-[9.5px] font-extrabold align-middle">spike</span>}
                        {' ›'}
                      </span>
                    </Link>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-[12px] text-hive-muted text-center py-3">No readings logged on this day.</p>
            )}
          </div>

          {/* Monthly card — the at-a-glance budget number. */}
          {consumption.rows.length > 0 && (
            <div className="bg-white border border-pulse-gold/30 rounded-2xl p-3">
              <div className="flex justify-between items-baseline mb-2">
                <span className="text-[11px] text-hive-muted font-bold">This month&apos;s metered cost</span>
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
                Consumption telemetry (usage × price) — kept separate from cash spend above; it&apos;s how Pulse catches spikes early.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
