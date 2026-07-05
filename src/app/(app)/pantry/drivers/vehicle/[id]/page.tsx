'use client';

// /pantry/drivers/vehicle/[id] — per-vehicle insight page
// (Drivers v2 Smart 1 + 2, 2026-07-05).
//
// Everything a parent asks about a car without opening a single
// request, computed ONLY from data the request flows already capture
// (litres, amounts, odometer deltas) — zero extra typing:
//
//   🩺 Vehicle Health Card — next-service ring + expected date,
//      cost/km (90d), month spend vs the Drivers cap, km this month,
//      fuel-price sparkline (last 6 fills) with trend chip.
//   📉 Efficiency Watch — km/L from consecutive fills + odometer;
//      flags drops (service need / tyres / routes / fuel not reaching
//      the tank — never an accusation), one tap to a Service request.
//      Fleet cost/km comparison closes the page.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type Vehicle, subscribeToVehicles, vehicleEmoji, vehicleFuelLabel,
} from '@/lib/vehicles';
import {
  fetchRecentFuelFills, fetchRecentDriversClosed, createDraftRequest,
  type FuelFillRecord, type DriversClosedLite,
} from '@/lib/purchase';
import { fetchOdometerStats, type OdometerStats } from '@/lib/driversOdometer';
import { computeServiceDue, localTodayIso } from '@/lib/vehicleService';
import { readFamilyUnits, kmToDisplay, formatDistance } from '@/lib/units';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { toDisplayDate } from '@/lib/dates';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** km per litre for each consecutive pair of fills that BOTH carry an
 *  odometer stamp. Oldest → newest. */
function efficiencySeries(fills: FuelFillRecord[]): { label: string; kmPerUnit: number }[] {
  const stamped = fills
    .filter((f) => typeof f.odometerKm === 'number' && f.units > 0)
    .sort((a, b) => (a.odometerKm as number) - (b.odometerKm as number));
  const out: { label: string; kmPerUnit: number }[] = [];
  for (let i = 1; i < stamped.length; i++) {
    const km = (stamped[i].odometerKm as number) - (stamped[i - 1].odometerKm as number);
    if (km <= 0 || km > 5000) continue; // skip missed-fill gaps + typos
    const eff = km / stamped[i].units;
    if (eff <= 0 || eff > 60) continue;
    const d = new Date(stamped[i].closedAtMs || 0);
    out.push({ label: MONTH_SHORT[d.getMonth()] ?? '', kmPerUnit: eff });
  }
  return out;
}

export default function VehicleInsightPage() {
  const params = useParams();
  const router = useRouter();
  const vehicleId = (params?.id as string) || '';
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const role: 'parent' | 'helper' = profile?.role === 'helper' ? 'helper' : 'parent';

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [stats, setStats] = useState<OdometerStats | null>(null);
  const [fleetStats, setFleetStats] = useState<Record<string, OdometerStats>>({});
  const [fills, setFills] = useState<FuelFillRecord[]>([]);
  const [closed, setClosed] = useState<DriversClosedLite[]>([]);
  const [dismissedEff, setDismissedEff] = useState(false);
  const [creating, setCreating] = useState(false);

  const units = readFamilyUnits(family);
  const distU = units.distance;
  const effUnitLabel = `${distU}/${units.fuelVolume === 'gal' ? 'gal' : 'L'}`;
  const effFactor = (distU === 'mi' ? 0.621371 : 1) * (units.fuelVolume === 'gal' ? 3.78541 : 1);

  useEffect(() => {
    if (!profile?.familyId || !vehicleId) return;
    const unsub = subscribeToVehicles(profile.familyId, (vs) => setVehicles(vs.filter((v) => v.active)));
    let cancelled = false;
    void fetchOdometerStats(profile.familyId, vehicleId).then((s) => { if (!cancelled) setStats(s); });
    void fetchRecentFuelFills(profile.familyId, { vehicleId, max: 12 }).then((f) => { if (!cancelled) setFills(f); });
    void fetchRecentDriversClosed(profile.familyId).then((c) => { if (!cancelled) setClosed(c); });
    return () => { cancelled = true; unsub(); };
  }, [profile?.familyId, vehicleId]);

  // Fleet stats — one odometer fetch per OTHER vehicle (small fleets).
  useEffect(() => {
    if (!profile?.familyId || vehicles.length === 0) return;
    let cancelled = false;
    void Promise.all(
      vehicles.map(async (v) => [v.id, await fetchOdometerStats(profile.familyId!, v.id)] as const),
    ).then((entries) => { if (!cancelled) setFleetStats(Object.fromEntries(entries)); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.familyId, vehicles.map((v) => v.id).join(',')]);

  const vehicle = vehicles.find((v) => v.id === vehicleId) ?? null;

  const due = vehicle ? computeServiceDue({
    intervalKm: vehicle.serviceIntervalKm,
    intervalMonths: vehicle.serviceIntervalMonths,
    baselineKm: vehicle.serviceBaselineKm,
    baselineDate: vehicle.serviceBaselineDate,
    latestKm: stats?.lastKm ?? null,
    kmPerDay: stats?.kmPerDay ?? null,
    todayIso: localTodayIso(),
  }) : null;

  const monthStartMs = useMemo(() => {
    const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.getTime();
  }, []);
  const ninetyAgoMs = Date.now() - 90 * 24 * 60 * 60 * 1000;

  const monthSpend = closed
    .filter((c) => c.vehicleId === vehicleId && c.closedAtMs >= monthStartMs)
    .reduce((s, c) => s + c.actualTotalCents, 0);
  const spend90 = closed
    .filter((c) => c.vehicleId === vehicleId && c.closedAtMs >= ninetyAgoMs)
    .reduce((s, c) => s + c.actualTotalCents, 0);
  const driversCap = family?.householdBudgets?.drivers ?? 0;
  const costPerKm90 = stats?.km90d && stats.km90d > 0 ? Math.round(spend90 / stats.km90d) : null;

  const eff = useMemo(() => efficiencySeries(fills), [fills]);
  // Drop flag: average of the last 2 vs the 3 before them, ≥15% down.
  const effDrop = useMemo(() => {
    if (eff.length < 4) return null;
    const recent = eff.slice(-2);
    const base = eff.slice(0, -2).slice(-3);
    const avg = (a: { kmPerUnit: number }[]) => a.reduce((s, x) => s + x.kmPerUnit, 0) / a.length;
    const rAvg = avg(recent); const bAvg = avg(base);
    if (bAvg <= 0) return null;
    const dropPct = ((bAvg - rAvg) / bAvg) * 100;
    return dropPct >= 15 ? { from: bAvg, to: rAvg, dropPct } : null;
  }, [eff]);

  // Price sparkline: last 6 fills, oldest → newest.
  const priceSeries = useMemo(
    () => [...fills].sort((a, b) => a.closedAtMs - b.closedAtMs).slice(-6),
    [fills],
  );
  const priceTrendPct = priceSeries.length >= 2
    ? ((priceSeries[priceSeries.length - 1].pricePerUnitCents - priceSeries[0].pricePerUnitCents)
      / priceSeries[0].pricePerUnitCents) * 100
    : null;

  const startServiceRequest = async () => {
    if (!profile?.familyId || !profile.uid || isGuest || creating || !vehicle) return;
    setCreating(true);
    try {
      const id = await createDraftRequest(profile.familyId, {
        context: vehicle.label,
        createdBy: profile.uid,
        createdByRole: role,
        module: 'drivers',
        vehicleId: vehicle.id,
        kind: 'service',
        fuelType: vehicle.fuel,
      });
      router.push(`/pantry/purchase/${id}`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[vehicle] startServiceRequest failed:', e);
      setCreating(false);
    }
  };

  if (!vehicle) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <p className="text-hive-muted text-sm">Loading vehicle…</p>
        <Link href="/pantry/drivers" className="text-pantry-leaf-dk font-bold text-sm underline">← Drivers</Link>
      </div>
    );
  }

  const pct = due?.configured ? Math.min(1, due.pctUsed) : 0;
  const ringColor = due?.overdue ? '#DC2626' : (due?.pctUsed ?? 0) >= 0.75 ? '#D97706' : '#4C7C59';
  const fuelWord = vehicle.fuel ? vehicleFuelLabel(vehicle.fuel) : 'Fuel';

  // Fleet cost/km — this month, per active vehicle with distance data.
  const fleet = vehicles.map((v) => {
    const s = fleetStats[v.id];
    const spend = closed
      .filter((c) => c.vehicleId === v.id && c.closedAtMs >= monthStartMs)
      .reduce((sum, c) => sum + c.actualTotalCents, 0);
    const km = s?.kmThisMonth ?? null;
    return { v, costPerKm: km && km > 0 ? Math.round(spend / km) : null };
  }).filter((x) => x.costPerKm != null) as { v: Vehicle; costPerKm: number }[];
  const fleetMax = fleet.reduce((m, x) => Math.max(m, x.costPerKm), 0);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/pantry/drivers" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs">
        ← Drivers
      </Link>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk mt-3">
        Vehicle
      </p>
      <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
        {vehicleEmoji(vehicle.type)} {vehicle.label}
      </h1>
      <p className="text-hive-muted text-sm mt-1 mb-4">
        {[vehicle.makeModel, vehicle.plate, fuelWord].filter(Boolean).join(' · ')}
      </p>

      {/* ── Smart 1 · Vehicle Health Card ─────────────────────────── */}
      <div className={`border rounded-hive p-4 mb-3 ${
        due?.overdue ? 'bg-hive-rose/10 border-hive-rose' : 'bg-pantry-leaf-soft border-pantry-leaf'
      }`}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk mb-1">
              Next service
            </p>
            {due?.configured ? (
              <>
                <p className="font-nunito font-black text-[17px]">
                  {due.overdue
                    ? `🔴 overdue${due.overdueKm != null ? ` · +${formatDistance(due.overdueKm, distU)}` : ''}`
                    : <>
                      {due.kmLeft != null ? `~${formatDistance(due.kmLeft, distU)}` : ''}
                      {due.expectedIso ? ` · exp. ${toDisplayDate(due.expectedIso)}` : ''}
                    </>}
                </p>
                {due.hardStopIso && (
                  <p className="text-[11px] text-hive-muted font-bold mt-0.5">
                    ⛔ hard stop {toDisplayDate(due.hardStopIso)}
                  </p>
                )}
              </>
            ) : (
              <p className="text-[12px] text-hive-muted font-bold">
                No schedule yet — set it in{' '}
                <Link href="/pantry/setup/vehicles" className="underline text-pantry-leaf-dk">Setup → Vehicles</Link>.
              </p>
            )}
          </div>
          {due?.configured && (
            <div
              className="w-[72px] h-[72px] rounded-full flex-shrink-0 flex items-center justify-center"
              style={{ background: `conic-gradient(${ringColor} 0 ${pct * 100}%, #E8E2D2 ${pct * 100}% 100%)` }}
            >
              <div className="w-[54px] h-[54px] rounded-full bg-hive-paper flex flex-col items-center justify-center">
                <span className="font-nunito font-black text-[14px] leading-none">{Math.round(due.pctUsed * 100)}%</span>
                <span className="text-[8px] font-nunito font-extrabold text-hive-muted tracking-wide">USED</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1px] text-hive-muted">Cost / {distU}</p>
            <p className="font-nunito font-black text-[16px] mt-0.5">
              {costPerKm90 != null ? formatCents(Math.round(costPerKm90 * (distU === 'mi' ? 1.609344 : 1)), currency) : '—'}
            </p>
            <p className="text-[10px] text-hive-muted font-bold">last 90 days</p>
          </div>
          <div>
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1px] text-hive-muted">This month</p>
            <p className="font-nunito font-black text-[16px] mt-0.5">{formatCentsBudgetNeat(monthSpend, currency)}</p>
            <p className="text-[10px] text-hive-muted font-bold">
              {driversCap > 0 ? `of ${formatCentsBudgetNeat(driversCap, currency)} cap` : 'no cap set'}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[1px] text-hive-muted">{distU === 'mi' ? 'Miles' : 'Km'} driven</p>
            <p className="font-nunito font-black text-[16px] mt-0.5">
              {stats?.kmThisMonth != null ? kmToDisplay(stats.kmThisMonth, distU).toLocaleString() : '—'}
            </p>
            <p className="text-[10px] text-hive-muted font-bold">this month</p>
          </div>
        </div>
        {driversCap > 0 && (
          <div className="h-2 bg-hive-cream rounded-full overflow-hidden mt-3">
            <div
              className={`h-full rounded-full ${monthSpend > driversCap ? 'bg-hive-rose' : 'bg-pantry-leaf'}`}
              style={{ width: `${Math.min(100, (monthSpend / driversCap) * 100)}%` }}
            />
          </div>
        )}
      </div>

      {priceSeries.length >= 2 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
            ⛽ {fuelWord} price — last {priceSeries.length} fills
          </p>
          <div className="flex items-end gap-1.5 h-[46px]">
            {priceSeries.map((f, i) => {
              const max = Math.max(...priceSeries.map((x) => x.pricePerUnitCents));
              const h = Math.max(18, (f.pricePerUnitCents / max) * 100);
              const isLast = i === priceSeries.length - 1;
              return (
                <div
                  key={f.requestId}
                  className={`flex-1 rounded-t ${isLast ? 'bg-pantry-leaf-dk' : 'bg-pantry-leaf/55'}`}
                  style={{ height: `${h}%` }}
                  title={`${formatCents(f.pricePerUnitCents, currency)} · ${toDisplayDate(new Date(f.closedAtMs).toLocaleDateString('en-CA'))}`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[11px] text-hive-muted font-bold">
              {formatCents(priceSeries[0].pricePerUnitCents, currency)} → <b>{formatCents(priceSeries[priceSeries.length - 1].pricePerUnitCents, currency)}</b>
            </p>
            {priceTrendPct != null && Math.abs(priceTrendPct) >= 1 && (
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-nunito font-extrabold ${
                priceTrendPct > 0 ? 'bg-hive-rose/10 text-hive-rose' : 'bg-pantry-leaf-soft text-pantry-leaf-dk'
              }`}>
                {priceTrendPct > 0 ? '▲ trending up' : '▼ trending down'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Smart 2 · Efficiency Watch ────────────────────────────── */}
      {eff.length >= 2 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
            📉 Efficiency Watch — {effUnitLabel}, auto from fills + odometer
          </p>
          <div className="flex items-end gap-1.5 h-[46px]">
            {eff.slice(-6).map((e, i, arr) => {
              const max = Math.max(...arr.map((x) => x.kmPerUnit));
              const h = Math.max(18, (e.kmPerUnit / max) * 100);
              const isRecentDrop = effDrop != null && i >= arr.length - 2;
              return (
                <div
                  key={`${e.label}-${i}`}
                  className={`flex-1 rounded-t ${isRecentDrop ? 'bg-hive-rose/80' : 'bg-pantry-leaf/70'}`}
                  style={{ height: `${h}%` }}
                  title={`${e.label} · ${(e.kmPerUnit * effFactor).toFixed(1)} ${effUnitLabel}`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between mt-1.5 flex-wrap gap-1">
            <p className="text-[11px] text-hive-muted font-bold">
              {eff.slice(-3).map((e) => `${e.label} ${(e.kmPerUnit * effFactor).toFixed(1)}`).join(' · ')} {effUnitLabel}
            </p>
            {effDrop && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-nunito font-extrabold bg-hive-rose/10 text-hive-rose">
                ▼ {Math.round(effDrop.dropPct)}% drop
              </span>
            )}
          </div>
        </div>
      )}

      {effDrop && !dismissedEff && (
        <div className="bg-[#FFF3D9] border border-hive-honey rounded-hive p-4 mb-3">
          <p className="font-nunito font-extrabold text-[14px]">
            🔍 {vehicle.label} is drinking more than usual
          </p>
          <p className="text-[12px] text-hive-muted font-bold mt-1">
            Fuel economy fell from ~{(effDrop.from * effFactor).toFixed(1)} to {(effDrop.to * effFactor).toFixed(1)} {effUnitLabel} over
            the last fills. Common causes: service {due?.overdue ? 'overdue ✓ (it is)' : 'coming due'},
            tyre pressure, town-heavy routes — or fuel not reaching the tank. Worth a look.
          </p>
          <div className="flex gap-2 mt-2.5">
            <button
              type="button"
              onClick={startServiceRequest}
              disabled={creating || isGuest}
              className="bg-pantry-leaf text-white rounded-full px-4 py-2 text-[12px] font-nunito font-extrabold disabled:opacity-60"
            >
              {creating ? 'Starting…' : 'Create service request'}
            </button>
            <button
              type="button"
              onClick={() => setDismissedEff(true)}
              className="bg-white border border-hive-line rounded-full px-4 py-2 text-[12px] font-nunito font-extrabold text-hive-muted"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {fleet.length >= 2 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
            Fleet this month · cost / {distU}
          </p>
          {fleet.sort((a, b) => b.costPerKm - a.costPerKm).map(({ v, costPerKm }) => (
            <div key={v.id} className="mb-2">
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-nunito font-extrabold">
                  {vehicleEmoji(v.type)} {v.label}{v.id === vehicleId ? ' · this one' : ''}
                </span>
                <span className="text-[12px] text-hive-muted font-bold">
                  <b>{formatCents(Math.round(costPerKm * (distU === 'mi' ? 1.609344 : 1)), currency)}</b>/{distU}
                </span>
              </div>
              <div className="h-2 bg-hive-cream rounded-full overflow-hidden mt-1">
                <div
                  className={`h-full rounded-full ${costPerKm === fleetMax ? 'bg-hive-honey' : 'bg-pantry-leaf'}`}
                  style={{ width: `${Math.max(6, (costPerKm / fleetMax) * 100)}%` }}
                />
              </div>
            </div>
          ))}
          <p className="text-[10px] text-hive-muted font-bold mt-1">
            Needs odometer readings this month on each vehicle to compare.
          </p>
        </div>
      )}
    </div>
  );
}
