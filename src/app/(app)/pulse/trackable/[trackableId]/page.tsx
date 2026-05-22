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

      {/* Stat hero */}
      <div className="mt-4">
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
                <div className="text-[13px] font-nunito font-black text-pulse-navy">{toDisplayDate(r.dayKey)}</div>
                <div className="text-[11px] text-hive-muted font-bold">
                  {r.event === 'topup'
                    ? `Top-up +${r.toppedUpUnits ?? 0} ${trackable?.unit ?? ''}`
                    : `${r.consumedUnits} ${trackable?.unit ?? ''} used`}
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
