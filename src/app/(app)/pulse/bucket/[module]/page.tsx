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
  subscribeToRecentRequests, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';
import { PulseHeader, PulseHero } from '@/components/pulse/ui';
import {
  type PulseReading, type Trackable,
  subscribeToReadingsInMonth, subscribeToTrackables,
  projectMonthSpendCents, pacing, pacingLabel,
} from '@/lib/pulse';

const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const VALID_MODULES: PurchaseModule[] = ['pantry', 'outdoor', 'drivers', 'utility', 'payroll'];

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
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      const cents = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
      total += cents;
      const d = at.getDate();
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
      <PulseHeader
        back={{ href: '/pulse', label: 'Dashboard' }}
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
