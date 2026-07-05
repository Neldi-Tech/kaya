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
  type Vehicle, subscribeToVehicles, updateVehicle, vehicleEmoji,
} from '@/lib/vehicles';
import { readDriversConfig, setDriversConfig } from '@/lib/purchase';
import { readFamilyUnits, kmToDisplay, displayToKm } from '@/lib/units';
import { toDisplayDate } from '@/lib/dates';

interface VehicleForm {
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

            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1.5">
              Service schedule
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
