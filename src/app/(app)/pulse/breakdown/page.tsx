'use client';

// /pulse/breakdown — Kaya Pulse · Spent this month composition view.
//
// Opens from a tap on the /pulse hero. Shows the total this-month cash spend
// split across all 9 household buckets (donut + segment list). Each segment
// is a Link into /pulse/bucket/[module] for the txn drill. Parent-only.
// Future Self projection lives here too (added in PR 3).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule,
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL, budgetMonthKeyFor,
} from '@/lib/purchase';
import { subscribeToSpendLedger, type SpendLedgerEntry } from '@/lib/spendLedger';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { PulseHeader, PulseHero, PulseBreadcrumb } from '@/components/pulse/ui';
import { projectMonthSpendCents } from '@/lib/pulse';
import { rangeFromQuery, monthKeysInRange, monthSpan, rangeLabel, type TimeRange } from '@/lib/timeRange';

const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) => d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const LIVE_MODULES: PurchaseModule[] = [
  'pantry', 'outdoor', 'drivers', 'utility', 'payroll', 'dineOut', 'home',
  'subscriptions', 'contributions',
];

const SEG_COLORS: Record<PurchaseModule, string> = {
  pantry: '#2E7D34',
  outdoor: '#1F8FA8',
  drivers: '#9c6cd6',
  utility: '#D4A847',
  payroll: '#B58A2F',
  dineOut: '#E85C5C',
  home: '#264B6E',
  subscriptions: '#7B8EE8',
  contributions: '#5A3CB8',
};

export default function PulseBreakdownPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const searchParams = useSearchParams();
  const range = useMemo<TimeRange>(() => rangeFromQuery(searchParams), [searchParams]);
  const monthSet = useMemo(() => new Set(monthKeysInRange(range)), [range]);
  const months = monthSpan(range);
  const isLiveMonth = range.kind === 'month'
    && range.year === new Date().getFullYear()
    && range.month === new Date().getMonth();

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [ledger, setLedger] = useState<SpendLedgerEntry[]>([]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const u1 = subscribeToRecentRequests(profile.familyId, setRecent);
    const u2 = subscribeToSpendLedger(profile.familyId, setLedger);
    return () => { u1(); u2(); };
  }, [profile?.familyId, profile?.role]);

  const { per, totalSpent, totalCap } = useMemo(() => {
    const acc: Record<string, { spent: number; cap: number }> = {};
    LIVE_MODULES.forEach((m) => { acc[m] = { spent: 0, cap: 0 }; });
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      if (!monthSet.has(budgetMonthKeyFor(r) ?? '')) continue;   // payroll → work-period month
      const m = (r.module ?? 'pantry') as PurchaseModule;
      if (acc[m]) acc[m].spent += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    for (const e of ledger) {
      if (e.isProfessionalExpense) continue;
      const at = e.occurredOn?.toDate?.();
      if (!at || !monthSet.has(monthKeyOf(at))) continue;
      const m = e.sourceModule as PurchaseModule;
      if (acc[m]) acc[m].spent += e.amountHousehold || 0;
    }
    const budgets = (family?.householdBudgets ?? {}) as Record<string, number | undefined>;
    LIVE_MODULES.forEach((m) => { acc[m].cap = (budgets[m] ?? 0) * months; });
    return {
      per: acc,
      totalSpent: LIVE_MODULES.reduce((s, m) => s + acc[m].spent, 0),
      totalCap: LIVE_MODULES.reduce((s, m) => s + acc[m].cap, 0),
    };
  }, [recent, ledger, family?.householdBudgets, monthSet, months]);

  const sorted = useMemo(() => {
    return LIVE_MODULES
      .map((m) => ({ m, ...per[m], pct: totalSpent > 0 ? (per[m].spent / totalSpent) * 100 : 0 }))
      .sort((a, b) => b.spent - a.spent);
  }, [per, totalSpent]);

  // Build donut stroke-dasharray segments. radius=15.9 → circumference≈100.
  const segments = useMemo(() => {
    let offset = 0;
    return sorted
      .filter((s) => s.pct > 0)
      .map((s) => {
        const dash = `${s.pct} ${100 - s.pct}`;
        const seg = { module: s.m, dash, offset: -offset, color: SEG_COLORS[s.m] };
        offset += s.pct;
        return seg;
      });
  }, [sorted]);

  const now = new Date();
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const capPct = totalCap > 0 ? Math.min(100, Math.round((totalSpent / totalCap) * 100)) : 0;

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseBreadcrumb trail={[]} current={`Spent · ${rangeLabel(range)}`} />
      <PulseHeader eyebrow="Composition" title="Spent" subtitle={rangeLabel(range)} />

      {/* Hero */}
      <div className="mt-4">
        <PulseHero>
          <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Spent · all buckets</div>
          <div className="text-3xl font-nunito font-black mt-1">
            {formatCentsBudgetNeat(totalSpent, currency)}
            <span className="text-sm opacity-80 font-bold"> / {totalCap > 0 ? formatCentsBudgetNeat(totalCap, currency) : '—'}</span>
          </div>
          <div className="text-[12px] opacity-90 mt-1">
            {sorted.filter((s) => s.cap > 0 && s.spent <= s.cap).length} of {sorted.filter((s) => s.cap > 0).length} buckets below cap
          </div>
          {totalCap > 0 && (
            <>
              <div className="h-2 bg-white/20 rounded-full mt-3 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${capPct}%`, background: '#D4A847' }} />
              </div>
              <div className="flex justify-between text-[10px] font-black mt-2 opacity-90">
                <span>{capPct}% of cap</span>
                <span>{isLiveMonth ? `Day ${dayOfMonth} / ${daysInMonth}` : `${months} month${months === 1 ? '' : 's'}`}</span>
              </div>
            </>
          )}
        </PulseHero>
      </div>

      {/* Donut + segments */}
      <div className="mt-3 bg-white border border-pulse-gold/30 rounded-2xl p-4">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold-dk mb-2">📐 Composition</div>
        {totalSpent === 0 ? (
          <p className="text-hive-muted text-sm py-6 text-center">No closed spend in {rangeLabel(range)}.</p>
        ) : (
          <>
            <svg viewBox="0 0 36 36" className="w-32 h-32 mx-auto mb-3" role="img" aria-label="Spend composition donut">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#EEF3FB" strokeWidth="5" />
              {segments.map((seg) => (
                <circle
                  key={seg.module}
                  cx="18" cy="18" r="15.9"
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="5"
                  strokeDasharray={seg.dash}
                  strokeDashoffset={seg.offset + 25}
                  transform="rotate(-90 18 18)"
                />
              ))}
              <text x="18" y="17.5" textAnchor="middle" fontFamily="Nunito" fontSize="3.8" fontWeight="900" fill="#0F1F44">{capPct}%</text>
              <text x="18" y="21.5" textAnchor="middle" fontFamily="Nunito" fontSize="2.2" fontWeight="800" fill="#9aa3ad">OF CAP</text>
            </svg>
            <div className="flex flex-col gap-0">
              {sorted.map((s) => (
                <Link
                  key={s.m}
                  href={`/pulse/bucket/${s.m}`}
                  className="flex items-center gap-2 py-2 border-t border-dashed border-pulse-gold/30 first:border-t-0 no-underline hover:bg-pulse-cream/40"
                >
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: SEG_COLORS[s.m] }} />
                  <span className="flex-1 text-[12px] font-extrabold text-pulse-navy">{MODULE_EMOJI[s.m]} {MODULE_LABEL[s.m]}</span>
                  <span className="text-[12px] font-black text-pulse-navy">{formatCents(s.spent, currency)}</span>
                  <span className="text-[9.5px] font-black text-hive-muted w-10 text-right">{Math.round(s.pct)}%</span>
                  <span className="text-pulse-gold-dk text-sm">›</span>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Future Self — pure projection; live month only (a past/multi-month
          range has no "rest of month" left to project). */}
      {isLiveMonth && totalCap > 0 && totalSpent > 0 && (() => {
        const projected = projectMonthSpendCents(totalSpent, dayOfMonth, daysInMonth);
        const monthlySave = totalCap - projected;
        if (monthlySave <= 0) return null;
        const six = monthlySave * 6;
        const year = monthlySave * 12;
        const five = monthlySave * 60;
        return (
          <div className="mt-3 relative overflow-hidden rounded-2xl p-4 text-white"
            style={{ background: 'linear-gradient(135deg,#2a3a6a 0%,#0F1F44 100%)' }}>
            <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold mb-2">🌳 Future Self · if this pace holds</div>
            <div className="text-[11.5px] font-bold opacity-80 mb-2.5">{monthLabel()} monthly save: {formatCentsBudgetNeat(monthlySave, currency)}</div>
            <FutureRow label="By 6 months" value={formatCentsBudgetNeat(six, currency)} />
            <FutureRow label="By 1 year" value={formatCentsBudgetNeat(year, currency)} />
            <FutureRow label="By 5 years" value={formatCentsBudgetNeat(five, currency)} />
            <p className="text-[10px] font-bold opacity-60 mt-3 text-center italic">A year of school fees · a duka deposit · or a family trip.</p>
          </div>
        );
      })()}
    </div>
  );
}

function FutureRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between py-2 border-t border-dashed border-white/15 first:border-t-0">
      <span className="text-[11.5px] font-extrabold opacity-90">{label}</span>
      <span className="font-nunito font-black text-[15px] text-pulse-gold">{value}</span>
    </div>
  );
}
