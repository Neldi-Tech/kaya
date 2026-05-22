'use client';

// /pulse/admin — Kaya Pulse · Task setup (parent-only).
//
// One place per tracking item: enable + reading settings + assign who reads it
// (a kid OR a helper, fixed or rotating) — all inline. Two kinds of trackable:
//   • Utility meters (from /pantry/utility-meters) — toggle into Pulse.
//   • Custom trackables — add your own (water bill, fuel, vehicle service…),
//     including an odometer with a service interval. Then "Start".

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatCents } from '@/components/pantry/format';
import { listHelpers } from '@/lib/helpers';
import type { HelperLink } from '@/lib/firestore';
import type { PurchaseModule } from '@/lib/purchase';
import {
  type UtilityMeter,
  subscribeToMeters, updateMeter, meterEmoji,
} from '@/lib/utilityMeters';
import {
  type TrackableDoc, type NonMeterTrackableType,
  type MeterDirection as MeterDir, type TrackableSource,
  type PulseTemplate, type PulseCadence, type OwnerType, type OwnerKind, type RotationPeriod,
  NON_METER_TYPES, nonMeterEmoji,
  subscribeToTrackableDocs, addTrackable, updateTrackable, removeTrackable,
  subscribeToTemplates, addTemplate, updateTemplate, removeTemplate, generateTasksNow,
} from '@/lib/pulse';
import { PulseMark } from '@/components/pulse/ui';

type Owner = { kind: OwnerKind; id: string; name: string; emoji: string };

const CADENCE_OPTS: { id: PulseCadence; label: string }[] = [
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'everyNWeeks', label: 'Every N weeks' },
];
const ROTATION_OPTS: { id: RotationPeriod; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'biweekly', label: 'Fortnightly' },
  { id: 'monthly', label: 'Monthly' },
];
const MODULE_OPTS: { id: PurchaseModule; label: string }[] = [
  { id: 'drivers', label: 'Transport' },
  { id: 'utility', label: 'Utilities' },
  { id: 'outdoor', label: 'Outdoor' },
  { id: 'pantry', label: 'Pantry' },
];
const HELPER_EMOJI: Record<string, string> = {
  nanny: '🧑‍🍼', tutor: '📚', driver: '🚗', grandparent: '👵', gardener: '🌿', custom: '🧑‍🔧',
};
const defaultDirection = (t: NonMeterTrackableType): MeterDir => (t === 'odometer' || t === 'generator' ? 'up' : 'down');
const defaultModule = (t: NonMeterTrackableType): PurchaseModule => (t === 'odometer' || t === 'fuel' ? 'drivers' : 'utility');

export default function PulseAdminPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { config } = useHive();
  const { children: kids } = useFamily();
  const currency = config.currency;

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pulse');
  }, [profile, router]);

  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [trackableDocs, setTrackableDocs] = useState<TrackableDoc[]>([]);
  const [templates, setTemplates] = useState<PulseTemplate[]>([]);
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsubM = subscribeToMeters(profile.familyId, (m) => { setMeters(m); setLoading(false); });
    const unsubTd = subscribeToTrackableDocs(profile.familyId, setTrackableDocs);
    const unsubP = subscribeToTemplates(profile.familyId, setTemplates);
    listHelpers(profile.familyId).then((h) => setHelpers(h.filter((x) => x.status === 'active'))).catch(() => setHelpers([]));
    return () => { clearTimeout(t); unsubM(); unsubTd(); unsubP(); };
  }, [profile?.familyId, profile?.role]);

  const owners = useMemo<Owner[]>(() => [
    ...kids.map((k) => ({ kind: 'kid' as const, id: k.id, name: k.name, emoji: k.avatarEmoji ?? '🧒' })),
    ...helpers.map((h) => ({ kind: 'helper' as const, id: h.uid, name: h.displayName, emoji: HELPER_EMOJI[h.preset] ?? '🧑‍🔧' })),
  ], [kids, helpers]);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg text-pulse-navy">Task setup is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">Kids and helpers log readings from Today.</p>
        <Link href="/pulse" className="text-pulse-gold-dk font-nunito font-bold text-sm underline">← Back to Pulse</Link>
      </div>
    );
  }

  const fid = profile?.familyId ?? '';
  const templateFor = (trackableId: string) => templates.find((t) => t.trackableId === trackableId);

  const runGenerate = async () => {
    if (!fid) return;
    setGenBusy(true);
    setGenMsg('');
    try {
      const r = await generateTasksNow(fid);
      setGenMsg(r.created > 0 ? `✓ Created ${r.created} task${r.created === 1 ? '' : 's'} for today.` : 'No tasks due today (or already generated).');
    } catch {
      setGenMsg('Could not generate — try again.');
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="flex items-center gap-1.5">
        <PulseMark className="w-5 h-5" />
        <span className="text-[10px] font-nunito font-black uppercase tracking-[2px] text-pulse-gold-dk">Kaya Pulse</span>
      </div>
      <h1 className="font-nunito font-black text-2xl lg:text-[32px] tracking-tight text-pulse-navy mt-1">Task setup</h1>
      <p className="text-hive-muted text-sm mt-1">For each item: track it, set how it reads, and assign who logs it — a kid or a helper. Then start.</p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-nunito font-black text-pulse-gold-dk mt-2">
        <span className="bg-pulse-gold/15 px-2 py-0.5 rounded-full">1 · Track</span>
        <span className="text-hive-muted">→</span>
        <span className="bg-pulse-gold/15 px-2 py-0.5 rounded-full">2 · Assign a reader</span>
        <span className="text-hive-muted">→</span>
        <span className="bg-pulse-gold/15 px-2 py-0.5 rounded-full">3 · Start</span>
      </div>

      {loading ? (
        <p className="text-hive-muted text-sm mt-6">Loading…</p>
      ) : (
        <>
          {/* ── Utility meters ── */}
          <h2 className="font-nunito font-black text-pulse-navy text-base mt-7 mb-1">Meters</h2>
          <p className="text-[12px] text-hive-muted mb-3">
            <strong>Prepaid</strong> (LUKU, gas) counts down — a jump up is a top-up. <strong>Postpaid</strong> (city water) only climbs.
          </p>
          {meters.filter((m) => m.active).length === 0 ? (
            <div className="bg-white border border-pulse-gold/40 rounded-2xl p-4 text-center">
              <p className="text-hive-muted text-sm mb-2">No meters yet.</p>
              <Link href="/pantry/utility-meters" className="inline-block bg-pulse-navy text-pulse-gold rounded-xl px-4 py-2 font-nunito font-black text-sm">＋ Add meters</Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {meters.filter((m) => m.active).map((m) => (
                <MeterRow key={m.id} meter={m} familyId={fid} currency={currency} owners={owners} template={templateFor(m.id)} />
              ))}
              <Link href="/pantry/utility-meters" className="text-[12px] text-pulse-gold-dk font-bold text-center mt-1 hover:underline">Manage meters (price, unit) →</Link>
            </div>
          )}

          {/* ── Custom trackables ── */}
          <h2 className="font-nunito font-black text-pulse-navy text-base mt-7 mb-1">Custom trackables</h2>
          <p className="text-[12px] text-hive-muted mb-3">Add your own — a water bill, fuel, a vehicle's service distance, anything you want logged.</p>
          <div className="flex flex-col gap-2">
            {trackableDocs.filter((t) => t.active).map((t) => (
              <CustomTrackableRow key={t.id} trackable={t} familyId={fid} currency={currency} owners={owners} template={templateFor(t.id)} />
            ))}
            <AddCustomTrackable familyId={fid} currency={currency} />
          </div>

          {/* ── Start ── */}
          {templates.length > 0 && (
            <>
              <button onClick={runGenerate} disabled={genBusy} className="w-full mt-6 bg-pulse-navy text-pulse-gold rounded-2xl py-3 font-nunito font-black text-sm disabled:opacity-50">
                {genBusy ? 'Starting…' : "▶ Start today's tracking"}
              </button>
              {genMsg && <p className="text-[12px] text-center text-hive-muted font-bold mt-2">{genMsg}</p>}
              <p className="text-[11px] text-hive-muted text-center mt-1 leading-snug">Creates today's reading tasks for the assigned readers — they appear on each person's Today. Tasks also generate automatically every morning.</p>
            </>
          )}
        </>
      )}
    </div>
  );
}

/* ── Utility-meter row: track toggle + reading settings + reader ── */
function MeterRow({ meter, familyId, currency, owners, template }: {
  meter: UtilityMeter; familyId: string; currency: string; owners: Owner[]; template?: PulseTemplate;
}) {
  const { profile } = useAuth();
  const enabled = !!meter.pulseEnabled;
  const [dir, setDir] = useState<MeterDir>(meter.direction ?? (meter.type === 'water' ? 'up' : 'down'));
  const [thresholdMajor, setThresholdMajor] = useState<string>(meter.minUnitsThreshold != null ? String(meter.minUnitsThreshold) : '');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const hasPrice = !!meter.pricePerUnitCents && meter.pricePerUnitCents > 0;

  const toggle = async () => {
    setBusy(true);
    try {
      await updateMeter(familyId, meter.id, { pulseEnabled: !enabled, direction: !enabled ? dir : meter.direction });
      setOpen(!enabled);
    } finally { setBusy(false); }
  };
  const saveConfig = async (nextDir: MeterDir, nextThreshold: string) => {
    setBusy(true);
    try {
      const n = Number(nextThreshold);
      await updateMeter(familyId, meter.id, { direction: nextDir, minUnitsThreshold: nextDir === 'down' && nextThreshold !== '' && n > 0 ? n : undefined });
    } finally { setBusy(false); }
  };

  return (
    <TrackableShell
      emoji={meterEmoji(meter.type)} name={meter.label} enabled={enabled}
      sub={hasPrice ? `${formatCents(meter.pricePerUnitCents!, currency)}/${meter.unit || 'unit'}` : 'No unit price set'}
      template={template} owners={owners}
      toggle={<ToggleSwitch on={enabled} busy={busy} onClick={toggle} />}
      open={open} setOpen={setOpen}
    >
      {!hasPrice && (
        <p className="text-[11px] text-pulse-coral font-bold mb-2">⚠ Set a price/unit in <Link href="/pantry/utility-meters" className="underline">Manage meters</Link> so cost can be computed.</p>
      )}
      <DirectionPicker dir={dir} onPick={(d) => { setDir(d); saveConfig(d, thresholdMajor); }} />
      {dir === 'down' && (
        <ThresholdInput unit={meter.unit} value={thresholdMajor} onChange={setThresholdMajor} onBlur={() => saveConfig(dir, thresholdMajor)} />
      )}
      <div className="mt-3 pt-3 border-t border-pulse-gold/20">
        <ReaderAssign familyId={familyId} trackableId={meter.id} source="meter" owners={owners} template={template} createdBy={profile?.uid ?? ''} />
      </div>
    </TrackableShell>
  );
}

/* ── Custom-trackable row: editable settings + reader + remove ── */
function CustomTrackableRow({ trackable, familyId, currency, owners, template }: {
  trackable: TrackableDoc; familyId: string; currency: string; owners: Owner[]; template?: PulseTemplate;
}) {
  const { profile } = useAuth();
  const confirmAction = useConfirm();
  const [open, setOpen] = useState(false);
  const [dir, setDir] = useState<MeterDir>(trackable.direction);
  const [priceMajor, setPriceMajor] = useState<string>(trackable.pricePerUnitCents ? String(trackable.pricePerUnitCents / 100) : '');
  const [serviceN, setServiceN] = useState<string>(trackable.serviceIntervalUnits != null ? String(trackable.serviceIntervalUnits) : '');
  const [thresholdMajor, setThresholdMajor] = useState<string>(trackable.minUnitsThreshold != null ? String(trackable.minUnitsThreshold) : '');
  const hasPrice = trackable.pricePerUnitCents > 0;
  const isOdometer = trackable.type === 'odometer';

  const patch = async (data: Partial<Omit<TrackableDoc, 'id' | 'createdAt'>>) => {
    await updateTrackable(familyId, trackable.id, data);
  };
  const remove = async () => {
    const ok = await confirmAction({ title: `Remove "${trackable.name}"?`, message: 'Past readings stay; no new tasks generate.', confirmLabel: 'Remove', tone: 'danger' });
    if (ok) await removeTrackable(familyId, trackable.id);
  };

  const sub = [
    hasPrice ? `${formatCents(trackable.pricePerUnitCents, currency)}/${trackable.unit}` : `per ${trackable.unit}`,
    trackable.serviceIntervalUnits ? `🔧 every ${trackable.serviceIntervalUnits} ${trackable.unit}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <TrackableShell emoji={nonMeterEmoji(trackable.type)} name={trackable.name} enabled sub={sub} template={template} owners={owners} open={open} setOpen={setOpen}>
      <DirectionPicker dir={dir} onPick={(d) => { setDir(d); patch({ direction: d }); }} />
      <label className="block mt-2">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Price per {trackable.unit}</span>
        <div className="flex items-center gap-1 border border-pulse-gold/40 rounded-lg px-3 py-2 mt-1">
          <span className="text-xs text-hive-muted font-bold">{currency}</span>
          <input type="number" min={0} step="0.01" value={priceMajor} onChange={(e) => setPriceMajor(e.target.value)}
            onBlur={() => patch({ pricePerUnitCents: priceMajor !== '' && Number(priceMajor) > 0 ? Math.round(Number(priceMajor) * 100) : 0 })}
            placeholder="0.00" className="flex-1 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
        </div>
      </label>
      {isOdometer ? (
        <label className="block mt-2">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Service every (distance)</span>
          <div className="flex items-center gap-2 mt-1">
            <input type="number" min={0} step="1" value={serviceN} onChange={(e) => setServiceN(e.target.value)}
              onBlur={() => patch({ serviceIntervalUnits: serviceN !== '' && Number(serviceN) > 0 ? Number(serviceN) : undefined })}
              placeholder="e.g. 5000" className="flex-1 border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold focus:outline-none focus:border-pulse-gold" />
            <span className="text-[11px] text-hive-muted font-bold">{trackable.unit} between services</span>
          </div>
          <p className="text-[10px] text-hive-muted mt-1 leading-snug">Log the odometer; "distance to next service" shows on the trackable's detail (with a reminder when it's near).</p>
        </label>
      ) : dir === 'down' ? (
        <ThresholdInput unit={trackable.unit} value={thresholdMajor} onChange={setThresholdMajor} onBlur={() => patch({ minUnitsThreshold: thresholdMajor !== '' && Number(thresholdMajor) > 0 ? Number(thresholdMajor) : undefined })} />
      ) : null}
      <div className="mt-3 pt-3 border-t border-pulse-gold/20">
        <ReaderAssign familyId={familyId} trackableId={trackable.id} source="trackable" owners={owners} template={template} createdBy={profile?.uid ?? ''} />
        <button type="button" onClick={remove} className="mt-2 text-[11px] font-nunito font-bold text-pulse-coral">Remove trackable</button>
      </div>
    </TrackableShell>
  );
}

/* ── Add a custom trackable ── */
function AddCustomTrackable({ familyId, currency }: { familyId: string; currency: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<NonMeterTrackableType>('custom');
  const [unit, setUnit] = useState('');
  const [priceMajor, setPriceMajor] = useState('');
  const [dir, setDir] = useState<MeterDir>('down');
  const [module, setModule] = useState<PurchaseModule>('utility');
  const [serviceN, setServiceN] = useState('');
  const [saving, setSaving] = useState(false);

  const pickType = (t: NonMeterTrackableType) => { setType(t); setDir(defaultDirection(t)); setModule(defaultModule(t)); };
  const submit = async () => {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      await addTrackable(familyId, {
        name: name.trim(), type, unit: unit.trim() || 'unit',
        pricePerUnitCents: priceMajor !== '' && Number(priceMajor) > 0 ? Math.round(Number(priceMajor) * 100) : 0,
        direction: dir, module,
        serviceIntervalUnits: type === 'odometer' && serviceN !== '' && Number(serviceN) > 0 ? Number(serviceN) : undefined,
      });
      setOpen(false);
      setName(''); setType('custom'); setUnit(''); setPriceMajor(''); setDir('down'); setModule('utility'); setServiceN('');
    } finally { setSaving(false); }
  };

  if (!open) {
    return <button onClick={() => setOpen(true)} className="w-full border-2 border-dashed border-pulse-gold/50 text-pulse-gold-dk rounded-2xl py-3 font-nunito font-black text-sm">＋ Add a custom trackable</button>;
  }

  return (
    <div className="bg-white border border-pulse-gold rounded-2xl p-4">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-3">New custom trackable</p>
      <label className="block mb-2">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Name</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Water bill, Land Cruiser service"
          className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
      </label>
      <div className="mb-2">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Type</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {NON_METER_TYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => pickType(t.id)} className={chip(type === t.id)}>{t.emoji} {t.label}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mb-2">
        <label className="block">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Unit</span>
          <input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder={type === 'odometer' ? 'km' : 'litre / bill'}
            className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Price / unit</span>
          <div className="flex items-center gap-1 border border-pulse-gold/40 rounded-lg px-3 py-2 mt-1">
            <span className="text-xs text-hive-muted font-bold">{currency}</span>
            <input type="number" min={0} step="0.01" value={priceMajor} onChange={(e) => setPriceMajor(e.target.value)} placeholder="0.00"
              className="flex-1 min-w-0 text-sm font-nunito font-bold focus:outline-none bg-transparent" />
          </div>
        </label>
      </div>
      <DirectionPicker dir={dir} onPick={setDir} />
      {type === 'odometer' && (
        <label className="block mt-2">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Service every (distance)</span>
          <input type="number" min={0} step="1" value={serviceN} onChange={(e) => setServiceN(e.target.value)} placeholder="e.g. 5000"
            className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
        </label>
      )}
      <div className="mt-2">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Budget bucket</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {MODULE_OPTS.map((m) => (
            <button key={m.id} type="button" onClick={() => setModule(m.id)} className={chip(module === m.id)}>{m.label}</button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button onClick={() => setOpen(false)} className="border border-pulse-gold/40 rounded-xl py-2 font-nunito font-bold text-sm text-pulse-navy">Cancel</button>
        <button onClick={submit} disabled={!name.trim() || saving} className="bg-pulse-navy text-pulse-gold rounded-xl py-2 font-nunito font-black text-sm disabled:opacity-50">{saving ? 'Adding…' : 'Add trackable'}</button>
      </div>
    </div>
  );
}

/* ── Shared row shell + small controls ── */
function TrackableShell({ emoji, name, enabled, sub, template, owners, toggle, open, setOpen, children }: {
  emoji: string; name: string; enabled: boolean; sub: string; template?: PulseTemplate; owners: Owner[];
  toggle?: React.ReactNode; open: boolean; setOpen: (v: boolean) => void; children: React.ReactNode;
}) {
  const ownerName = (id?: string) => owners.find((o) => o.id === id)?.name ?? 'someone';
  const readerLabel = !template ? undefined : template.ownerType === 'fixed' ? ownerName(template.ownerId) : `Rotating: ${(template.rotationPool ?? []).map(ownerName).join(' / ')}`;
  return (
    <div className={`rounded-2xl p-3 border ${enabled ? 'bg-pulse-bone border-pulse-gold' : 'bg-white border-pulse-gold/30'}`}>
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base">{emoji}</div>
          {enabled && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white border border-pulse-gold flex items-center justify-center shadow-sm"><PulseMark className="w-2.5 h-2.5" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-nunito font-extrabold text-sm text-pulse-navy truncate">{name}</span>
            {enabled && <span className="flex-shrink-0 inline-flex items-center text-[9px] font-nunito font-black uppercase tracking-wide text-pulse-gold-dk bg-pulse-gold/15 px-1.5 py-0.5 rounded-full">✓ Tracked</span>}
          </div>
          <div className="text-[11px] text-hive-muted font-bold truncate">{sub}</div>
          {enabled && (readerLabel
            ? <div className="text-[10px] font-bold text-pulse-gold-dk mt-0.5">👤 {readerLabel} · {template?.cadence}</div>
            : <div className="text-[10px] font-bold text-pulse-coral mt-0.5">No reader yet — assign one ↓</div>)}
        </div>
        {toggle}
      </div>
      {enabled && (
        <>
          <button type="button" onClick={() => setOpen(!open)} className="mt-2 text-[11px] font-nunito font-black text-pulse-gold-dk">⚙ Settings &amp; reader {open ? '⌃' : '⌄'}</button>
          {open && (
            <div className="mt-2 pt-3 border-t border-pulse-gold/30">
              {children}
              <button type="button" onClick={() => setOpen(false)} className="mt-3 w-full border border-pulse-gold/40 rounded-xl py-2 text-[12px] font-nunito font-black text-pulse-navy">Done</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ToggleSwitch({ on, busy, onClick }: { on: boolean; busy: boolean; onClick: () => void }) {
  return (
    <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
      <button type="button" role="switch" aria-checked={on} onClick={onClick} disabled={busy}
        className={`relative w-12 h-7 rounded-full transition-colors ${on ? 'bg-pulse-navy' : 'bg-gray-300'} disabled:opacity-60`}>
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'right-1' : 'left-1'}`} />
      </button>
      <span className="text-[8px] font-nunito font-black uppercase tracking-wide text-hive-muted">{on ? 'Tracked' : 'Track'}</span>
    </div>
  );
}

function DirectionPicker({ dir, onPick }: { dir: MeterDir; onPick: (d: MeterDir) => void }) {
  return (
    <>
      <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Reading direction</span>
      <div className="flex gap-2 mt-1">
        {([['down', 'Prepaid · counts down'], ['up', 'Postpaid · counts up']] as [MeterDir, string][]).map(([d, lbl]) => (
          <button key={d} type="button" onClick={() => onPick(d)}
            className={`flex-1 text-[11px] font-nunito font-extrabold px-2 py-2 rounded-xl border ${dir === d ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-white text-pulse-navy border-pulse-gold/40'}`}>{lbl}</button>
        ))}
      </div>
    </>
  );
}

function ThresholdInput({ unit, value, onChange, onBlur }: { unit?: string; value: string; onChange: (v: string) => void; onBlur: () => void }) {
  return (
    <label className="block mt-2">
      <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Auto top-up below (units)</span>
      <div className="flex items-center gap-2 mt-1">
        <input type="number" min={0} step="1" value={value} onChange={(e) => onChange(e.target.value)} onBlur={onBlur}
          placeholder="e.g. 20" className="flex-1 border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold focus:outline-none focus:border-pulse-gold" />
        <span className="text-[11px] text-hive-muted font-bold">{unit || 'units'} left</span>
      </div>
    </label>
  );
}

/* ── Inline reader assignment (kid or helper; fixed or rotating) ── */
function ReaderAssign({ familyId, trackableId, source, owners, template, createdBy }: {
  familyId: string; trackableId: string; source: TrackableSource; owners: Owner[]; template?: PulseTemplate; createdBy: string;
}) {
  const [ownerType, setOwnerType] = useState<OwnerType>(template?.ownerType ?? 'fixed');
  const [fixedOwnerId, setFixedOwnerId] = useState<string>(template?.ownerType === 'fixed' ? template.ownerId ?? '' : '');
  const [rotateKind, setRotateKind] = useState<OwnerKind>((template?.ownerKind as OwnerKind) ?? 'kid');
  const [pool, setPool] = useState<string[]>(template?.rotationPool ?? []);
  const [cadence, setCadence] = useState<PulseCadence>(template?.cadence ?? 'daily');
  const [cadenceN, setCadenceN] = useState(template?.cadenceN ?? 2);
  const [rotationPeriod, setRotationPeriod] = useState<RotationPeriod>(template?.rotationPeriod ?? 'weekly');
  const [points, setPoints] = useState(template?.pointsValue ?? 10);
  const [dueTime, setDueTime] = useState(template?.dueTimeLocal ?? '20:00');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const kindOf = (id: string) => owners.find((o) => o.id === id)?.kind ?? 'kid';
  const togglePool = (id: string) => { setSaved(false); setPool((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const rotatable = owners.filter((o) => o.kind === rotateKind);
  const canSave = ownerType === 'fixed' ? !!fixedOwnerId : pool.length >= 2;

  const save = async () => {
    if (!canSave || !createdBy || saving) return;
    setSaving(true); setSaved(false);
    try {
      const data = {
        trackableId, trackableSource: source, cadence,
        cadenceN: cadence === 'everyNWeeks' ? cadenceN : undefined,
        ownerType,
        ownerId: ownerType === 'fixed' ? fixedOwnerId : undefined,
        ownerKind: (ownerType === 'fixed' ? kindOf(fixedOwnerId) : rotateKind) as OwnerKind,
        rotationPool: ownerType === 'rotating' ? pool : undefined,
        rotationPeriod: ownerType === 'rotating' ? rotationPeriod : undefined,
        rotationCurrent: ownerType === 'rotating' ? pool[0] : undefined,
        pointsValue: points, dueTimeLocal: dueTime, createdBy,
      };
      if (template) await updateTemplate(familyId, template.id, data);
      else await addTemplate(familyId, data);
      setSaved(true);
    } finally { setSaving(false); }
  };

  if (owners.length === 0) return <p className="text-[11px] text-pulse-coral font-bold">Add kids or helpers first, then assign a reader.</p>;

  return (
    <div>
      <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Reader</span>
      <div className="flex gap-1.5 mt-1 mb-2">
        <button type="button" onClick={() => { setOwnerType('fixed'); setSaved(false); }} className={chip(ownerType === 'fixed')}>One person</button>
        <button type="button" onClick={() => { setOwnerType('rotating'); setSaved(false); }} className={chip(ownerType === 'rotating')}>Rotating</button>
      </div>
      {ownerType === 'fixed' ? (
        <div className="flex flex-wrap gap-1.5">
          {owners.map((o) => (
            <button key={`${o.kind}:${o.id}`} type="button" onClick={() => { setFixedOwnerId(o.id); setSaved(false); }} className={chip(fixedOwnerId === o.id)}>
              {o.emoji} {o.name}{o.kind === 'helper' ? ' · helper' : ''}
            </button>
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 mb-2">
            <button type="button" onClick={() => { setRotateKind('kid'); setPool([]); setSaved(false); }} className={chip(rotateKind === 'kid')}>Among kids</button>
            <button type="button" onClick={() => { setRotateKind('helper'); setPool([]); setSaved(false); }} className={chip(rotateKind === 'helper')}>Among helpers</button>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {rotatable.map((o) => <button key={o.id} type="button" onClick={() => togglePool(o.id)} className={chip(pool.includes(o.id))}>{o.emoji} {o.name}</button>)}
          </div>
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Rotates</span>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {ROTATION_OPTS.map((r) => <button key={r.id} type="button" onClick={() => { setRotationPeriod(r.id); setSaved(false); }} className={chip(rotationPeriod === r.id)}>{r.label}</button>)}
          </div>
          {pool.length < 2 && <p className="text-[10px] text-pulse-coral font-bold mt-1">Pick at least 2 to rotate between.</p>}
        </>
      )}
      <div className="mt-3">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">How often</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {CADENCE_OPTS.map((c) => <button key={c.id} type="button" onClick={() => { setCadence(c.id); setSaved(false); }} className={chip(cadence === c.id)}>{c.label}</button>)}
          {cadence === 'everyNWeeks' && (
            <input type="number" min={2} value={cadenceN} onChange={(e) => { setCadenceN(Math.max(2, Number(e.target.value))); setSaved(false); }} className="w-16 border border-pulse-gold/40 rounded-lg px-2 py-1 text-sm font-nunito font-bold" />
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Points (kids)</span>
          <input type="number" min={0} value={points} onChange={(e) => { setPoints(Math.max(0, Number(e.target.value))); setSaved(false); }} className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Due time</span>
          <input type="time" value={dueTime} onChange={(e) => { setDueTime(e.target.value); setSaved(false); }} className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
        </label>
      </div>
      <button type="button" onClick={save} disabled={!canSave || saving} className="w-full mt-3 bg-pulse-gold text-pulse-navy rounded-xl py-2 font-nunito font-black text-[12px] disabled:opacity-50">
        {saving ? 'Saving…' : saved ? '✓ Reader saved' : template ? 'Update reader' : 'Save reader'}
      </button>
    </div>
  );
}

function chip(active: boolean): string {
  return `text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${active ? 'bg-pulse-gold text-pulse-navy border-pulse-gold' : 'bg-white text-hive-muted border-pulse-gold/40'}`;
}
