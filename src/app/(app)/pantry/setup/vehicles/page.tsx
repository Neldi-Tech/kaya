'use client';

// /pantry/setup/vehicles — Vehicles & service setup (Screen F, 2026-07-05).
//
// Per-vehicle service schedule + reminder tuning, plus the family-wide
// odometer rule. The vehicle REGISTRY (add/edit label, plate, fuel…)
// stays on /pantry/drivers/vehicles — this page owns the schedule:
//
//   • Service schedule — every N km AND/OR every N months (whichever
//     first, locked decision A). Baseline = last service; normally
//     auto-reset when a Service request closes, manual reset here for
//     services done outside Kaya.
//   • Remind when — ≤ N distance / ≤ N days left (lock B; defaults
//     500 km / 14 days).
//   • Who gets reminded — parents / drivers / all helpers (lock C).
//   • 🧭 Odometer required for drivers — family-wide toggle
//     (driversConfig; helpers blocked, parents only nudged).
//
// All distances display in the family unit (Setup → Units & formats)
// and store canonical km.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  type Vehicle, subscribeToVehicles, updateVehicle, setVehicleNextService, vehicleEmoji,
} from '@/lib/vehicles';
import { readDriversConfig, setDriversConfig } from '@/lib/purchase';
import { readFamilyUnits, kmToDisplay, displayToKm } from '@/lib/units';
import { toDisplayDate } from '@/lib/dates';
import { fetchOdometerStats } from '@/lib/driversOdometer';
import { scanServiceCard } from '@/lib/serviceCardScan';
import { addMonthsIso, isoToUtcMs, localTodayIso } from '@/lib/vehicleService';

interface VehicleForm {
  // v2.1 — 🎯 explicit next-service targets (the workshop sticker).
  nextKm: string;          // in family display unit
  nextDate: string;        // YYYY-MM-DD
  intervalKm: string;      // in family display unit
  intervalMonths: string;
  remindKmLeft: string;    // in family display unit
  remindDaysLeft: string;
  recipParents: boolean;
  recipDrivers: boolean;
  recipAllHelpers: boolean;
  resetOpen: boolean;
  baselineKm: string;      // in family display unit
  baselineDate: string;    // YYYY-MM-DD
}

export default function VehiclesServiceSetupPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [forms, setForms] = useState<Record<string, VehicleForm>>({});
  // Latest odometer per vehicle — powers the "countdown armed" preview
  // + the already-due warning on the 🎯 targets.
  const [odoStats, setOdoStats] = useState<Record<string, { lastKm: number | null }>>({});
  // v2.2 — 📷 service-card scan, per vehicle.
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<Record<string, string>>({});

  const scanCardFor = async (vehicleId: string, file: File) => {
    setScanningId(vehicleId);
    setScanMsg((m) => ({ ...m, [vehicleId]: '' }));
    try {
      const r = await scanServiceCard(file);
      if (!r) {
        setScanMsg((m) => ({ ...m, [vehicleId]: 'Scan not configured — type it in.' }));
        return;
      }
      const patch: Partial<VehicleForm> = {};
      if (r.nextServiceOdo != null) {
        // Sticker unit wins when printed; else assume the family's unit.
        const canonicalKm = r.odoUnit === 'mi'
          ? Math.round(r.nextServiceOdo / 0.621371)
          : r.odoUnit === 'km' ? r.nextServiceOdo
          : displayToKm(r.nextServiceOdo, distU);
        patch.nextKm = String(kmToDisplay(canonicalKm, distU));
      }
      if (r.nextServiceDate) patch.nextDate = r.nextServiceDate;
      if (Object.keys(patch).length > 0) {
        patchForm(vehicleId, patch);
        setScanMsg((m) => ({ ...m, [vehicleId]: '✓ read from the card — check, then Save' }));
      } else {
        setScanMsg((m) => ({ ...m, [vehicleId]: 'Couldn’t read the card — type it in.' }));
      }
    } catch {
      setScanMsg((m) => ({ ...m, [vehicleId]: 'Scan failed — type it in.' }));
    } finally {
      setScanningId(null);
    }
  };
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [togglingOdo, setTogglingOdo] = useState(false);

  const units = readFamilyUnits(family);
  const distU = units.distance;
  const driversCfg = readDriversConfig(family);

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry/drivers');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    return subscribeToVehicles(profile.familyId, (vs) => {
      const active = vs.filter((v) => v.active);
      setVehicles(active);
      // Seed forms once per vehicle; live edits win over re-snapshots.
      setForms((prev) => {
        const next = { ...prev };
        for (const v of active) {
          if (next[v.id]) continue;
          next[v.id] = {
            nextKm: v.nextServiceKm ? String(kmToDisplay(v.nextServiceKm, distU)) : '',
            nextDate: v.nextServiceDate ?? '',
            intervalKm: v.serviceIntervalKm ? String(kmToDisplay(v.serviceIntervalKm, distU)) : '',
            intervalMonths: v.serviceIntervalMonths ? String(v.serviceIntervalMonths) : '',
            remindKmLeft: v.remindKmLeft ? String(kmToDisplay(v.remindKmLeft, distU)) : '',
            remindDaysLeft: v.remindDaysLeft ? String(v.remindDaysLeft) : '',
            recipParents: v.remindRecipients?.parents !== false,
            recipDrivers: v.remindRecipients?.drivers !== false,
            recipAllHelpers: v.remindRecipients?.allHelpers === true,
            resetOpen: false,
            baselineKm: v.serviceBaselineKm ? String(kmToDisplay(v.serviceBaselineKm, distU)) : '',
            baselineDate: v.serviceBaselineDate ?? '',
          };
        }
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.familyId, profile?.role]);

  useEffect(() => {
    if (!profile?.familyId || vehicles.length === 0) return;
    let cancelled = false;
    void Promise.all(vehicles.map(async (v) => {
      const s = await fetchOdometerStats(profile.familyId!, v.id);
      return [v.id, { lastKm: s.lastKm }] as const;
    })).then((entries) => {
      if (!cancelled) setOdoStats(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.familyId, vehicles.map((v) => v.id).join(',')]);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Vehicle setup is parent-only</h2>
        <Link href="/pantry/drivers" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Drivers
        </Link>
      </div>
    );
  }

  const patchForm = (id: string, patch: Partial<VehicleForm>) =>
    setForms((f) => ({ ...f, [id]: { ...f[id], ...patch } }));

  const save = async (v: Vehicle) => {
    if (!profile?.familyId) return;
    const f = forms[v.id];
    if (!f) return;
    setSavingId(v.id);
    setSavedId(null);
    try {
      const num = (s: string) => { const n = parseFloat(s); return Number.isFinite(n) && n > 0 ? n : null; };
      const iKm = num(f.intervalKm);
      const iMo = num(f.intervalMonths);
      const rKm = num(f.remindKmLeft);
      const rDays = num(f.remindDaysLeft);
      const bKm = num(f.baselineKm);
      await updateVehicle(profile.familyId, v.id, {
        ...(iKm != null ? { serviceIntervalKm: displayToKm(iKm, distU) } : {}),
        ...(iMo != null ? { serviceIntervalMonths: Math.round(iMo) } : {}),
        ...(rKm != null ? { remindKmLeft: displayToKm(rKm, distU) } : {}),
        ...(rDays != null ? { remindDaysLeft: Math.round(rDays) } : {}),
        remindRecipients: {
          parents: f.recipParents,
          drivers: f.recipDrivers,
          allHelpers: f.recipAllHelpers,
        },
        ...(f.resetOpen && bKm != null ? { serviceBaselineKm: displayToKm(bKm, distU) } : {}),
        ...(f.resetOpen && /^\d{4}-\d{2}-\d{2}$/.test(f.baselineDate)
          ? { serviceBaselineDate: f.baselineDate } : {}),
      });
      // v2.1 — 🎯 targets: set when typed, CLEAR when the field was
      // emptied after having a value, untouched otherwise.
      const nKm = num(f.nextKm);
      const nDateOk = /^\d{4}-\d{2}-\d{2}$/.test(f.nextDate);
      await setVehicleNextService(profile.familyId, v.id, {
        nextServiceKm: nKm != null ? displayToKm(nKm, distU)
          : (f.nextKm.trim() === '' && v.nextServiceKm != null ? null : undefined),
        nextServiceDate: nDateOk ? f.nextDate
          : (f.nextDate.trim() === '' && v.nextServiceDate ? null : undefined),
      });
      setSavedId(v.id);
      setTimeout(() => setSavedId((s) => (s === v.id ? null : s)), 2000);
    } finally { setSavingId(null); }
  };

  const toggleOdoMandatory = async () => {
    if (!profile?.familyId || togglingOdo) return;
    setTogglingOdo(true);
    try {
      await setDriversConfig(profile.familyId, {
        ...family?.driversConfig,
        odometerMandatoryForHelpers: !driversCfg.odometerMandatoryForHelpers,
      });
    } finally { setTogglingOdo(false); }
  };

  const distWord = distU === 'km' ? 'km' : 'miles';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/pantry/setup" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs">
        ← Setup
      </Link>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk mt-3">
        Setup · Vehicles & service
      </p>
      <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
        🚗 Vehicles & service
      </h1>
      <p className="text-hive-muted text-sm mt-1 mb-1.5">
        Per-vehicle schedule + reminders (a boda ≠ a Prado). Due = {distWord} or months —
        whichever comes first.
      </p>
      <Link
        href="/pantry/drivers/vehicles"
        className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline inline-block mb-4"
      >
        🚙 Manage the vehicle registry (add / edit / photo) →
      </Link>

      {/* Family-wide odometer rule (Screen F toggle). */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-nunito font-extrabold text-[15px]">🧭 Odometer required for drivers</p>
            <p className="text-[12px] text-hive-muted font-bold mt-0.5">
              Drivers can&apos;t submit Fuel / Maintenance / Service without a reading.
              Parents are always nudged, never blocked.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleOdoMandatory}
            disabled={togglingOdo}
            aria-label="Toggle odometer required for drivers"
            className={`w-[46px] h-[26px] rounded-full flex-shrink-0 relative transition-colors ${
              driversCfg.odometerMandatoryForHelpers ? 'bg-pantry-leaf' : 'bg-hive-line'
            }`}
          >
            <span className={`absolute top-[3px] w-5 h-5 rounded-full bg-white shadow transition-all ${
              driversCfg.odometerMandatoryForHelpers ? 'right-[3px]' : 'left-[3px]'
            }`} />
          </button>
        </div>
      </div>

      {vehicles.length === 0 && (
        <div className="bg-hive-paper border border-dashed border-hive-line rounded-hive p-6 text-center">
          <div className="text-3xl mb-2">🚗</div>
          <p className="font-nunito font-black">No vehicles yet</p>
          <p className="text-hive-muted text-sm mt-1">
            Add one in the registry first, then set its service schedule here.
          </p>
        </div>
      )}

      {vehicles.map((v) => {
        const f = forms[v.id];
        if (!f) return null;
        return (
          <div key={v.id} className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-2xl">{vehicleEmoji(v.type)}</span>
              <div className="min-w-0">
                <p className="font-nunito font-black text-[16px] truncate">{v.label}</p>
                <p className="text-[11px] text-hive-muted font-bold truncate">
                  {[v.makeModel, v.plate].filter(Boolean).join(' · ') || '—'}
                </p>
              </div>
            </div>

            {/* v2.1 — 🎯 Next service: the workshop-sticker numbers.
                WIN over the derived schedule below; auto-clear when a
                Service request closes. Either field alone arms the
                countdown. */}
            {(() => {
              const lastKm = odoStats[v.id]?.lastKm ?? null;
              const tKmDisp = parseFloat(f.nextKm);
              const tKm = Number.isFinite(tKmDisp) && tKmDisp > 0 ? displayToKm(tKmDisp, distU) : null;
              const tDateOk = /^\d{4}-\d{2}-\d{2}$/.test(f.nextDate);
              const todayIso = localTodayIso();
              const kmAlreadyDue = tKm != null && lastKm != null && tKm <= lastKm;
              const dateAlreadyDue = tDateOk
                && (isoToUtcMs(f.nextDate) ?? 0) < (isoToUtcMs(todayIso) ?? 0);
              const kmLeftDisp = tKm != null && lastKm != null && tKm > lastKm
                ? kmToDisplay(tKm - lastKm, distU) : null;
              const daysLeft = tDateOk
                ? Math.round(((isoToUtcMs(f.nextDate) ?? 0) - (isoToUtcMs(todayIso) ?? 0)) / 86400000)
                : null;
              const armed = (tKm != null || tDateOk) && !kmAlreadyDue && !dateAlreadyDue;
              // Greyed auto-derived values when the schedule below can
              // derive them — shown as placeholders / captions.
              const autoKm = v.serviceBaselineKm != null && v.serviceIntervalKm
                ? kmToDisplay(v.serviceBaselineKm + v.serviceIntervalKm, distU) : null;
              const autoDate = v.serviceBaselineDate && v.serviceIntervalMonths
                ? addMonthsIso(v.serviceBaselineDate, v.serviceIntervalMonths) : null;
              return (
                <div className="bg-pantry-leaf-soft border border-pantry-leaf rounded-xl p-3 mb-3">
                  <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk mb-1.5">
                    🎯 Next service — from the workshop sticker
                  </p>
                  <div className="grid grid-cols-2 gap-2 mb-1.5">
                    <label className={`bg-white border rounded-xl px-3 py-2 ${kmAlreadyDue ? 'border-hive-rose' : 'border-hive-line'}`}>
                      <span className="block text-[10px] text-hive-muted font-bold">Next service odometer ({distWord})</span>
                      <input
                        type="number" inputMode="numeric"
                        placeholder={autoKm != null ? `auto: ${autoKm.toLocaleString()}` : 'e.g. 90000'}
                        value={f.nextKm}
                        onChange={(e) => patchForm(v.id, { nextKm: e.target.value })}
                        className="w-full font-nunito font-extrabold text-[15px] outline-none bg-transparent"
                      />
                    </label>
                    <label className={`bg-white border rounded-xl px-3 py-2 ${dateAlreadyDue ? 'border-hive-rose' : 'border-hive-line'}`}>
                      <span className="block text-[10px] text-hive-muted font-bold">Next service date</span>
                      <input
                        type="date"
                        value={f.nextDate}
                        onChange={(e) => patchForm(v.id, { nextDate: e.target.value })}
                        className="w-full font-nunito font-extrabold text-[13px] outline-none bg-transparent"
                      />
                      {!f.nextDate && autoDate && (
                        <span className="block text-[9px] text-hive-muted font-bold mt-0.5">
                          auto: {toDisplayDate(autoDate)} — type to override
                        </span>
                      )}
                    </label>
                  </div>
                  <label className={`inline-block bg-white border border-pantry-leaf text-pantry-leaf-dk rounded-full px-3 py-1.5 text-[12px] font-nunito font-extrabold cursor-pointer mb-1.5 ${scanningId === v.id ? 'opacity-60' : ''}`}>
                    {scanningId === v.id ? 'Reading…' : '📷 Scan service card'}
                    <input
                      type="file" accept="image/*" capture="environment" className="hidden"
                      disabled={scanningId === v.id}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (file) void scanCardFor(v.id, file);
                      }}
                    />
                  </label>
                  {scanMsg[v.id] && (
                    <p className="text-[11px] text-hive-muted font-bold mb-1">{scanMsg[v.id]}</p>
                  )}
                  {kmAlreadyDue && lastKm != null && (
                    <span className="inline-block bg-hive-rose/10 text-hive-rose rounded-full px-2.5 py-1 text-[11px] font-nunito font-extrabold mb-1">
                      ⚠️ below current {kmToDisplay(lastKm, distU).toLocaleString()} {distU} — already due
                    </span>
                  )}
                  {dateAlreadyDue && (
                    <span className="inline-block bg-hive-rose/10 text-hive-rose rounded-full px-2.5 py-1 text-[11px] font-nunito font-extrabold mb-1 ml-1">
                      ⚠️ date already passed — already due
                    </span>
                  )}
                  {armed && (
                    <p className="text-[11px] font-bold text-pantry-leaf-dk">
                      ✓ countdown armed
                      {kmLeftDisp != null ? ` · ~${kmLeftDisp.toLocaleString()} ${distU}` : ''}
                      {daysLeft != null ? ` · ${daysLeft} days left` : ''}
                    </p>
                  )}
                  <p className="text-[10px] text-hive-muted font-bold mt-1">
                    Whichever comes first triggers. These win over the schedule below and clear
                    automatically when a 🛠️ Service request closes.
                  </p>
                </div>
              );
            })()}

            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1.5">
              Service schedule — fallback when no sticker is set
            </p>
            <div className="grid grid-cols-2 gap-2 mb-1.5">
              <label className="bg-white border border-hive-line rounded-xl px-3 py-2">
                <span className="block text-[10px] text-hive-muted font-bold">Every ({distWord})</span>
                <input
                  type="number" inputMode="numeric" placeholder="5000"
                  value={f.intervalKm}
                  onChange={(e) => patchForm(v.id, { intervalKm: e.target.value })}
                  className="w-full font-nunito font-extrabold text-[15px] outline-none bg-transparent"
                />
              </label>
              <label className="bg-white border border-hive-line rounded-xl px-3 py-2">
                <span className="block text-[10px] text-hive-muted font-bold">And every (months)</span>
                <input
                  type="number" inputMode="numeric" placeholder="6"
                  value={f.intervalMonths}
                  onChange={(e) => patchForm(v.id, { intervalMonths: e.target.value })}
                  className="w-full font-nunito font-extrabold text-[15px] outline-none bg-transparent"
                />
              </label>
            </div>
            <p className="text-[11px] text-hive-muted font-bold mb-2">
              Whichever comes first. Last service:{' '}
              {v.serviceBaselineKm != null ? `${kmToDisplay(v.serviceBaselineKm, distU).toLocaleString()} ${distU}` : '—'}
              {v.serviceBaselineDate ? ` · ${toDisplayDate(v.serviceBaselineDate)}` : ''}
              {' '}
              <button
                type="button"
                onClick={() => patchForm(v.id, { resetOpen: !f.resetOpen })}
                className="text-pantry-leaf-dk underline font-bold"
              >
                {f.resetOpen ? 'cancel reset' : 'reset manually'}
              </button>
            </p>
            {f.resetOpen && (
              <div className="grid grid-cols-2 gap-2 mb-2 bg-hive-cream rounded-xl p-2">
                <label className="bg-white border border-hive-line rounded-xl px-3 py-2">
                  <span className="block text-[10px] text-hive-muted font-bold">Odometer at service ({distWord})</span>
                  <input
                    type="number" inputMode="numeric"
                    value={f.baselineKm}
                    onChange={(e) => patchForm(v.id, { baselineKm: e.target.value })}
                    className="w-full font-nunito font-extrabold text-[15px] outline-none bg-transparent"
                  />
                </label>
                <label className="bg-white border border-hive-line rounded-xl px-3 py-2">
                  <span className="block text-[10px] text-hive-muted font-bold">Service date</span>
                  <input
                    type="date"
                    value={f.baselineDate}
                    onChange={(e) => patchForm(v.id, { baselineDate: e.target.value })}
                    className="w-full font-nunito font-extrabold text-[13px] outline-none bg-transparent"
                  />
                </label>
                <p className="col-span-2 text-[10px] text-hive-muted font-bold">
                  Normally auto-set when a 🛠️ Service request closes — use this for services
                  done outside Kaya.
                </p>
              </div>
            )}

            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1.5 mt-3">
              Remind when
            </p>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="bg-white border border-hive-line rounded-xl px-3 py-2">
                <span className="block text-[10px] text-hive-muted font-bold">Distance left ≤ ({distWord})</span>
                <input
                  type="number" inputMode="numeric" placeholder={distU === 'km' ? '500' : '300'}
                  value={f.remindKmLeft}
                  onChange={(e) => patchForm(v.id, { remindKmLeft: e.target.value })}
                  className="w-full font-nunito font-extrabold text-[15px] outline-none bg-transparent"
                />
              </label>
              <label className="bg-white border border-hive-line rounded-xl px-3 py-2">
                <span className="block text-[10px] text-hive-muted font-bold">Days left ≤</span>
                <input
                  type="number" inputMode="numeric" placeholder="14"
                  value={f.remindDaysLeft}
                  onChange={(e) => patchForm(v.id, { remindDaysLeft: e.target.value })}
                  className="w-full font-nunito font-extrabold text-[15px] outline-none bg-transparent"
                />
              </label>
            </div>

            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">
              Who gets reminded
            </p>
            {([
              ['recipParents', 'Parents'],
              ['recipDrivers', 'Drivers on this vehicle'],
              ['recipAllHelpers', 'All helpers'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => patchForm(v.id, { [key]: !f[key] } as Partial<VehicleForm>)}
                className="flex items-center gap-2.5 py-1.5 w-full text-left"
              >
                <span className={`w-[22px] h-[22px] rounded-[7px] border-2 flex items-center justify-center text-[13px] text-white flex-shrink-0 ${
                  f[key] ? 'bg-pantry-leaf border-pantry-leaf' : 'border-hive-line bg-white'
                }`}>
                  {f[key] ? '✓' : ''}
                </span>
                <span className="font-nunito font-bold text-sm">{label}</span>
              </button>
            ))}

            <button
              type="button"
              onClick={() => save(v)}
              disabled={savingId === v.id}
              className="w-full bg-pantry-leaf text-white rounded-hive py-2.5 font-nunito font-black text-sm mt-3 disabled:opacity-60"
            >
              {savingId === v.id ? 'Saving…' : savedId === v.id ? '✓ Saved' : 'Save schedule'}
            </button>
          </div>
        );
      })}
    </div>
  );
}
