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
import { type Cadence, CADENCE_LABEL, type Supplier, subscribeToSuppliers } from '@/lib/pantry';
import { suggestedReminderDays } from '@/lib/utilityReminders';
import { getLatestReading, type PulseReading } from '@/lib/pulse';
import { relativeDayLabel } from '@/lib/dates';
import { useHive } from '@/contexts/HiveContext';
import { useFamily } from '@/contexts/FamilyContext';
import { formatCents } from '@/components/pantry/format';
import { getFamilyMembers, type UserProfile } from '@/lib/firestore';
import { resolveAlertRecipients, type AlertEmailsConfig } from '@/lib/alertEmails';

// Frequency choices offered for regular top-ups. Ordered most→least
// frequent. Excludes 'daily' (no meter tops up daily) + the long
// recurring-bill cadences (quarterly/yearly belong to recurring bills,
// not variable top-ups). 'as-needed' for unpredictable refills (gas).
const TOPUP_FREQUENCIES: Cadence[] = ['weekly', 'biweekly', 'semimonthly', 'monthly', 'as-needed'];

export default function UtilityMetersPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry/utility');
  }, [profile, router]);

  const { family } = useFamily();
  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  // Parents feed the per-meter "Email goes to" override (VIS PR4).
  const [parentProfiles, setParentProfiles] = useState<UserProfile[]>([]);
  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    let alive = true;
    getFamilyMembers(profile.familyId).then((ms) => {
      if (alive) setParentProfiles(ms.filter((m) => m.role === 'parent'));
    });
    return () => { alive = false; };
  }, [profile?.familyId, profile?.role]);
  const [lastByMeter, setLastByMeter] = useState<Record<string, PulseReading | null>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent') return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsub = subscribeToMeters(profile.familyId, (m) => { setMeters(m); setLoading(false); });
    const unsubSup = subscribeToSuppliers(profile.familyId, 'all', setSuppliers);
    return () => { clearTimeout(t); unsub(); unsubSup(); };
  }, [profile?.familyId, profile?.role]);

  // Fetch the latest reading per meter for the at-a-glance "last entry" line.
  // One-shot per meter (small sets); re-runs whenever the meter list changes.
  useEffect(() => {
    const fid = profile?.familyId;
    if (!fid || meters.length === 0) return;
    let cancelled = false;
    (async () => {
      const entries = await Promise.all(
        meters.map(async (m) => [m.id, await getLatestReading(fid, m.id).catch(() => null)] as const),
      );
      if (!cancelled) setLastByMeter(Object.fromEntries(entries));
    })();
    return () => { cancelled = true; };
  }, [profile?.familyId, meters]);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{
    type: UtilityMeterType; label: string; providerRef: string; frequency: Cadence;
    estimatedMajor: number; pricePerUnitMajor: number; unit: string;
    preferredSupplierId: string; reminderDays: number[];
  }>({
    type: 'electric', label: '', providerRef: '', frequency: 'weekly',
    estimatedMajor: 0, pricePerUnitMajor: 0, unit: '',
    preferredSupplierId: '', reminderDays: [],
  });
  const [saving, setSaving] = useState(false);
  const [protectCfg, setProtectCfg] = useState<ProtectState>(EMPTY_PROTECT);

  // Changing frequency re-seeds the suggested reminder days (editable).
  const setFrequency = (frequency: Cadence) => {
    setForm((f) => ({ ...f, frequency, reminderDays: suggestedReminderDays(frequency) }));
  };
  const toggleReminderDay = (day: number) => {
    setForm((f) => ({
      ...f,
      reminderDays: f.reminderDays.includes(day)
        ? f.reminderDays.filter((d) => d !== day)
        : [...f.reminderDays, day].sort((a, b) => a - b),
    }));
  };

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
        estimatedCents: form.estimatedMajor > 0 ? Math.round(form.estimatedMajor * 100) : undefined,
        pricePerUnitCents: form.pricePerUnitMajor > 0 ? Math.round(form.pricePerUnitMajor * 100) : undefined,
        unit: form.unit.trim() || undefined,
        preferredSupplierId: form.preferredSupplierId || undefined,
        reminderDays: form.reminderDays.length > 0 ? form.reminderDays : undefined,
        ...protectionPatch(protectCfg),
      });
      setForm({
        type: 'electric', label: '', providerRef: '', frequency: 'weekly',
        estimatedMajor: 0, pricePerUnitMajor: 0, unit: '',
        preferredSupplierId: '', reminderDays: [],
      });
      setProtectCfg(EMPTY_PROTECT);
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
        <Link
          href="/pantry/utility-meters/alerts"
          className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 rounded-full text-[11px] font-nunito font-black bg-hive-paper border border-hive-line text-hive-honey-dk hover:border-hive-honey"
        >
          📜 Alert log · what was sent, to whom ›
        </Link>
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
                  onClick={() => setFrequency(f)}
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

          {/* Estimated typical top-up (editable any time) — pre-fills
              the request + feeds the budget. (2026-05-20) */}
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Estimated amount (optional)</span>
            <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 mt-1 focus-within:border-hive-honey">
              <span className="text-xs text-hive-muted font-bold">{currency}</span>
              <input
                type="number" min={0} step="0.01"
                value={form.estimatedMajor || ''}
                onChange={(e) => setForm({ ...form, estimatedMajor: Number(e.target.value) })}
                placeholder="0.00"
                className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent"
              />
              <span className="text-[10px] text-hive-muted font-bold">/ top-up</span>
            </div>
          </label>

          {/* Price per unit (editable any time — tariffs change). When
              set, the request shows a read-only "≈ N {unit}" estimate of
              how much consumption the top-up buys. (2026-05-21) */}
          <label className="block mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Price per unit (optional)</span>
            <div className="flex items-center gap-2 mt-1">
              <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 flex-1 focus-within:border-hive-honey">
                <span className="text-xs text-hive-muted font-bold">{currency}</span>
                <input
                  type="number" min={0} step="0.01"
                  value={form.pricePerUnitMajor || ''}
                  onChange={(e) => setForm({ ...form, pricePerUnitMajor: Number(e.target.value) })}
                  placeholder="0.00"
                  className="flex-1 min-w-0 text-sm font-nunito font-bold focus:outline-none bg-transparent"
                />
              </div>
              <span className="text-xs text-hive-muted font-bold">/</span>
              <input
                type="text"
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                placeholder="kWh"
                className="w-24 border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold focus:outline-none focus:border-hive-honey"
              />
            </div>
            <p className="text-[10px] text-hive-muted mt-1 leading-snug">
              e.g. cost per kWh / litre. Shows the helper an estimated units figure on each top-up.
            </p>
          </label>

          {/* Preferred supplier — links to the shared suppliers list. */}
          {suppliers.length > 0 && (
            <label className="block mb-2">
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Preferred supplier (optional)</span>
              <select
                value={form.preferredSupplierId}
                onChange={(e) => setForm({ ...form, preferredSupplierId: e.target.value })}
                className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1 bg-white"
              >
                <option value="">— None —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}

          {/* Reminder days — auto-suggested for 2× a month (1st & 15th),
              editable. Reminder ONLY fires a helper nudge (no auto-
              request). (2026-05-20) */}
          {form.frequency !== 'as-needed' && (
            <div className="mb-2">
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">
                Reminder days {form.frequency === 'semimonthly' ? '(suggested: 1st & 15th)' : '(optional)'}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1 items-center">
                {form.reminderDays.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleReminderDay(d)}
                    className="px-2.5 py-1 rounded-full text-xs font-nunito font-extrabold bg-hive-honey text-white border border-hive-honey-dk"
                  >
                    {d} ×
                  </button>
                ))}
                <select
                  value=""
                  onChange={(e) => { if (e.target.value) toggleReminderDay(Number(e.target.value)); }}
                  className="border border-dashed border-hive-line rounded-full px-2 py-1 text-xs font-nunito font-bold bg-white text-hive-muted"
                >
                  <option value="">＋ day</option>
                  {Array.from({ length: 28 }, (_, i) => i + 1)
                    .filter((d) => !form.reminderDays.includes(d))
                    .map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-hive-muted mt-1 leading-snug">
                On these days the helper gets a nudge to launch a top-up request — reminder only, no auto-request.
              </p>
            </div>
          )}

          {/* Auto top-up (Kaya Plus) */}
          <ProtectionFields value={protectCfg} onChange={(p) => setProtectCfg((s) => ({ ...s, ...p }))} currency={currency} pricePerUnitMajor={form.pricePerUnitMajor} unit={form.unit} parents={parentProfiles} alertCfg={family?.alertEmails} />

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
                <MeterRow key={m.id} meter={m} familyId={profile!.familyId!} currency={currency} suppliers={suppliers} last={lastByMeter[m.id] ?? null} parents={parentProfiles} alertCfg={family?.alertEmails} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function MeterRow({ meter, familyId, currency, suppliers, last, parents, alertCfg }: {
  meter: UtilityMeter; familyId: string; currency: string; suppliers: Supplier[]; last: PulseReading | null;
  parents: UserProfile[]; alertCfg?: AlertEmailsConfig;
}) {
  const confirmAction = useConfirm();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(meter.label);
  const [providerRef, setProviderRef] = useState(meter.providerRef ?? '');
  const [frequency, setFrequencyState] = useState<Cadence>(meter.frequency ?? 'weekly');
  const [estimatedMajor, setEstimatedMajor] = useState<number>(
    meter.estimatedCents ? meter.estimatedCents / 100 : 0,
  );
  const [pricePerUnitMajor, setPricePerUnitMajor] = useState<number>(
    meter.pricePerUnitCents ? meter.pricePerUnitCents / 100 : 0,
  );
  const [unit, setUnit] = useState<string>(meter.unit ?? '');
  const [supplierId, setSupplierId] = useState<string>(meter.preferredSupplierId ?? '');
  const [reminderDays, setReminderDays] = useState<number[]>(meter.reminderDays ?? []);
  const [protectCfg, setProtectCfg] = useState<ProtectState>(protectStateFor(meter));

  const setFrequency = (f: Cadence) => {
    setFrequencyState(f);
    // Re-seed suggested reminder days only when none are set yet.
    if (reminderDays.length === 0) setReminderDays(suggestedReminderDays(f));
  };
  const toggleReminderDay = (day: number) => {
    setReminderDays((prev) => prev.includes(day)
      ? prev.filter((d) => d !== day)
      : [...prev, day].sort((a, b) => a - b));
  };

  const save = async () => {
    setBusy(true);
    try {
      await updateMeter(familyId, meter.id, {
        label: label.trim() || meter.label,
        providerRef: providerRef.trim() || undefined,
        frequency,
        estimatedCents: estimatedMajor > 0 ? Math.round(estimatedMajor * 100) : undefined,
        pricePerUnitCents: pricePerUnitMajor > 0 ? Math.round(pricePerUnitMajor * 100) : undefined,
        unit: unit.trim() || undefined,
        preferredSupplierId: supplierId || undefined,
        reminderDays: reminderDays.length > 0 ? reminderDays : undefined,
        ...protectionPatch(protectCfg),
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
        <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 mb-2">
          <span className="text-xs text-hive-muted font-bold">{currency}</span>
          <input
            type="number" min={0} step="0.01"
            value={estimatedMajor || ''}
            onChange={(e) => setEstimatedMajor(Number(e.target.value))}
            placeholder="estimated / top-up"
            className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent"
          />
        </div>
        {/* Price per unit — editable any time (tariffs change). */}
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 flex-1 focus-within:border-hive-honey">
            <span className="text-xs text-hive-muted font-bold">{currency}</span>
            <input
              type="number" min={0} step="0.01"
              value={pricePerUnitMajor || ''}
              onChange={(e) => setPricePerUnitMajor(Number(e.target.value))}
              placeholder="price / unit"
              className="flex-1 min-w-0 text-sm font-nunito font-bold focus:outline-none bg-transparent"
            />
          </div>
          <span className="text-xs text-hive-muted font-bold">/</span>
          <input
            type="text"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="kWh"
            className="w-20 border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold focus:outline-none focus:border-hive-honey"
          />
        </div>
        {suppliers.length > 0 && (
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mb-2 bg-white"
          >
            <option value="">— No supplier —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
        {frequency !== 'as-needed' && (
          <div className="mb-2">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Reminder days</span>
            <div className="flex flex-wrap gap-1.5 mt-1 items-center">
              {reminderDays.map((d) => (
                <button key={d} type="button" onClick={() => toggleReminderDay(d)}
                  className="px-2.5 py-1 rounded-full text-xs font-nunito font-extrabold bg-hive-honey text-white border border-hive-honey-dk">
                  {d} ×
                </button>
              ))}
              <select
                value=""
                onChange={(e) => { if (e.target.value) toggleReminderDay(Number(e.target.value)); }}
                className="border border-dashed border-hive-line rounded-full px-2 py-1 text-xs font-nunito font-bold bg-white text-hive-muted"
              >
                <option value="">＋ day</option>
                {Array.from({ length: 28 }, (_, i) => i + 1)
                  .filter((d) => !reminderDays.includes(d))
                  .map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
        )}
        {/* 🔔 Low-balance protection (Kaya Plus) */}
        <ProtectionFields value={protectCfg} onChange={(p) => setProtectCfg((s) => ({ ...s, ...p }))} currency={currency} pricePerUnitMajor={pricePerUnitMajor} unit={unit} parents={parents} alertCfg={alertCfg} />

        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setEditing(false)} className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm">Cancel</button>
          <button onClick={save} disabled={busy} className="bg-hive-honey text-white rounded-lg py-2 font-nunito font-black text-sm">Save</button>
        </div>
      </div>
    );
  }

  // Latest reading line — what the meter shows right now + when it was logged.
  // Prepaid/depleting meters ('down', e.g. LUKU) read as a remaining balance;
  // cumulative meters ('up', e.g. city water) read as the running total.
  const direction = meter.direction ?? (meter.type === 'water' ? 'up' : 'down');
  const unitSuffix = meter.unit ? ` ${meter.unit}` : ' units';
  const lastEntry = last && Number.isFinite(last.value)
    ? `${last.value.toLocaleString()}${unitSuffix}${direction === 'down' ? ' left' : ''} · ${relativeDayLabel(last.dayKey)}`
    : null;

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl bg-[#FFF3D9] flex items-center justify-center text-base shrink-0">
        {meterEmoji(meter.type)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{meter.label}</div>
        <div className="text-[11px] text-hive-muted font-bold mt-0.5 break-words">
          {meter.providerRef ? `# ${meter.providerRef}` : 'No meter number'}
          {meter.frequency
            ? ` · ${CADENCE_LABEL[meter.frequency]}`
            : meter.cadenceDays != null
              ? ` · ~${meter.cadenceDays}d cycle`
              : ''}
          {meter.estimatedCents && meter.estimatedCents > 0
            ? ` · ≈ ${formatCents(meter.estimatedCents, currency)}`
            : ''}
          {meter.pricePerUnitCents && meter.pricePerUnitCents > 0
            ? ` · ${formatCents(meter.pricePerUnitCents, currency)}/${meter.unit || 'unit'}`
            : ''}
        </div>
        {/* Last entry — at-a-glance balance/reading + when. */}
        {lastEntry && (
          <div className="text-[11px] text-pantry-leaf-dk font-nunito font-extrabold mt-1 break-words">
            📊 {lastEntry}
          </div>
        )}
        {/* Honest protection status — mirrors the server engine's guards
            (direction + threshold) so the chip never claims cover that
            the engine wouldn't actually provide. Depleting meters only. */}
        {direction === 'down' && meter.active !== false && (
          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
            {meter.lowAlertAt && meter.autoTopUpPendingRequestId ? (
              <Link
                href={`/pantry/purchase/${meter.autoTopUpPendingRequestId}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40"
              >
                🔔 LOW · request sent →
              </Link>
            ) : meter.lowAlertAt ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FDE8E8] text-hive-rose border border-hive-rose/40">
                🔔 LOW{meter.lowAlertBalance != null ? ` · ${meter.lowAlertBalance.toLocaleString()}${meter.unit ? ` ${meter.unit}` : ''} left` : ''}
              </span>
            ) : (meter.minUnitsThreshold ?? 0) > 0 ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#E7F5EC] text-pantry-leaf-dk border border-pantry-leaf-dk/30">
                ✅ Protected · below {meter.minUnitsThreshold}{unitSuffix}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FFF3D9] text-hive-honey-dk border border-hive-honey/50"
              >
                ⚠️ Set protection
              </button>
            )}
            {/* The trace — alerted meters link straight to their log entry
                surface (VIS PR2): what was sent, to whom, on which channels. */}
            {meter.lowAlertAt ? (
              <Link
                href="/pantry/utility-meters/alerts"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-white text-hive-muted border border-hive-line hover:border-hive-honey"
              >
                📜 alerted {new Date(meter.lowAlertAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · view
              </Link>
            ) : null}
          </div>
        )}
        {meter.reminderDays && meter.reminderDays.length > 0 && (
          <div className="text-[10px] text-hive-honey-dk font-nunito font-extrabold mt-0.5 break-words">
            🔔 Reminds on the {meter.reminderDays.map((d) => ordinalDay(d)).join(', ')}
          </div>
        )}
        {meter.autoTopUp && (
          <div className="text-[10px] text-hive-honey-dk font-nunito font-extrabold mt-0.5 break-words">
            🔄 Auto top-up{meter.minUnitsThreshold ? ` below ${meter.minUnitsThreshold}${meter.unit ? ` ${meter.unit}` : ' units'}` : ''} → {meter.autoTopUpSource === 'fixed' && meter.autoTopUpAmountCents ? `set ${formatCents(meter.autoTopUpAmountCents, currency)}` : 'same as last'}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <button onClick={() => setEditing(true)} className="text-xs font-nunito font-bold text-hive-honey-dk px-2">Edit</button>
        <button onClick={remove} disabled={busy} className="text-xs font-nunito font-bold text-hive-rose px-2">Remove</button>
      </div>
    </div>
  );
}

// ── 🔔 Low-balance protection — shared form block used by add + edit ──────
// NB: not exported — a Next.js page file may only export the default component.
// NOTE: these settings fold into the central Household Setup (gear) when the
// Drivers v2 track lands — keep this block portable (no page-local deps).
interface ProtectState {
  protect: boolean;            // master switch = threshold armed
  threshold: number;           // units left that trip the alert
  forecastDays: number;        // also warn when ≤ N days of balance remain
  chEmail: boolean; chInapp: boolean; chChat: boolean;
  autoRequest: boolean;        // Kaya drafts the top-up request (parent still approves)
  source: 'last' | 'fixed';
  amountMajor: number;
  /** VIS PR4: per-meter EMAIL override (parent uids). undefined/[] = inherit
   *  the Global → Category cascade. */
  recipientUids?: string[];
}
const EMPTY_PROTECT: ProtectState = {
  protect: false, threshold: 0, forecastDays: 3,
  chEmail: true, chInapp: true, chChat: true,
  autoRequest: false, source: 'last', amountMajor: 0,
};

function protectStateFor(m: UtilityMeter): ProtectState {
  return {
    protect: (m.minUnitsThreshold ?? 0) > 0,
    threshold: m.minUnitsThreshold ?? 0,
    forecastDays: m.lowForecastDays ?? 3,
    chEmail: m.alertChannels?.email !== false,
    chInapp: m.alertChannels?.inapp !== false,
    chChat: m.alertChannels?.chat !== false,
    autoRequest: m.autoTopUp ?? false,
    source: m.autoTopUpSource ?? 'last',
    amountMajor: m.autoTopUpAmountCents ? m.autoTopUpAmountCents / 100 : 0,
    recipientUids: m.alertRecipientUids && m.alertRecipientUids.length > 0 ? m.alertRecipientUids : undefined,
  };
}

/** Map the form state → meter fields. Firestore is configured with
 *  ignoreUndefinedProperties — undefined means "leave as is", NOT "clear" —
 *  so disarming writes explicit zeros/falses, including the live low
 *  episode (the engine stops touching this meter once the threshold is 0,
 *  so a stale episode would otherwise pin the LOW chip forever). */
function protectionPatch(s: ProtectState): Partial<UtilityMeter> {
  if (!s.protect) {
    return {
      minUnitsThreshold: 0, autoTopUp: false, autoTopUpAlert: false,
      lowAlertAt: 0, lowAlertBalance: 0,
    };
  }
  return {
    minUnitsThreshold: s.threshold > 0 ? s.threshold : 0,
    lowForecastDays: s.forecastDays > 0 ? s.forecastDays : 3,
    alertChannels: { email: s.chEmail, inapp: s.chInapp, chat: s.chChat },
    autoTopUpAlert: s.chEmail || s.chInapp || s.chChat,
    autoTopUp: s.autoRequest,
    autoTopUpSource: s.autoRequest ? s.source : undefined,
    autoTopUpAmountCents: s.autoRequest && s.source === 'fixed' && s.amountMajor > 0
      ? Math.round(s.amountMajor * 100) : undefined,
    // [] is the explicit "inherit" write — ignoreUndefinedProperties means
    // undefined would leave a stale override in place.
    alertRecipientUids: s.recipientUids && s.recipientUids.length > 0 ? s.recipientUids : [],
  };
}

function ProtectionFields({ value, onChange, currency, pricePerUnitMajor, unit, parents, alertCfg }: {
  value: ProtectState; onChange: (patch: Partial<ProtectState>) => void; currency: string; pricePerUnitMajor: number; unit?: string;
  parents: UserProfile[]; alertCfg?: AlertEmailsConfig;
}) {
  const unitsHint = value.source === 'fixed' && value.amountMajor > 0 && pricePerUnitMajor > 0
    ? `≈ ${Math.round(value.amountMajor / pricePerUnitMajor).toLocaleString()} units`
    : '';
  const noChannel = !value.chEmail && !value.chInapp && !value.chChat;
  // VIS PR4 — where do this meter's alert EMAILS resolve without an override?
  const allParentUids = parents.map((p) => p.uid);
  const inherited = resolveAlertRecipients(alertCfg, 'utilities', allParentUids, undefined);
  const customRecipients = (value.recipientUids ?? []).filter((u) => allParentUids.includes(u));
  const isCustom = customRecipients.length > 0;
  const nameOf = (uid: string) => parents.find((p) => p.uid === uid)?.displayName || 'Parent';
  const channelPill = (on: boolean, label: string, toggle: () => void) => (
    <button type="button" onClick={toggle}
      className={`text-[11px] font-nunito font-extrabold px-2.5 py-1.5 rounded-full border ${on ? 'bg-hive-honey text-white border-hive-honey-dk' : 'bg-white border-hive-line text-hive-muted'}`}>
      {label}
    </button>
  );
  return (
    <div className="rounded-lg border border-dashed border-hive-honey-soft bg-[#FEF6E8] p-3 mb-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-nunito font-black text-hive-honey-dk">🔔 Low-balance protection</span>
        <button type="button" aria-label="Toggle low-balance protection" onClick={() => onChange({ protect: !value.protect })}
          className={`w-11 h-6 rounded-full relative transition-colors ${value.protect ? 'bg-hive-honey' : 'bg-hive-line'}`}>
          <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${value.protect ? 'right-0.5' : 'left-0.5'}`} />
        </button>
      </div>
      <p className="text-[10px] text-hive-muted mt-1 leading-snug">Kaya watches the readings and warns the family before this runs out.</p>
      {value.protect && (
        <div className="mt-2.5 flex flex-col gap-2.5">
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Warn below</span>
            <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 mt-1 bg-white focus-within:border-hive-honey">
              <input type="number" min={0} step="1" value={value.threshold || ''} onChange={(e) => onChange({ threshold: Number(e.target.value) })} placeholder="50" className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
              <span className="text-[10px] text-hive-muted font-bold">{unit?.trim() || 'units'} left</span>
            </div>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Also warn this many days before empty</span>
            <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 mt-1 bg-white focus-within:border-hive-honey">
              <input type="number" min={1} step="1" value={value.forecastDays || ''} onChange={(e) => onChange({ forecastDays: Number(e.target.value) })} placeholder="3" className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
              <span className="text-[10px] text-hive-muted font-bold">days · from daily use</span>
            </div>
          </label>
          <div>
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Alert by</span>
            <div className="flex flex-wrap gap-1.5 mt-1 items-center">
              {channelPill(value.chEmail, '📧 Email', () => onChange({ chEmail: !value.chEmail }))}
              {channelPill(value.chInapp, '🔔 In-app', () => onChange({ chInapp: !value.chInapp }))}
              {channelPill(value.chChat, '💬 Family chat', () => onChange({ chChat: !value.chChat }))}
              <span title="Coming with Kaya's WhatsApp integration" className="text-[11px] font-nunito font-extrabold px-2.5 py-1.5 rounded-full border border-dashed border-hive-line text-hive-muted opacity-60">📱 WhatsApp · soon</span>
            </div>
            {noChannel && (
              <p className="text-[10px] text-hive-rose font-bold mt-1">Pick at least one channel — or nobody hears the alarm.</p>
            )}
          </div>
          {/* VIS PR4 — "Email goes to": the item level of the cascade. The
              breadcrumb always names the winning level (F10); customizing
              detaches this meter only (D10). */}
          {value.chEmail && parents.length > 0 && (
            <div>
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Email goes to</span>
              {isCustom ? (
                <div className="rounded-lg border border-dashed border-hive-honey-soft bg-white p-2.5 mt-1">
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FFF3D9] text-hive-honey-dk border border-hive-honey/40">custom · this meter only</span>
                    <button
                      type="button"
                      onClick={() => onChange({ recipientUids: undefined })}
                      className="text-[10px] font-nunito font-extrabold text-hive-honey-dk"
                    >
                      ↺ Reset to inherit
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {parents.map((p) => {
                      const on = customRecipients.includes(p.uid);
                      return (
                        <button
                          key={p.uid}
                          type="button"
                          title={p.email || undefined}
                          onClick={() => {
                            const next = on ? customRecipients.filter((u) => u !== p.uid) : [...customRecipients, p.uid];
                            if (next.length === 0) return; // F1: the alarm keeps at least one ear
                            onChange({ recipientUids: next });
                          }}
                          className={`text-[11px] font-nunito font-extrabold px-2.5 py-1.5 rounded-full border ${on ? 'bg-hive-honey text-white border-hive-honey-dk' : 'bg-white border-hive-line text-hive-muted'}`}
                        >
                          {p.displayName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="rounded-lg bg-[#EEF2FA] border border-[#CCD6EA] p-2.5 mt-1">
                  <p className="text-[11px] font-nunito font-extrabold text-[#5B6B8C]">
                    Following {inherited.level === 'category' ? '⚡ Utilities' : '🌍 Global'} → {inherited.uids.map(nameOf).join(' + ')}
                  </p>
                  <p className="text-[10px] text-hive-muted font-bold mt-0.5">Global → Utilities → this meter</p>
                  <button
                    type="button"
                    onClick={() => onChange({ recipientUids: inherited.uids })}
                    className="text-[11px] font-nunito font-extrabold text-hive-honey-dk mt-1.5"
                  >
                    Customize for this meter only
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="border-t border-dashed border-hive-honey-soft pt-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-nunito font-black text-hive-honey-dk">🤖 Auto-request top-up</span>
              <button type="button" aria-label="Toggle auto-request" onClick={() => onChange({ autoRequest: !value.autoRequest })}
                className={`w-11 h-6 rounded-full relative transition-colors ${value.autoRequest ? 'bg-hive-honey' : 'bg-hive-line'}`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all ${value.autoRequest ? 'right-0.5' : 'left-0.5'}`} />
              </button>
            </div>
            <p className="text-[10px] text-hive-muted mt-1 leading-snug">When it goes low, Kaya creates the top-up request for you — you still approve it.</p>
          </div>
          {value.autoRequest && (
            <div>
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">When low, top up by</span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                <button type="button" onClick={() => onChange({ source: 'last' })}
                  className={`text-[11px] font-nunito font-extrabold px-2 py-2 rounded-lg border ${value.source === 'last' ? 'bg-hive-honey text-white border-hive-honey-dk' : 'bg-white border-hive-line text-hive-muted'}`}>Same as last top-up</button>
                <button type="button" onClick={() => onChange({ source: 'fixed' })}
                  className={`text-[11px] font-nunito font-extrabold px-2 py-2 rounded-lg border ${value.source === 'fixed' ? 'bg-hive-honey text-white border-hive-honey-dk' : 'bg-white border-hive-line text-hive-muted'}`}>A set amount</button>
              </div>
            </div>
          )}
          {value.autoRequest && value.source === 'fixed' && (
            <label className="block">
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Set amount {unitsHint && <span className="text-hive-honey-dk normal-case">· {unitsHint}</span>}</span>
              <div className="flex items-center gap-1 border border-hive-line rounded-lg px-3 py-2 mt-1 bg-white focus-within:border-hive-honey">
                <span className="text-xs text-hive-muted font-bold">{currency}</span>
                <input type="number" min={0} step="0.01" value={value.amountMajor || ''} onChange={(e) => onChange({ amountMajor: Number(e.target.value) })} placeholder="0.00" className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
              </div>
            </label>
          )}
        </div>
      )}
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

/** 1 → "1st", 15 → "15th" — for the reminder-days display. */
function ordinalDay(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
