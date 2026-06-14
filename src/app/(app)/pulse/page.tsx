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
  type PulseReading, type Trackable, type PulseTask,
  subscribeToReadingsInMonth, subscribeToTrackables, subscribeToTasksForDay, resolveAssist,
  projectMonthSpendCents,
} from '@/lib/pulse';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';
import { dayKeyInTZ, toDisplayDate, relativeDayLabel } from '@/lib/dates';

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
const labelForDayKey = (k: string) => {
  const [y, m, d] = k.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return `${d} ${dt.toLocaleDateString('en-US', { month: 'short' })}`;
};
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
  const { family, children } = useFamily();
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
  // Parent oversight: every reader's reading tasks for today + helper names
  // (kid names come from the family context) so we can show who's logged what.
  const [tasksToday, setTasksToday] = useState<PulseTask[]>([]);
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  const [assistBusy, setAssistBusy] = useState('');   // taskId being approved/rejected
  // v2 tab strip — Overview keeps cash/savings/readings/buckets; Metered hosts
  // the metered consumption section (was previously stacked at the bottom).
  const [activeTab, setActiveTab] = useState<'overview' | 'metered'>('overview');

  const onResolveAssist = async (taskId: string, action: 'approve' | 'reject') => {
    if (!profile?.familyId || assistBusy) return;
    setAssistBusy(taskId);
    try { await resolveAssist(profile.familyId, taskId, action, profile.uid); }
    finally { setAssistBusy(''); }
    // tasksToday is realtime → the row updates itself on the status change.
  };
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
    const u5 = subscribeToTasksForDay(profile.familyId, today, setTasksToday);
    listHelpers(profile.familyId).then(setHelpers).catch(() => {});
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [profile?.familyId, profile?.role, thisMonth, today]);

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

  // v2 — LAST MONTH lens for the vs-LM compare chips + hero ghost-line.
  // Uses the already-subscribed `recent` (no time bound) + `ledger` (200 most
  // recent). Same shape as `cash`, plus a per-bucket cumulative-by-day series
  // so we can read "spent up to day-of-month N" for the hero ghost-line +
  // bucket compare chips. No extra subscriptions = no schema/query churn.
  const lastMonthKey = useMemo(() => prevMonth(thisMonth), [thisMonth]);
  const lastMonthDaysInMonth = useMemo(() => {
    const [y, m] = lastMonthKey.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }, [lastMonthKey]);
  const lastMonthCash = useMemo(() => {
    const per: Record<string, { spent: number; byDay: number[] }> = {};
    LIVE_MODULES.forEach((m) => { per[m] = { spent: 0, byDay: Array(lastMonthDaysInMonth + 1).fill(0) }; });
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== lastMonthKey) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      if (!per[m]) continue;
      const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
      per[m].spent += cents;
      const d = at.getDate();
      if (d >= 1 && d <= lastMonthDaysInMonth) per[m].byDay[d] += cents;
    }
    for (const e of ledger) {
      if (e.isProfessionalExpense) continue;
      const at = e.occurredOn?.toDate?.();
      if (!at || monthKeyOf(at) !== lastMonthKey) continue;
      const m = e.sourceModule as PurchaseModule;
      if (!per[m]) continue;
      const cents = e.amountHousehold || 0;
      per[m].spent += cents;
      const d = at.getDate();
      if (d >= 1 && d <= lastMonthDaysInMonth) per[m].byDay[d] += cents;
    }
    const totalSpent = LIVE_MODULES.reduce((s, m) => s + per[m].spent, 0);
    // Cumulative-by-day (1..N) for the whole house.
    const totalByDay: number[] = Array(lastMonthDaysInMonth + 1).fill(0);
    let run = 0;
    for (let d = 1; d <= lastMonthDaysInMonth; d++) {
      run += LIVE_MODULES.reduce((s, m) => s + per[m].byDay[d], 0);
      totalByDay[d] = run;
    }
    return { per, totalSpent, totalByDay };
  }, [recent, ledger, lastMonthKey, lastMonthDaysInMonth]);

  // Per-bucket cumulative spend up to "same day-of-month" last month — the
  // value the compare chips read against this-month spend.
  const lastMonthSameDay = useMemo(() => {
    const dom = new Date().getDate();
    const cap = Math.min(dom, lastMonthDaysInMonth);
    const out: Record<string, number> = {};
    let total = 0;
    for (const m of LIVE_MODULES) {
      let v = 0;
      for (let d = 1; d <= cap; d++) v += lastMonthCash.per[m].byDay[d] ?? 0;
      out[m] = v;
      total += v;
    }
    return { per: out, total };
  }, [lastMonthCash, lastMonthDaysInMonth]);

  // Last-7-days sparkline data per bucket (rolling — includes the bridge into
  // last month). Reads `recent` + `ledger`; index 0 = oldest, index 6 = today.
  const sparkByBucket = useMemo(() => {
    const today = new Date();
    const day7keys: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      day7keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    }
    const out: Record<string, number[]> = {};
    LIVE_MODULES.forEach((m) => { out[m] = Array(7).fill(0); });
    const keyFor = (at: Date) => `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      const at = r.closedAt?.toDate?.();
      if (!at) continue;
      const k = keyFor(at);
      const i = day7keys.indexOf(k);
      if (i < 0) continue;
      const m = (r.module ?? 'pantry') as PurchaseModule;
      if (out[m]) out[m][i] += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    for (const e of ledger) {
      if (e.isProfessionalExpense) continue;
      const at = e.occurredOn?.toDate?.();
      if (!at) continue;
      const k = keyFor(at);
      const i = day7keys.indexOf(k);
      if (i < 0) continue;
      const m = e.sourceModule as PurchaseModule;
      if (out[m]) out[m][i] += e.amountHousehold || 0;
    }
    return out;
  }, [recent, ledger]);

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

  // 14-day metered trend — daily total cost for the bar chart on the Metered
  // tab. Bridges back into last month if today is day < 14. Spike flag = any
  // reading that day was tagged anomaly. Uses `readings` (this month) +
  // `extraMonth` (any previously-scrubbed cached month).
  const metered14 = useMemo(() => {
    const today = new Date();
    const days: { key: string; total: number; anomaly: boolean }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      days.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
        total: 0,
        anomaly: false,
      });
    }
    const idx: Record<string, number> = {};
    days.forEach((d, i) => { idx[d.key] = i; });
    const ingest = (rs: PulseReading[]) => {
      for (const r of rs) {
        const i = idx[r.dayKey];
        if (i === undefined) continue;
        days[i].total += r.deltaCost ?? 0;
        if (r.isAnomaly) days[i].anomaly = true;
      }
    };
    ingest(readings);
    Object.values(extraMonth).forEach(ingest);
    return days;
  }, [readings, extraMonth]);

  // Latest reading per trackable (from this month's readings) → powers the
  // at-a-glance "last entry" line on each metered row (balance/reading + when).
  const latestByTrackable = useMemo(() => {
    const out: Record<string, PulseReading> = {};
    for (const r of readings) {
      const cur = out[r.trackableId];
      if (!cur || (r.capturedAt?.toMillis?.() ?? 0) > (cur.capturedAt?.toMillis?.() ?? 0)) out[r.trackableId] = r;
    }
    return out;
  }, [readings]);

  // "60 kWh left · 2 days ago" for depleting meters, "4,210 kWh · today" for
  // cumulative ones. Empty when there's no reading this month.
  const lastEntryLine = (trackableId: string): string | null => {
    const r = latestByTrackable[trackableId];
    if (!r || !Number.isFinite(r.value)) return null;
    const tk = trackables.find((t) => t.id === trackableId);
    const unit = tk?.unit ? ` ${tk.unit}` : '';
    const left = tk?.direction === 'down' ? ' left' : '';
    return `${r.value.toLocaleString()}${unit}${left} · ${relativeDayLabel(r.dayKey)}`;
  };

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

  // Parent oversight of TODAY's readings — who's logged, what's still pending
  // or missed. Resolves each task's owner name (kid via family context, helper
  // via the helper list) + the trackable's name/emoji. 'review'/'logged'/
  // 'closed' all count as filled; 'pending'/'missed' are what a parent can log.
  const readingsOversight = useMemo(() => {
    const kidName = (id?: string) => children.find((c) => c.id === id)?.name ?? 'Kid';
    const helperName = (uid?: string) => helpers.find((h) => h.uid === uid)?.displayName ?? 'Helper';
    const nameFor = (t: PulseTask): string => (t.ownerKind === 'kid' ? kidName(t.ownerId) : helperName(t.ownerId));
    const rows = tasksToday.map((t) => {
      const tk = trackables.find((x) => x.id === t.trackableId);
      // A helper-assist submission sits at 'review' with assistLoggedBy set —
      // it needs a parent to approve. (An anomaly 'review' has no assistLoggedBy
      // and is already logged, so it counts as done here.)
      const isAssistReview = t.status === 'review' && !!t.assistLoggedBy;
      return {
        id: t.id,
        name: tk?.name ?? 'Reading',
        emoji: tk?.emoji ?? '📊',
        unit: tk?.unit ?? '',
        owner: nameFor(t),
        isAssistReview,
        assistBy: isAssistReview ? helperName(t.assistLoggedBy) : '',
        proposed: t.assistProposedValue,
        done: t.status === 'logged' || t.status === 'closed' || (t.status === 'review' && !isAssistReview),
        missed: t.status === 'missed',
      };
    });
    return {
      total: rows.length,
      unfilled: rows.filter((r) => !r.done && !r.isAssistReview),
      pendingApproval: rows.filter((r) => r.isAssistReview),
      loggedCount: rows.filter((r) => r.done).length,
      missedCount: rows.filter((r) => r.missed).length,
    };
  }, [tasksToday, trackables, children, helpers]);

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

      {/* v2 — Tab strip. Overview is the default cash/savings view; Metered
          carries the consumption section that used to stack below it. */}
      <div className="mt-3 flex bg-white border border-pulse-gold/30 rounded-2xl p-1">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-2 rounded-xl font-nunito font-black text-[12px] ${activeTab === 'overview' ? 'bg-pulse-navy text-pulse-gold' : 'text-hive-muted'}`}
        >📊 Overview</button>
        <button
          type="button"
          onClick={() => setActiveTab('metered')}
          className={`flex-1 py-2 rounded-xl font-nunito font-black text-[12px] ${activeTab === 'metered' ? 'bg-pulse-navy text-pulse-gold' : 'text-hive-muted'}`}
        >⚡ Metered</button>
      </div>

      {activeTab === 'overview' && (
      <>
      {/* Hero — cash lens (savings basis). Clickable → /pulse/breakdown for
          the composition drill-down (PR 2). */}
      <div className="mt-4">
        <Link href="/pulse/breakdown" className="block no-underline">
        <PulseHero>
          <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Spent this month</div>
          <span className="text-[9px] font-black uppercase tracking-[0.4px] bg-pulse-gold/20 text-pulse-gold px-2 py-0.5 rounded-full">→ tap to drill</span>
          </div>
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
              {/* Bar with ghost-tick at last-month-same-day pace */}
              <div className="relative h-2 bg-white/20 rounded-full mt-3 overflow-visible">
                <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#D4A847' }} />
                {totalCap > 0 && lastMonthSameDay.total > 0 && (() => {
                  const ghostPct = Math.min(100, Math.round((lastMonthSameDay.total / totalCap) * 100));
                  return (
                    <>
                      <div
                        className="absolute top-[-3px] bottom-[-3px] w-[2.5px] rounded-sm bg-white/55"
                        style={{ left: `${ghostPct}%` }}
                        aria-hidden="true"
                      />
                      <div
                        className="absolute -top-[14px] text-[8.5px] font-black tracking-[0.4px] uppercase opacity-60 whitespace-nowrap pointer-events-none"
                        style={{ left: `${ghostPct}%`, transform: 'translateX(-50%)' }}
                        aria-hidden="true"
                      >Last month · day {Math.min(dayOfMonth, lastMonthDaysInMonth)}</div>
                    </>
                  );
                })()}
              </div>
              <div className="flex justify-between text-[10px] font-black mt-2 opacity-90">
                <span>{pct}% of cap</span>
                <span>Day {dayOfMonth} / {daysInMonth}</span>
              </div>
              {/* Delta chip — only when last month has data at this point. */}
              {lastMonthSameDay.total > 0 && (() => {
                const delta = totalSpent - lastMonthSameDay.total;
                const ahead = delta < 0;
                const abs = Math.abs(delta);
                return (
                  <div className={`inline-block mt-2 px-2.5 py-1 rounded-full text-[10px] font-black tracking-[0.3px] ${ahead ? 'bg-pulse-green/25 text-[#B5E5B8]' : 'bg-pulse-coral/25 text-[#FAB8B8]'}`}>
                    {ahead ? '▼' : '▲'} {formatCentsBudgetNeat(abs, currency)} {ahead ? 'less' : 'more'} than last month at day {Math.min(dayOfMonth, lastMonthDaysInMonth)}
                  </div>
                );
              })()}
            </>
          ) : (
            <div className="text-[12px] opacity-90 mt-1">
              Set caps in <Link href="/pantry/budget" className="underline">Budget</Link> to track savings.
            </div>
          )}
        </PulseHero>
        </Link>
      </div>

      {/* Compare card — narrated vs-last-month line, only when last month had spend. */}
      {lastMonthSameDay.total > 0 && lastMonthCash.totalSpent > 0 && (() => {
        const lmProjected = projectMonthSpendCents(lastMonthSameDay.total, dayOfMonth, lastMonthDaysInMonth);
        const thisProjected = projectedSpend;
        const saveDelta = lmProjected - thisProjected; // positive → saving more this month
        const ahead = saveDelta > 0;
        return (
          <div className="mt-3 bg-white border border-pulse-gold/30 rounded-2xl px-3 py-2.5">
            <div className="text-[10px] font-black tracking-[1.4px] uppercase text-pulse-gold-dk mb-1">🧭 vs {monthLabel(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1))}</div>
            <div className="text-[11.5px] font-bold text-pulse-navy leading-snug">
              Day {Math.min(dayOfMonth, lastMonthDaysInMonth)} last month: <span className="font-black">{formatCentsBudgetNeat(lastMonthSameDay.total, currency)}</span> spent · projected <span className="font-black">{formatCentsBudgetNeat(lmProjected, currency)}</span>.
            </div>
            {Math.abs(saveDelta) > 0 && (
              <div className="text-[11.5px] font-bold text-pulse-navy leading-snug mt-0.5">
                This month: <span className={`font-black ${ahead ? 'text-pulse-green' : 'text-pulse-coral'}`}>{ahead ? '+' : '−'} {formatCentsBudgetNeat(Math.abs(saveDelta), currency)} {ahead ? 'ahead on savings' : 'behind on savings'}</span> at the same point.
              </div>
            )}
          </div>
        );
      })()}

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

      {/* 📊 Readings today — parent oversight. Shows who's logged what; any
          pending/missed reading can be logged here on the reader's behalf so
          nothing goes unrecorded (the reader still gets the credit when THEY
          log; a parent log is attributed to the parent, no kid points). */}
      {readingsOversight.total > 0 && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px]">📊 Readings today</div>
            <span className="text-[10px] font-bold text-hive-muted">
              {readingsOversight.loggedCount}/{readingsOversight.total} logged
              {readingsOversight.missedCount > 0 && <span className="text-pulse-coral"> · {readingsOversight.missedCount} missed</span>}
            </span>
          </div>
          {/* Helper assists awaiting your approval — Approve writes the reading
              (no kid points); Reject sends it back to the kid. */}
          {readingsOversight.pendingApproval.length > 0 && (
            <div className="flex flex-col gap-2 mb-2">
              {readingsOversight.pendingApproval.map((r) => (
                <div key={r.id} className="bg-[#F3EEFF] border border-[#5A3CB8]/35 rounded-2xl p-3">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center text-base shrink-0">{r.emoji}</div>
                    <div className="flex-1 min-w-0">
                      <div className="font-nunito font-black text-sm text-pulse-navy truncate">{r.name}</div>
                      <div className="text-[11px] text-hive-muted font-bold">
                        <span className="text-[#5A3CB8] font-black">{r.assistBy}</span> logged {typeof r.proposed === 'number' ? `${r.proposed}${r.unit ? ' ' + r.unit : ''}` : 'a reading'} for {r.owner} · needs approval
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-2.5">
                    <button type="button" disabled={assistBusy === r.id} onClick={() => onResolveAssist(r.id, 'approve')}
                      className="flex-1 text-[12px] font-black px-3 py-2 rounded-full bg-pulse-green text-white disabled:opacity-50">
                      {assistBusy === r.id ? '…' : '✓ Approve'}
                    </button>
                    <button type="button" disabled={assistBusy === r.id} onClick={() => onResolveAssist(r.id, 'reject')}
                      className="flex-1 text-[12px] font-black px-3 py-2 rounded-full bg-white border border-pulse-coral/40 text-pulse-coral disabled:opacity-50">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {readingsOversight.unfilled.length === 0 && readingsOversight.pendingApproval.length === 0 ? (
            <div className="bg-white border border-pulse-green/40 rounded-2xl p-4 text-center text-[12.5px] font-bold text-pulse-green">
              ✓ All readings logged today
            </div>
          ) : readingsOversight.unfilled.length > 0 ? (
            <div className="flex flex-col gap-2">
              {readingsOversight.unfilled.map((r) => (
                <div key={r.id} className={`bg-white border rounded-2xl p-3 flex items-center gap-3 ${r.missed ? 'border-pulse-coral/40' : 'border-pulse-gold/30'}`}>
                  <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base shrink-0">{r.emoji}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-black text-sm text-pulse-navy truncate">{r.name}</div>
                    <div className="text-[11px] text-hive-muted font-bold">
                      {r.owner} · {r.missed ? <span className="text-pulse-coral font-black">Missed</span> : 'Pending'}
                    </div>
                  </div>
                  <Link
                    href={`/pulse/log/${r.id}`}
                    className="shrink-0 text-[11px] font-black px-3 py-1.5 rounded-full bg-pulse-navy text-pulse-cream no-underline hover:bg-pulse-navy/90"
                  >
                    Log
                  </Link>
                </div>
              ))}
            </div>
          ) : null}
        </div>
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
            const lmSame = lastMonthSameDay.per[b.m] ?? 0;
            const lmDelta = lmSame > 0 ? Math.round(((b.spent - lmSame) / lmSame) * 100) : null;
            const lmAhead = lmDelta !== null && lmDelta < 0;
            const spark = sparkByBucket[b.m] ?? [];
            const sparkMax = Math.max(1, ...spark);
            return (
              <Link key={b.m} href={`/pulse/bucket/${b.m}`} className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center gap-3 no-underline hover:bg-pulse-cream/40">
                <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base">{MODULE_EMOJI[b.m]}</div>
                <div className="flex-1 min-w-0">
                  <div className="font-nunito font-black text-sm text-pulse-navy">{MODULE_LABEL[b.m]}</div>
                  <div className="text-[11px] text-hive-muted font-bold flex items-center gap-1.5">
                    <span>{formatCents(b.spent, currency)}{b.cap > 0 ? ` / ${formatCents(b.cap, currency)}` : ''}</span>
                    {spark.some((v) => v > 0) && (
                      <span className="inline-flex items-end gap-[1px] h-3" aria-hidden="true">
                        {spark.map((v, i) => (
                          <span
                            key={i}
                            className="w-[2px] bg-pulse-navy/30 rounded-[1px]"
                            style={{ height: `${Math.max(2, Math.round((v / sparkMax) * 12))}px` }}
                          />
                        ))}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {b.cap > 0 && (
                    <span className={`text-[9px] font-black px-2 py-0.5 rounded-lg ${over ? 'bg-[#fde6e6] text-pulse-coral' : 'bg-[#e3f2e6] text-pulse-green'}`}>{bpct}%</span>
                  )}
                  {lmDelta !== null && Math.abs(lmDelta) >= 1 && (
                    <span className={`text-[8.5px] font-black px-1.5 py-0.5 rounded-full ${lmAhead ? 'bg-pulse-green/15 text-pulse-green' : 'bg-pulse-coral/15 text-pulse-coral'}`}>
                      {lmAhead ? '▼' : '▲'} {Math.abs(lmDelta)}% vs LM
                    </span>
                  )}
                </div>
                <span className="text-pulse-gold-dk text-sm">›</span>
              </Link>
            );
          })}
        </div>
      )}
      </>
      )}

      {activeTab === 'metered' && (<>
      {/* 14-day metered trend chart (PR 3 / v2). Spike days flagged coral. */}
      {(() => {
        const max = Math.max(1, ...metered14.map((d) => d.total));
        const hasData = metered14.some((d) => d.total > 0);
        if (!hasData) return null;
        const last = metered14[metered14.length - 1];
        return (
          <div className="bg-white border border-pulse-gold/30 rounded-2xl p-3 mt-4 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold-dk">📈 14-day trend</div>
              <div className="text-[10px] text-hive-muted font-bold">today: {formatCents(last.total, currency)}</div>
            </div>
            <div className="flex items-end gap-[3px] h-16">
              {metered14.map((d) => {
                const h = Math.max(4, Math.round((d.total / max) * 100));
                return (
                  <div
                    key={d.key}
                    title={`${d.key} · ${formatCents(d.total, currency)}${d.anomaly ? ' (spike)' : ''}`}
                    className="flex-1 rounded-t"
                    style={{
                      height: `${h}%`,
                      minHeight: '4px',
                      background: d.anomaly
                        ? 'linear-gradient(180deg,#F48989 0%,#E85C5C 100%)'
                        : 'linear-gradient(180deg,#E8C268 0%,#D4A847 100%)',
                    }}
                  />
                );
              })}
            </div>
            <div className="flex justify-between mt-1 text-[8.5px] font-extrabold text-hive-muted">
              <span>{labelForDayKey(metered14[0].key)}</span>
              <span>{labelForDayKey(last.key)}</span>
            </div>
          </div>
        );
      })()}

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
              <div className="flex flex-col gap-2">
                {consumption.rows.map((row) => {
                  const last = lastEntryLine(row.id);
                  return (
                    <Link key={row.id} href={`/pulse/trackable/${row.id}`} className="flex items-center justify-between gap-2 text-[12px] no-underline">
                      <span className="min-w-0">
                        <span className="font-bold text-pulse-navy block truncate">{row.tk?.emoji ?? '📊'} {row.tk?.name ?? 'Trackable'}</span>
                        {last && <span className="text-[10.5px] text-hive-muted font-bold block truncate">📊 {last}</span>}
                      </span>
                      <span className="font-nunito font-black text-pulse-navy shrink-0">{formatCents(row.cents, currency)} ›</span>
                    </Link>
                  );
                })}
              </div>
              <p className="text-[10px] text-hive-muted mt-2 leading-snug">
                Consumption telemetry (usage × price) — kept separate from cash spend above; it&apos;s how Pulse catches spikes early.
              </p>
            </div>
          )}
        </>
      )}
      </>
      )}
    </div>
  );
}
