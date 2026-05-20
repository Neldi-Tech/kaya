'use client';

// /pantry/utility-meters — Manage the family's utility meters.
//
// Parent-only by default (the page redirects helpers back to /pantry/utility).
// Helpers with the household:utility grant CAN add meters via the rule
// — useful when a Gardener wants to register a new garden meter — but
// the management UI is parent-side for simplicity in v0.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  type UtilityMeter, type UtilityMeterType,
  METER_TYPES, meterEmoji,
  subscribeToMeters, addMeter, updateMeter, removeMeter,
} from '@/lib/utilityMeters';
import { type Cadence, CADENCE_LABEL } from '@/lib/pantry';

// Frequency choices offered for regular top-ups. Ordered most→least
// frequent. Excludes 'daily' (no meter tops up daily) + the long
// recurring-bill cadences (quarterly/yearly belong to recurring bills,
// not variable top-ups). 'as-needed' for unpredictable refills (gas).
const TOPUP_FREQUENCIES: Cadence[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'as-needed'];

export default function UtilityMetersPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const isParent = profile?.role === 'parent';

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry/utility');
  }, [profile, router]);

  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent') return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsub = subscribeToMeters(profile.familyId, (m) => { setMeters(m); setLoading(false); });
    return () => { clearTimeout(t); unsub(); };
  }, [profile?.familyId, profile?.role]);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ type: UtilityMeterType; label: string; providerRef: string; frequency: Cadence }>({
    type: 'electric', label: '', providerRef: '', frequency: 'weekly',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!profile?.familyId || isGuest) return;
    const label = form.label.trim();
    if (!label) return;
    setSaving(true);
    try {
      await addMeter(profile.familyId, {
        type: form.type,
        label,
        providerRef: form.providerRef.trim() || undefined,
        frequency: form.frequency,
      });
      setForm({ type: 'electric', label: '', providerRef: '', frequency: 'weekly' });
      setAdding(false);
    } finally { setSaving(false); }
  };

  // Group meters by type for fast scanning when there are many.
  const grouped = META_GROUP(meters);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Meter management is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Helpers can request top-ups against meters parents have set up.
        </p>
        <Link href="/pantry/utility" className="text-hive-honey-dk font-nunito font-bold text-sm underline">
          ← Back to Utility
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <Link href="/pantry/utility/setup" className="text-[12px] text-pantry-leaf-dk font-bold no-underline hover:underline inline-block mb-2">
          ← Utilities setup
        </Link>
        {/* Category banner — makes it unmistakable which of the two
            utility categories this page configures. (Utilities v2) */}
        <div className="rounded-hive border border-pantry-leaf bg-[#E6F2EC] p-3 mb-3">
          <p className="font-nunito font-black text-pantry-leaf-dk text-sm flex items-center gap-1.5">
            🔌 Regular top-ups
          </p>
          <p className="text-[12px] text-hive-ink mt-0.5 leading-snug">
            Variable amount the helper buys as they run low (power, water, gas).
            Set the meter + how often; <strong>helpers request each top-up</strong>.
          </p>
        </div>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {meters.length === 0 ? 'Add your first meter' : `${meters.length} meter${meters.length === 1 ? '' : 's'}`}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Register each meter once. Helpers pick from this list when requesting a top-up.
        </p>
      </div>

      {/* Add form */}
      {adding ? (
        <div className="bg-hive-paper border border-hive-honey rounded-hive p-4 mt-4">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-honey-dk mb-3">New meter</p>
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Type</span>
            <div className="flex gap-2 mt-1 flex-wrap">
              {METER_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setForm({ ...form, type: t.id })}
                  className={`text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${
                    form.type === t.id
                      ? 'bg-hive-honey text-white border-hive-honey-dk'
                      : 'bg-hive-cream border-hive-line text-hive-muted'
                  }`}
                >{t.emoji} {t.label}</button>
              ))}
            </div>
          </label>
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Label</span>
            <input
              autoFocus
              type="text"
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder="e.g. Main House"
              className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
            />
          </label>
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Meter # (optional)</span>
            <input
              type="text"
              value={form.providerRef}
              onChange={(e) => setForm({ ...form, providerRef: e.target.value })}
              placeholder="LUKU 0124-887"
              className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
            />
          </label>
          {/* Frequency picker — how often this top-up is bought. Named
              choices (incl "2× a week" + "2× a month") replace the old
              raw "avg cycle days" input. (Utilities v2, 2026-05-20) */}
          <div className="mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">How often topped up</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {TOPUP_FREQUENCIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setForm({ ...form, frequency: f })}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-nunito font-extrabold border ${
                    form.frequency === f
                      ? 'bg-hive-honey text-white border-hive-honey'
                      : 'bg-white text-hive-muted border-hive-line'
                  }`}
                >
                  {CADENCE_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-2">
            <button onClick={() => setAdding(false)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
            <button onClick={submit} disabled={saving || !form.label.trim()} className="bg-hive-honey text-white rounded-lg py-2 font-nunito font-black text-sm disabled:opacity-60">
              {saving ? 'Adding…' : 'Add meter'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="w-full mt-4 bg-hive-honey text-white rounded-hive py-3.5 font-nunito font-black text-sm shadow-lg shadow-hive-honey/30"
        >
          ＋ Add a meter
        </button>
      )}

      {/* Meter list */}
      {loading ? (
        <p className="text-hive-muted text-sm text-center mt-6">Loading…</p>
      ) : meters.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center mt-6">
          <div className="text-3xl mb-2">⚡</div>
          <h3 className="font-nunito font-black text-lg">No meters yet</h3>
          <p className="text-hive-muted text-sm mt-1">
            Tap "Add a meter" above. Tim's family example: 5 electric meters (Main House, Cottage, Workshop, Pool, Garden).
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([type, list]) => (
          <div key={type} className="mt-5">
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk mb-2">
              {meterEmoji(type as UtilityMeterType)} {list.length} {list.length === 1 ? 'meter' : 'meters'}
            </p>
            <div className="flex flex-col gap-2">
              {list.map((m) => (
                <MeterRow key={m.id} meter={m} familyId={profile!.familyId!} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MeterRow({ meter, familyId }: { meter: UtilityMeter; familyId: string }) {
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(meter.label);
  const [providerRef, setProviderRef] = useState(meter.providerRef ?? '');
  const [frequency, setFrequency] = useState<Cadence>(meter.frequency ?? 'weekly');

  const save = async () => {
    setBusy(true);
    try {
      await updateMeter(familyId, meter.id, {
        label: label.trim() || meter.label,
        providerRef: providerRef.trim() || undefined,
        frequency,
      });
      setEditing(false);
    } finally { setBusy(false); }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: `Remove meter "${meter.label}"?`,
      message: "Past requests stay; new requests can't pick it.",
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try { await removeMeter(familyId, meter.id); } finally { setBusy(false); }
  };

  if (editing) {
    return (
      <div className="bg-hive-paper border border-hive-honey rounded-hive p-3">
        <input
          autoFocus
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mb-2"
        />
        <input
          value={providerRef}
          onChange={(e) => setProviderRef(e.target.value)}
          placeholder="Meter # (optional)"
          className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mb-2"
        />
        <div className="mb-2">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">How often topped up</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {TOPUP_FREQUENCIES.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-nunito font-extrabold border ${
                  frequency === f
                    ? 'bg-hive-honey text-white border-hive-honey'
                    : 'bg-white text-hive-muted border-hive-line'
                }`}
              >
                {CADENCE_LABEL[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setEditing(false)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="bg-hive-honey text-white rounded-lg py-2 font-nunito font-black text-sm">Save</button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center gap-3">
      <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-base">
        {meterEmoji(meter.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{meter.label}</div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5">
          {meter.providerRef ? `# ${meter.providerRef}` : 'No meter number'}
          {meter.frequency
            ? ` · ${CADENCE_LABEL[meter.frequency]}`
            : meter.cadenceDays != null
              ? ` · ~${meter.cadenceDays}d cycle`
              : ''}
        </div>
      </div>
      <button onClick={() => setEditing(true)} className="text-xs font-nunito font-bold text-hive-honey-dk px-2">Edit</button>
      <button onClick={remove} disabled={busy} className="text-xs font-nunito font-bold text-hive-rose px-2">Remove</button>
    </div>
  );
}

// Group meters by type — keeps "5 electric meters" tight in the UI.
function META_GROUP(meters: UtilityMeter[]): Record<string, UtilityMeter[]> {
  const out: Record<string, UtilityMeter[]> = {};
  for (const m of meters) {
    if (!m.active) continue;
    (out[m.type] ??= []).push(m);
  }
  return out;
}
