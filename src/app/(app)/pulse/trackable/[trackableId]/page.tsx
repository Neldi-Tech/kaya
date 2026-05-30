'use client';

// /pulse/trackable/[trackableId] — Kaya Pulse · Trackable Detail (Premium).
// This month's metered cost + daily avg + vs-last-month, a 30-day consumption
// chart (anomaly days in coral), the latest unacknowledged anomaly, and the
// recent readings. Parent surface.

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { formatCents } from '@/components/pantry/format';
import { toDisplayDate, dayKeyInTZ } from '@/lib/dates';
import { PulseHeader, PulseHero } from '@/components/pulse/ui';
import {
  type Trackable, type PulseReading, type PulseAlert,
  subscribeToTrackables, subscribeToReadingsForTrackable, subscribeToTrackableAlerts, acknowledgeAlert,
} from '@/lib/pulse';

const PULSE_TZ = 'Africa/Dar_es_Salaam';
const monthOf = (dayKey: string) => dayKey.slice(0, 7);
function prevMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
function lastNDays(n: number): string[] {
  const out: string[] = [];
  const today = dayKeyInTZ(new Date(), PULSE_TZ);
  const base = new Date(`${today}T00:00:00Z`);
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setUTCDate(base.getUTCDate() - i);
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}
/** "Sun, 25-May-2026" — pairs the weekday with Kaya's DD-Mmm-YYYY date. */
function dayPlusDate(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  if (!y || !m || !d) return toDisplayDate(dayKey);
  const dt = new Date(y, m - 1, d);
  const dow = dt.toLocaleDateString('en-US', { weekday: 'short' });
  return `${dow}, ${toDisplayDate(dayKey)}`;
}
/** Yesterday's dayKey in the Pulse timezone. */
function yesterdayKey(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return dayKeyInTZ(d, PULSE_TZ);
}

export default function TrackableDetailPage() {
  const router = useRouter();
  const params = useParams<{ trackableId: string }>();
  const trackableId = (params?.trackableId as string) ?? '';
  const { profile } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  // Parent-only finance detail — kids/helpers go to their Today.
  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  const [trackables, setTrackables] = useState<Trackable[]>([]);
  const [readings, setReadings] = useState<PulseReading[]>([]);
  const [alerts, setAlerts] = useState<PulseAlert[]>([]);

  useEffect(() => {
    if (!profile?.familyId || !trackableId) return;
    const u1 = subscribeToTrackables(profile.familyId, setTrackables);
    const u2 = subscribeToReadingsForTrackable(profile.familyId, trackableId, setReadings);
    const u3 = subscribeToTrackableAlerts(profile.familyId, trackableId, setAlerts);
    return () => { u1(); u2(); u3(); };
  }, [profile?.familyId, trackableId]);

  const trackable = useMemo(() => trackables.find((t) => t.id === trackableId) ?? null, [trackables, trackableId]);

  const thisMonth = monthOf(dayKeyInTZ(new Date(), PULSE_TZ));
  const lastMonth = prevMonthKey(thisMonth);
  const todayKey = dayKeyInTZ(new Date(), PULSE_TZ);
  const ydayKey = useMemo(() => yesterdayKey(), []);

  // Daily snapshot — today + yesterday + 7-day rolling average. Topups carry
  // consumedUnits=0 + deltaCost=0, so summing across reading rows is safe.
  const daily = useMemo(() => {
    const sumOn = (k: string) => readings
      .filter((r) => r.dayKey === k)
      .reduce((acc, r) => ({ units: acc.units + (r.consumedUnits ?? 0), cost: acc.cost + (r.deltaCost ?? 0) }),
              { units: 0, cost: 0 });
    const last7 = new Set(lastNDays(7));
    let sevenUnits = 0, sevenCost = 0;
    for (const r of readings) {
      if (last7.has(r.dayKey)) {
        sevenUnits += r.consumedUnits ?? 0;
        sevenCost += r.deltaCost ?? 0;
      }
    }
    return {
      today: sumOn(todayKey),
      yesterday: sumOn(ydayKey),
      avg: { units: sevenUnits / 7, cost: Math.round(sevenCost / 7) },
      hasToday: readings.some((r) => r.dayKey === todayKey),
      hasYesterday: readings.some((r) => r.dayKey === ydayKey),
    };
  }, [readings, todayKey, ydayKey]);

  const stats = useMemo(() => {
    let thisCost = 0;
    let lastCost = 0;
    let daysWithReadings = new Set<string>();
    for (const r of readings) {
      const mk = monthOf(r.dayKey);
      if (mk === thisMonth) { thisCost += r.deltaCost ?? 0; daysWithReadings.add(r.dayKey); }
      else if (mk === lastMonth) lastCost += r.deltaCost ?? 0;
    }
    const avg = daysWithReadings.size > 0 ? Math.round(thisCost / daysWithReadings.size) : 0;
    const vsPct = lastCost > 0 ? Math.round(((thisCost - lastCost) / lastCost) * 100) : null;
    return { thisCost, lastCost, avg, vsPct };
  }, [readings, thisMonth, lastMonth]);

  const chart = useMemo(() => {
    const days = lastNDays(30);
    const byDay: Record<string, { cost: number; anomaly: boolean }> = {};
    for (const r of readings) {
      if (!byDay[r.dayKey]) byDay[r.dayKey] = { cost: 0, anomaly: false };
      byDay[r.dayKey].cost += r.deltaCost ?? 0;
      if (r.isAnomaly) byDay[r.dayKey].anomaly = true;
    }
    const max = Math.max(1, ...days.map((d) => byDay[d]?.cost ?? 0));
    return days.map((d) => ({ day: d, cost: byDay[d]?.cost ?? 0, anomaly: byDay[d]?.anomaly ?? false, pct: Math.round(((byDay[d]?.cost ?? 0) / max) * 100) }));
  }, [readings]);

  const recent = readings.slice(0, 7);

  const onAck = async (alertId: string) => {
    if (!profile?.familyId || !profile.uid) return;
    await acknowledgeAlert(profile.familyId, alertId, profile.uid);
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseHeader
        back={{ href: '/pulse', label: 'Dashboard' }}
        eyebrow="Trackable detail"
        title={`${trackable?.emoji ?? '📊'} ${trackable?.name ?? 'Trackable'}`}
        subtitle="Last 30 days"
      />

      {/* Daily consumption — today at a glance (+ yesterday + 7-day avg),
          placed before the monthly summary so the day is easy to read first. */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl p-4 mt-4 shadow-[0_4px_16px_rgba(15,31,68,0.06)]">
        <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px] mb-2">Daily consumption</div>
        {daily.hasToday ? (
          <>
            <div className="text-2xl font-nunito font-black text-pulse-navy leading-tight">
              {daily.today.units.toFixed(2)}{trackable?.unit ? ` ${trackable.unit}` : ''}
              <span className="text-sm font-bold text-hive-muted"> · {formatCents(daily.today.cost, currency)}</span>
            </div>
            <div className="text-[11px] text-hive-muted font-bold mt-0.5">{dayPlusDate(todayKey)} · today</div>
          </>
        ) : (
          <div className="text-[13px] text-hive-muted">
            No reading logged today yet — <span className="font-bold text-pulse-navy">{dayPlusDate(todayKey)}</span>.
          </div>
        )}
        <div className="mt-3 grid grid-cols-2 gap-3 text-[11px]">
          <div>
            <div className="text-hive-muted uppercase tracking-wider font-black text-[9px]">Yesterday</div>
            <div className="font-nunito font-black text-pulse-navy mt-0.5">
              {daily.hasYesterday
                ? <>{daily.yesterday.units.toFixed(2)}{trackable?.unit ? ` ${trackable.unit}` : ''} <span className="text-hive-muted font-bold">· {formatCents(daily.yesterday.cost, currency)}</span></>
                : '—'}
            </div>
          </div>
          <div>
            <div className="text-hive-muted uppercase tracking-wider font-black text-[9px]">7-day avg</div>
            <div className="font-nunito font-black text-pulse-navy mt-0.5">
              {daily.avg.units.toFixed(2)}{trackable?.unit ? ` ${trackable.unit}` : ''}/day <span className="text-hive-muted font-bold">· {formatCents(daily.avg.cost, currency)}/day</span>
            </div>
          </div>
        </div>
      </div>

      {/* Last reading — the at-a-glance "where the meter is RIGHT NOW"
          card. Surfaces value + unit + when it was logged + who, so a
          parent checking the page doesn't have to scroll a chart to
          find the latest balance. */}
      {readings.length > 0 && (() => {
        const latest = readings.reduce((best, r) =>
          (r.capturedAt?.toMillis?.() ?? 0) > (best.capturedAt?.toMillis?.() ?? 0) ? r : best,
        );
        const ms = latest.capturedAt?.toMillis?.();
        const when = typeof ms === 'number' ? new Date(ms) : null;
        const ago = when ? Math.floor((Date.now() - when.getTime()) / 86_400_000) : null;
        const agoLabel = ago == null
          ? '' : ago <= 0 ? 'today' : ago === 1 ? 'yesterday' : `${ago} days ago`;
        return (
          <div className="mt-3">
            <PulseHero>
              <div className="flex items-baseline justify-between">
                <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">
                  {trackable?.emoji ?? '⚡'} Last reading
                </div>
                {agoLabel && (
                  <span className="text-[11px] font-extrabold opacity-80">{agoLabel}</span>
                )}
              </div>
              <div className="text-3xl font-nunito font-black mt-1 leading-none">
                {latest.value.toLocaleString()}
                {trackable?.unit && (
                  <span className="text-[14px] font-extrabold opacity-70 ml-1">{trackable.unit}</span>
                )}
              </div>
              {when && (
                <div className="text-[12px] opacity-90 mt-1.5">
                  {when.toLocaleString(undefined, {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
              )}
            </PulseHero>
          </div>
        );
      })()}

      {/* Stat hero */}
      <div className="mt-3">
        <PulseHero>
          <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Spent this month</div>
          <div className="text-3xl font-nunito font-black mt-1">{formatCents(stats.thisCost, currency)}</div>
          <div className="text-[12px] opacity-90 mt-1">
            avg {formatCents(stats.avg, currency)}/logged day
            {stats.vsPct != null && <> · {stats.vsPct >= 0 ? '+' : ''}{stats.vsPct}% vs last month</>}
          </div>
        </PulseHero>
      </div>

      {/* 30-day chart */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl p-4 mt-3 shadow-[0_4px_16px_rgba(15,31,68,0.06)]">
        <div className="text-[11px] font-nunito font-black text-pulse-navy mb-2">Daily cost · 30 days</div>
        {readings.length === 0 ? (
          <p className="text-hive-muted text-sm py-6 text-center">No readings yet — log one from Today.</p>
        ) : (
          <>
            <div className="flex items-end gap-[2px] h-24">
              {chart.map((b) => (
                <div
                  key={b.day}
                  title={`${toDisplayDate(b.day)} · ${formatCents(b.cost, currency)}`}
                  className={`flex-1 rounded-t ${b.anomaly ? 'bg-pulse-coral' : 'bg-pulse-gold'}`}
                  style={{ height: `${Math.max(2, b.pct)}%`, minHeight: '2px' }}
                />
              ))}
            </div>
            <div className="flex justify-between text-[9px] text-hive-muted font-bold mt-1">
              <span>{toDisplayDate(chart[0]?.day)}</span>
              <span>today</span>
            </div>
          </>
        )}
      </div>

      {/* Anomaly */}
      {alerts.length > 0 && (
        <div className="bg-[#fdecec] border border-[#f3bcbc] rounded-2xl p-3.5 mt-3">
          <div className="flex items-start gap-2">
            <div className="text-lg">⚠</div>
            <div className="flex-1">
              <div className="text-[13px] font-nunito font-black text-[#9c2b2b]">{alerts[0].title}</div>
              <div className="text-[12px] text-pulse-navy mt-0.5">{alerts[0].body}</div>
              <button
                onClick={() => onAck(alerts[0].id)}
                className="mt-2 text-[11px] font-nunito font-black text-pulse-gold-dk"
              >
                Acknowledge ›
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Recent readings */}
      <div className="text-[11px] font-nunito font-black text-pulse-navy uppercase tracking-[1px] mt-5 mb-2">Recent readings</div>
      {recent.length === 0 ? (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center text-sm text-hive-muted">Nothing logged yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {recent.map((r) => (
            <div key={r.id} className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[13px] font-nunito font-black text-pulse-navy">{dayPlusDate(r.dayKey)}</div>
                <div className="text-[11px] text-hive-muted font-bold">
                  {r.event === 'topup'
                    ? `Top-up +${(r.toppedUpUnits ?? 0).toFixed(2)} ${trackable?.unit ?? ''}`
                    : `${(r.consumedUnits ?? 0).toFixed(2)} ${trackable?.unit ?? ''} used`}
                  {r.isAnomaly && <span className="text-pulse-coral"> · spike</span>}
                </div>
              </div>
              <div className="font-nunito font-black text-sm text-pulse-navy">{formatCents(r.deltaCost, currency)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
