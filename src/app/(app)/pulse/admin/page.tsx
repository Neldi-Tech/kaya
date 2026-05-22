'use client';

// /pulse/admin — Kaya Pulse · Task setup (parent-only).
//
// One place per tracking item: enable a meter for Pulse, set how it reads
// (prepaid down / postpaid up + auto-top-up threshold), AND assign who reads it
// — a kid OR a helper, fixed or rotating — all inline on the same row. Then
// "Start today's tracking". One reading task (template) per trackable.

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
import {
  type UtilityMeter,
  subscribeToMeters, updateMeter, meterEmoji,
} from '@/lib/utilityMeters';
import {
  type MeterDirection as MeterDir, type TrackableSource,
  type PulseTemplate, type PulseCadence, type OwnerType, type OwnerKind, type RotationPeriod,
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
const HELPER_EMOJI: Record<string, string> = {
  nanny: '🧑‍🍼', tutor: '📚', driver: '🚗', grandparent: '👵', gardener: '🌿', custom: '🧑‍🔧',
};

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
  const [templates, setTemplates] = useState<PulseTemplate[]>([]);
  const [helpers, setHelpers] = useState<HelperLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsubM = subscribeToMeters(profile.familyId, (m) => { setMeters(m); setLoading(false); });
    const unsubP = subscribeToTemplates(profile.familyId, setTemplates);
    listHelpers(profile.familyId).then((h) => setHelpers(h.filter((x) => x.status === 'active'))).catch(() => setHelpers([]));
    return () => { clearTimeout(t); unsubM(); unsubP(); };
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
  const trackedCount = meters.filter((m) => m.active && m.pulseEnabled).length;

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
      <p className="text-hive-muted text-sm mt-1">
        For each meter: track it, set how it reads, and assign who logs it — a kid or a helper. Then start.
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-nunito font-black text-pulse-gold-dk mt-2">
        <span className="bg-pulse-gold/15 px-2 py-0.5 rounded-full">1 · Track</span>
        <span className="text-hive-muted">→</span>
        <span className="bg-pulse-gold/15 px-2 py-0.5 rounded-full">2 · Assign a reader</span>
        <span className="text-hive-muted">→</span>
        <span className="bg-pulse-gold/15 px-2 py-0.5 rounded-full">3 · Start</span>
      </div>

      <h2 className="font-nunito font-black text-pulse-navy text-base mt-7 mb-1">Trackables</h2>
      <p className="text-[12px] text-hive-muted mb-3">
        <strong>Prepaid</strong> (LUKU, gas) counts down to zero — a jump up is a top-up. <strong>Postpaid</strong> (city water, odometer) only climbs.
      </p>

      {loading ? (
        <p className="text-hive-muted text-sm">Loading…</p>
      ) : meters.length === 0 ? (
        <div className="bg-white border border-pulse-gold/40 rounded-2xl p-5 text-center">
          <div className="text-3xl mb-1">⚡</div>
          <h3 className="font-nunito font-black text-pulse-navy">No meters yet</h3>
          <p className="text-hive-muted text-sm mt-1 mb-3">Add your meters first, then track them here.</p>
          <Link href="/pantry/utility-meters" className="inline-block bg-pulse-navy text-pulse-gold rounded-xl px-4 py-2 font-nunito font-black text-sm">＋ Add meters</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {meters.filter((m) => m.active).map((m) => (
            <MeterRow key={m.id} meter={m} familyId={fid} currency={currency} owners={owners} template={templateFor(m.id)} />
          ))}
          <Link href="/pantry/utility-meters" className="text-[12px] text-pulse-gold-dk font-bold text-center mt-1 hover:underline">Manage meters (price, unit) →</Link>

          {trackedCount > 0 && (
            <>
              <button
                onClick={runGenerate}
                disabled={genBusy}
                className="w-full mt-4 bg-pulse-navy text-pulse-gold rounded-2xl py-3 font-nunito font-black text-sm disabled:opacity-50"
              >
                {genBusy ? 'Starting…' : "▶ Start today's tracking"}
              </button>
              {genMsg && <p className="text-[12px] text-center text-hive-muted font-bold mt-2">{genMsg}</p>}
              <p className="text-[11px] text-hive-muted text-center mt-1 leading-snug">
                Creates today's reading tasks for the assigned readers — they appear on each person's Today. Tasks also generate automatically every morning.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* ── A meter row: track toggle + reading settings + reader assignment ── */
function MeterRow({ meter, familyId, currency, owners, template }: {
  meter: UtilityMeter; familyId: string; currency: string; owners: Owner[]; template?: PulseTemplate;
}) {
  const { profile } = useAuth();
  const confirmAction = useConfirm();
  const enabled = !!meter.pulseEnabled;
  const [dir, setDir] = useState<MeterDir>(meter.direction ?? (meter.type === 'water' ? 'up' : 'down'));
  const [thresholdMajor, setThresholdMajor] = useState<string>(meter.minUnitsThreshold != null ? String(meter.minUnitsThreshold) : '');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const hasPrice = !!meter.pricePerUnitCents && meter.pricePerUnitCents > 0;
  const ownerName = (id?: string) => owners.find((o) => o.id === id)?.name ?? 'someone';
  const readerLabel = !template
    ? undefined
    : template.ownerType === 'fixed'
      ? ownerName(template.ownerId)
      : `Rotating: ${(template.rotationPool ?? []).map(ownerName).join(' / ')}`;

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
      await updateMeter(familyId, meter.id, {
        direction: nextDir,
        minUnitsThreshold: nextDir === 'down' && nextThreshold !== '' && n > 0 ? n : undefined,
      });
    } finally { setBusy(false); }
  };
  const clearReader = async () => {
    if (!template) return;
    const ok = await confirmAction({ title: 'Remove the reader?', message: 'No new tasks will generate for this trackable.', confirmLabel: 'Remove', tone: 'danger' });
    if (!ok) return;
    await removeTemplate(familyId, template.id);
  };

  return (
    <div className={`rounded-2xl p-3 border ${enabled ? 'bg-pulse-bone border-pulse-gold' : 'bg-white border-pulse-gold/30'}`}>
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9 flex-shrink-0">
          <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base">{meterEmoji(meter.type)}</div>
          {enabled && (
            <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-white border border-pulse-gold flex items-center justify-center shadow-sm">
              <PulseMark className="w-2.5 h-2.5" />
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="font-nunito font-extrabold text-sm text-pulse-navy truncate">{meter.label}</span>
            {enabled && (
              <span className="flex-shrink-0 inline-flex items-center text-[9px] font-nunito font-black uppercase tracking-wide text-pulse-gold-dk bg-pulse-gold/15 px-1.5 py-0.5 rounded-full">✓ Tracked</span>
            )}
          </div>
          <div className="text-[11px] text-hive-muted font-bold">
            {hasPrice ? `${formatCents(meter.pricePerUnitCents!, currency)}/${meter.unit || 'unit'}` : 'No unit price set'}
          </div>
          {enabled && (
            readerLabel
              ? <div className="text-[10px] font-bold text-pulse-gold-dk mt-0.5">👤 {readerLabel} · {template?.cadence}</div>
              : <div className="text-[10px] font-bold text-pulse-coral mt-0.5">No reader yet — assign one ↓</div>
          )}
        </div>
        <div className="flex flex-col items-center gap-0.5 flex-shrink-0">
          <button
            type="button" role="switch" aria-checked={enabled} onClick={toggle} disabled={busy}
            className={`relative w-12 h-7 rounded-full transition-colors ${enabled ? 'bg-pulse-navy' : 'bg-gray-300'} disabled:opacity-60`}
          >
            <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${enabled ? 'right-1' : 'left-1'}`} />
          </button>
          <span className="text-[8px] font-nunito font-black uppercase tracking-wide text-hive-muted">{enabled ? 'Tracked' : 'Track'}</span>
        </div>
      </div>

      {enabled && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 text-[11px] font-nunito font-black text-pulse-gold-dk">
            ⚙ Settings &amp; reader {open ? '⌃' : '⌄'}
          </button>

          {open && (
            <div className="mt-2 pt-3 border-t border-pulse-gold/30">
              {!hasPrice && (
                <p className="text-[11px] text-pulse-coral font-bold mb-2">
                  ⚠ Set a price/unit in <Link href="/pantry/utility-meters" className="underline">Manage meters</Link> so cost can be computed.
                </p>
              )}
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Reading direction</span>
              <div className="flex gap-2 mt-1 mb-2">
                {([['down', 'Prepaid · counts down'], ['up', 'Postpaid · counts up']] as [MeterDir, string][]).map(([d, lbl]) => (
                  <button key={d} type="button" onClick={() => { setDir(d); saveConfig(d, thresholdMajor); }}
                    className={`flex-1 text-[11px] font-nunito font-extrabold px-2 py-2 rounded-xl border ${dir === d ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-white text-pulse-navy border-pulse-gold/40'}`}
                  >{lbl}</button>
                ))}
              </div>
              {dir === 'down' && (
                <label className="block mb-3">
                  <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Auto top-up below (units)</span>
                  <div className="flex items-center gap-2 mt-1">
                    <input type="number" min={0} step="1" value={thresholdMajor} onChange={(e) => setThresholdMajor(e.target.value)} onBlur={() => saveConfig(dir, thresholdMajor)}
                      placeholder="e.g. 20" className="flex-1 border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold focus:outline-none focus:border-pulse-gold" />
                    <span className="text-[11px] text-hive-muted font-bold">{meter.unit || 'units'} left</span>
                  </div>
                </label>
              )}

              {/* ── Assign reader (inline) ── */}
              <div className="mt-1 pt-3 border-t border-pulse-gold/20">
                <ReaderAssign
                  familyId={familyId} trackableId={meter.id} owners={owners} template={template}
                  createdBy={profile?.uid ?? ''}
                />
                {template && (
                  <button type="button" onClick={clearReader} className="mt-2 text-[11px] font-nunito font-bold text-pulse-coral">Remove reader</button>
                )}
              </div>

              <button type="button" onClick={() => setOpen(false)} className="mt-3 w-full border border-pulse-gold/40 rounded-xl py-2 text-[12px] font-nunito font-black text-pulse-navy">Done</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ── Inline reader assignment (kid or helper; fixed or rotating) ── */
function ReaderAssign({ familyId, trackableId, owners, template, createdBy }: {
  familyId: string; trackableId: string; owners: Owner[]; template?: PulseTemplate; createdBy: string;
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
  const togglePool = (id: string) => setPool((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const rotatable = owners.filter((o) => o.kind === rotateKind);

  const canSave = ownerType === 'fixed' ? !!fixedOwnerId : pool.length >= 2;

  const save = async () => {
    if (!canSave || !createdBy || saving) return;
    setSaving(true);
    setSaved(false);
    try {
      const data = {
        trackableId,
        trackableSource: 'meter' as TrackableSource,
        cadence,
        cadenceN: cadence === 'everyNWeeks' ? cadenceN : undefined,
        ownerType,
        ownerId: ownerType === 'fixed' ? fixedOwnerId : undefined,
        ownerKind: (ownerType === 'fixed' ? kindOf(fixedOwnerId) : rotateKind) as OwnerKind,
        rotationPool: ownerType === 'rotating' ? pool : undefined,
        rotationPeriod: ownerType === 'rotating' ? rotationPeriod : undefined,
        rotationCurrent: ownerType === 'rotating' ? pool[0] : undefined,
        pointsValue: points,
        dueTimeLocal: dueTime,
        createdBy,
      };
      if (template) await updateTemplate(familyId, template.id, data);
      else await addTemplate(familyId, data);
      setSaved(true);
    } finally { setSaving(false); }
  };

  if (owners.length === 0) {
    return <p className="text-[11px] text-pulse-coral font-bold">Add kids or helpers first, then assign a reader.</p>;
  }

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
            {rotatable.map((o) => (
              <button key={o.id} type="button" onClick={() => { togglePool(o.id); setSaved(false); }} className={chip(pool.includes(o.id))}>{o.emoji} {o.name}</button>
            ))}
          </div>
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Rotates</span>
          <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
            {ROTATION_OPTS.map((r) => (
              <button key={r.id} type="button" onClick={() => { setRotationPeriod(r.id); setSaved(false); }} className={chip(rotationPeriod === r.id)}>{r.label}</button>
            ))}
          </div>
          {pool.length < 2 && <p className="text-[10px] text-pulse-coral font-bold">Pick at least 2 to rotate between.</p>}
        </>
      )}

      <div className="mt-3">
        <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">How often</span>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {CADENCE_OPTS.map((c) => (
            <button key={c.id} type="button" onClick={() => { setCadence(c.id); setSaved(false); }} className={chip(cadence === c.id)}>{c.label}</button>
          ))}
          {cadence === 'everyNWeeks' && (
            <input type="number" min={2} value={cadenceN} onChange={(e) => { setCadenceN(Math.max(2, Number(e.target.value))); setSaved(false); }}
              className="w-16 border border-pulse-gold/40 rounded-lg px-2 py-1 text-sm font-nunito font-bold" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mt-3">
        <label className="block">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Points (kids)</span>
          <input type="number" min={0} value={points} onChange={(e) => { setPoints(Math.max(0, Number(e.target.value))); setSaved(false); }}
            className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
        </label>
        <label className="block">
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Due time</span>
          <input type="time" value={dueTime} onChange={(e) => { setDueTime(e.target.value); setSaved(false); }}
            className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1" />
        </label>
      </div>

      <button type="button" onClick={save} disabled={!canSave || saving}
        className="w-full mt-3 bg-pulse-gold text-pulse-navy rounded-xl py-2 font-nunito font-black text-[12px] disabled:opacity-50">
        {saving ? 'Saving…' : saved ? '✓ Reader saved' : template ? 'Update reader' : 'Save reader'}
      </button>
    </div>
  );
}

function chip(active: boolean): string {
  return `text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${
    active ? 'bg-pulse-gold text-pulse-navy border-pulse-gold' : 'bg-white text-hive-muted border-pulse-gold/40'
  }`;
}
