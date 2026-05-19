'use client';

// /pantry/drivers/vehicles — Manage the family's vehicles.
//
// 2026-05-18 — added on the verification pass. Mirrors /pantry/utility-meters
// (same shape, same patterns) since both are "small registry that
// requests pin to". Parent-only by default; helpers with the
// household:drivers grant CAN add vehicles via the rule (useful when
// the driver buys a new car for the family) but the management UI
// stays parent-side for v0.
//
// Forward-looking: when Kaya Wealth ships, the vehicle registry
// becomes a KW concern. This page will then read from / link out to
// the KW asset surface. The local Vehicle interface is intentionally
// narrow — just what the request flow needs — so the eventual
// migration is a swap, not a rewrite.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  type Vehicle, type VehicleType, type VehicleFuel,
  VEHICLE_TYPES, VEHICLE_FUELS, VEHICLE_COLORS,
  vehicleEmoji, vehicleColorHex, vehicleFuelLabel,
  subscribeToVehicles, addVehicle, updateVehicle, removeVehicle,
} from '@/lib/vehicles';

export default function VehiclesPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();

  // Parent-only management. Helpers bounce to /pantry/drivers — the
  // request flow there is what they need (it auto-shows the picker
  // when there are vehicles, or a no-vehicle catch-all when there
  // aren't).
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry/drivers');
  }, [profile, router]);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent') return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsub = subscribeToVehicles(profile.familyId, (v) => { setVehicles(v); setLoading(false); });
    return () => { clearTimeout(t); unsub(); };
  }, [profile?.familyId, profile?.role]);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{
    type: VehicleType; label: string; plate: string; makeModel: string;
    year: string; color: string; colorOther: string; fuel: VehicleFuel | '';
  }>({
    type: 'sedan', label: '', plate: '', makeModel: '', year: '',
    color: '', colorOther: '', fuel: '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!profile?.familyId || isGuest) return;
    const label = form.label.trim();
    if (!label) return;
    setSaving(true);
    try {
      // Resolve color: 'other' means use the free-text value; everything
      // else is the curated swatch label. Empty → undefined.
      const colorValue = form.color === 'other'
        ? (form.colorOther.trim() || undefined)
        : (form.color || undefined);
      await addVehicle(profile.familyId, {
        type: form.type,
        label,
        plate:     form.plate.trim()     || undefined,
        makeModel: form.makeModel.trim() || undefined,
        year:      form.year ? parseInt(form.year, 10) : undefined,
        color:     colorValue,
        fuel:      form.fuel || undefined,
      });
      setForm({
        type: 'sedan', label: '', plate: '', makeModel: '', year: '',
        color: '', colorOther: '', fuel: '',
      });
      setAdding(false);
    } finally { setSaving(false); }
  };

  // Group vehicles by type (sedans together, bikes together) — keeps
  // a multi-car garage scannable.
  const grouped = VEHICLE_GROUP(vehicles);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Vehicle management is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Drivers can pick from the list parents set up when requesting a service or top-up.
        </p>
        <Link href="/pantry/drivers" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Drivers
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Drivers · Vehicles
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {vehicles.length === 0 ? 'Add your first vehicle' : `${vehicles.length} vehicle${vehicles.length === 1 ? '' : 's'}`}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Register each car once. Drivers pick from this list when requesting a service, fuel, parts, etc.
          When <span className="font-bold">Kaya Wealth</span> lands, this list will be sourced from there automatically.
        </p>
        <Link href="/pantry/drivers" className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline mt-2 inline-block">
          ← Back to Drivers
        </Link>
      </div>

      {/* Add form */}
      {adding ? (
        <div className="bg-hive-paper border border-pantry-leaf rounded-hive p-4 mt-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk mb-3">New vehicle</p>
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Type</span>
            <div className="flex gap-2 mt-1 flex-wrap">
              {VEHICLE_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setForm({ ...form, type: t.id })}
                  className={`text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${
                    form.type === t.id
                      ? 'bg-pantry-leaf text-white border-pantry-leaf-dk'
                      : 'bg-hive-cream border-hive-line text-hive-muted'
                  }`}
                >{t.emoji} {t.label}</button>
              ))}
            </div>
          </label>
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Label · what the family calls it</span>
            <input
              autoFocus
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Diana's RAV4 / Big Hilux / School pickup"
              className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <label className="block">
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Plate (optional)</span>
              <input
                type="text"
                value={form.plate}
                onChange={(e) => setForm({ ...form, plate: e.target.value.toUpperCase() })}
                placeholder="T 123 ABC"
                className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
              />
            </label>
            <label className="block">
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Year (optional)</span>
              <input
                type="number" min={1980} max={2100}
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                placeholder="2018"
                className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
              />
            </label>
          </div>
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Make + model</span>
            <input
              type="text"
              value={form.makeModel}
              onChange={(e) => setForm({ ...form, makeModel: e.target.value })}
              placeholder="Toyota RAV4"
              className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
            />
          </label>
          {/* Colour — curated swatch chips with an "Other" free-text
              fallback for wraps / two-tone / dealer-specific shades. */}
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Colour</span>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {VEHICLE_COLORS.map((c) => {
                const active = form.color === c.label;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setForm({ ...form, color: c.label, colorOther: '' })}
                    className={`text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full border flex items-center gap-1.5 ${
                      active
                        ? 'bg-pantry-leaf-soft border-pantry-leaf-dk text-pantry-leaf-dk'
                        : 'bg-hive-cream border-hive-line text-hive-muted'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full border border-hive-line/60 inline-block"
                      style={{ backgroundColor: c.hex }}
                    />
                    {c.label}
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setForm({ ...form, color: 'other' })}
                className={`text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full border ${
                  form.color === 'other'
                    ? 'bg-pantry-leaf-soft border-pantry-leaf-dk text-pantry-leaf-dk'
                    : 'bg-hive-cream border-hive-line text-hive-muted'
                }`}
              >
                ✏️ Other
              </button>
            </div>
            {form.color === 'other' && (
              <input
                type="text"
                value={form.colorOther}
                onChange={(e) => setForm({ ...form, colorOther: e.target.value })}
                placeholder="e.g. Wrapped matte black"
                className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-2"
              />
            )}
          </label>
          {/* Fuel — drives request auto-suggestions for fuel prices on
              the Drivers request flow. Optional. Grouped: Conventional
              first (most common), Green tier below. */}
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Fuel (optional)</span>
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {VEHICLE_FUELS.filter((f) => f.group === 'conventional').map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setForm({ ...form, fuel: form.fuel === f.id ? '' : f.id })}
                  className={`text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full border ${
                    form.fuel === f.id
                      ? 'bg-hive-honey text-white border-hive-honey-dk'
                      : 'bg-hive-cream border-hive-line text-hive-muted'
                  }`}
                >{f.emoji} {f.label}</button>
              ))}
            </div>
            <div className="text-[9px] uppercase tracking-[1.5px] font-bold text-pantry-leaf-dk mt-2 mb-1">🌱 Green options</div>
            <div className="flex gap-1.5 flex-wrap">
              {VEHICLE_FUELS.filter((f) => f.group === 'green').map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setForm({ ...form, fuel: form.fuel === f.id ? '' : f.id })}
                  className={`text-[11px] font-nunito font-extrabold px-2.5 py-1 rounded-full border ${
                    form.fuel === f.id
                      ? 'bg-pantry-leaf text-white border-pantry-leaf-dk'
                      : 'bg-hive-cream border-hive-line text-hive-muted'
                  }`}
                >{f.emoji} {f.label}</button>
              ))}
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button onClick={() => setAdding(false)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
            <button onClick={submit} disabled={saving || !form.label.trim()} className="bg-pantry-leaf text-white rounded-lg py-2 font-nunito font-black text-sm disabled:opacity-60">
              {saving ? 'Adding…' : 'Add vehicle'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full mt-4 bg-pantry-leaf text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-pantry-leaf/30"
        >
          ＋ Add a vehicle
        </button>
      )}

      {/* Vehicle list */}
      {loading ? (
        <p className="text-hive-muted text-sm text-center mt-6">Loading…</p>
      ) : vehicles.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-6">
          <div className="text-3xl mb-2">🚗</div>
          <h3 className="font-nunito font-black text-lg">No vehicles yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Tap "Add a vehicle" above. Example: a family in Dar with two cars + a boda might register
            "School pickup" (Toyota Noah), "Daddy's car" (Land Cruiser), and "Boda 1" (TVS).
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([type, list]) => (
          <div key={type} className="mt-5">
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-pantry-leaf-dk mb-2">
              {vehicleEmoji(type as VehicleType)} {list.length} {list.length === 1 ? 'vehicle' : 'vehicles'}
            </p>
            <div className="flex flex-col gap-2">
              {list.map((v) => (
                <VehicleRow key={v.id} vehicle={v} familyId={profile!.familyId!} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function VehicleRow({ vehicle, familyId }: { vehicle: Vehicle; familyId: string }) {
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(vehicle.label);
  const [plate, setPlate] = useState(vehicle.plate ?? '');
  const [makeModel, setMakeModel] = useState(vehicle.makeModel ?? '');
  const [color, setColor] = useState(vehicle.color ?? '');

  const save = async () => {
    setBusy(true);
    try {
      await updateVehicle(familyId, vehicle.id, {
        label:     label.trim() || vehicle.label,
        plate:     plate.trim()     || undefined,
        makeModel: makeModel.trim() || undefined,
        color:     color.trim()     || undefined,
      });
      setEditing(false);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove "${vehicle.label}"?`,
      message: "Past requests stay; new requests can't pick it.",
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await removeVehicle(familyId, vehicle.id); } finally { setBusy(false); }
  };

  if (editing) {
    return (
      <div className="bg-hive-paper border border-pantry-leaf rounded-hive p-3">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label"
          className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mb-2"
        />
        <div className="grid grid-cols-2 gap-2 mb-2">
          <input
            value={plate}
            onChange={(e) => setPlate(e.target.value.toUpperCase())}
            placeholder="Plate"
            className="border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold"
          />
          <input
            value={color}
            onChange={(e) => setColor(e.target.value)}
            placeholder="Colour"
            className="border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold"
          />
        </div>
        <input
          value={makeModel}
          onChange={(e) => setMakeModel(e.target.value)}
          placeholder="Make + model"
          className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mb-2"
        />
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setEditing(false)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="bg-pantry-leaf text-white rounded-lg py-2 font-nunito font-black text-sm">Save</button>
        </div>
      </div>
    );
  }

  // Sub-line: make/model · plate · year · color · fuel. Color is the
  // label (matched against the curated palette for a swatch dot); fuel
  // renders as its display label. Both fields are optional.
  const colorHex = vehicleColorHex(vehicle.color);
  const fuelLabel = vehicleFuelLabel(vehicle.fuel);
  const subParts = [vehicle.makeModel, vehicle.plate, vehicle.year].filter(Boolean) as Array<string | number>;
  return (
    <div className={`bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3 ${vehicle.active ? '' : 'opacity-60'}`}>
      <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base">
        {vehicleEmoji(vehicle.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{vehicle.label}</div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5 flex items-center gap-1.5 flex-wrap">
          {subParts.length > 0 ? <span>{subParts.join(' · ')}</span> : null}
          {vehicle.color && (
            <span className="inline-flex items-center gap-1">
              {colorHex && (
                <span
                  className="w-2.5 h-2.5 rounded-full border border-hive-line/60 inline-block"
                  style={{ backgroundColor: colorHex }}
                />
              )}
              <span>{vehicle.color}</span>
            </span>
          )}
          {fuelLabel && (
            <span className="inline-flex items-center bg-hive-cream border border-hive-line rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[1px]">
              {fuelLabel}
            </span>
          )}
          {!subParts.length && !vehicle.color && !fuelLabel && (
            <span className="italic">No details — tap Edit to add plate, model, colour, fuel</span>
          )}
          {!vehicle.active && <span className="text-hive-muted">· paused</span>}
        </div>
      </div>
      <button onClick={() => setEditing(true)} className="text-xs font-nunito font-bold text-pantry-leaf-dk px-2">Edit</button>
      <button onClick={remove} disabled={busy} className="text-xs font-nunito font-bold text-hive-rose px-2">Remove</button>
    </div>
  );
}

// Group active vehicles by type — keeps a multi-car garage tight.
function VEHICLE_GROUP(vehicles: Vehicle[]): Record<string, Vehicle[]> {
  const out: Record<string, Vehicle[]> = {};
  for (const v of vehicles) {
    if (!v.active) continue;
    (out[v.type] ??= []).push(v);
  }
  return out;
}
