'use client';

// /pulse/admin — Kaya Pulse · Task Setup (parent-only).
//
// Two jobs:
//   1. Turn a utility meter into a Pulse trackable — set its reading
//      direction (prepaid/depleting 'down' vs postpaid/cumulative 'up')
//      and an optional auto-top-up threshold (the Kaya Plus seam).
//   2. Create reading tasks (templates) — who logs what, how often,
//      fixed or rotating between kids, for how many points.
//
// Non-meter trackables (fuel / generator / odometer) + helper owners
// land in the next pass; this slice covers the LUKU vertical demo.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatCents } from '@/components/pantry/format';
import {
  type UtilityMeter,
  subscribeToMeters, updateMeter, meterEmoji,
} from '@/lib/utilityMeters';
import {
  type Trackable, type MeterDirection as MeterDir, type PulseTemplate, type PulseCadence,
  type OwnerType, type RotationPeriod,
  subscribeToTrackables, subscribeToTemplates, addTemplate, removeTemplate, generateTasksNow,
} from '@/lib/pulse';

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

export default function PulseAdminPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { config } = useHive();
  const currency = config.currency;

  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pulse');
  }, [profile, router]);

  const [meters, setMeters] = useState<UtilityMeter[]>([]);
  const [trackables, setTrackables] = useState<Trackable[]>([]);
  const [templates, setTemplates] = useState<PulseTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [genBusy, setGenBusy] = useState(false);
  const [genMsg, setGenMsg] = useState('');

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const t = setTimeout(() => setLoading(false), 1500);
    const unsubM = subscribeToMeters(profile.familyId, setMeters);
    const unsubT = subscribeToTrackables(profile.familyId, (tk) => { setTrackables(tk); setLoading(false); });
    const unsubP = subscribeToTemplates(profile.familyId, setTemplates);
    return () => { clearTimeout(t); unsubM(); unsubT(); unsubP(); };
  }, [profile?.familyId, profile?.role]);

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

  const runGenerate = async () => {
    if (!fid) return;
    setGenBusy(true);
    setGenMsg('');
    try {
      const r = await generateTasksNow(fid);
      setGenMsg(
        r.created > 0
          ? `✓ Created ${r.created} task${r.created === 1 ? '' : 's'} for today.`
          : 'No tasks due today (or already generated).',
      );
    } catch {
      setGenMsg('Could not generate — try again.');
    } finally {
      setGenBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/pulse" className="text-[12px] text-pulse-gold-dk font-bold no-underline hover:underline inline-block mb-2">← Kaya Pulse</Link>
      <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight text-pulse-navy">Task setup</h1>
      <p className="text-hive-muted text-sm mt-1">
        Turn a meter into a Pulse trackable, then schedule who reads it. Kids earn points; consumption becomes priced data.
      </p>

      {/* ── Section 1 · Trackables (utility meters) ───────────────── */}
      <h2 className="font-nunito font-black text-pulse-navy text-base mt-7 mb-1">1 · Trackables</h2>
      <p className="text-[12px] text-hive-muted mb-3">
        Enable a meter for Pulse and set how it reads. <strong>Prepaid</strong> (LUKU, gas) counts down to zero — a jump up is a top-up.
        <strong> Postpaid</strong> (city water, odometer) only climbs.
      </p>
      {loading ? (
        <p className="text-hive-muted text-sm">Loading…</p>
      ) : meters.length === 0 ? (
        <div className="bg-white border border-pulse-gold/40 rounded-2xl p-5 text-center">
          <div className="text-3xl mb-1">⚡</div>
          <h3 className="font-nunito font-black text-pulse-navy">No meters yet</h3>
          <p className="text-hive-muted text-sm mt-1 mb-3">Add your meters first, then enable them for Pulse here.</p>
          <Link href="/pantry/utility-meters" className="inline-block bg-pulse-navy text-pulse-gold rounded-xl px-4 py-2 font-nunito font-black text-sm">＋ Add meters</Link>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {meters.filter((m) => m.active).map((m) => (
            <MeterPulseRow key={m.id} meter={m} familyId={fid} currency={currency} />
          ))}
          <Link href="/pantry/utility-meters" className="text-[12px] text-pulse-gold-dk font-bold text-center mt-1 hover:underline">Manage meters (price, unit) →</Link>
        </div>
      )}

      {/* ── Section 2 · Reading tasks (templates) ─────────────────── */}
      <h2 className="font-nunito font-black text-pulse-navy text-base mt-8 mb-1">2 · Reading tasks</h2>
      <p className="text-[12px] text-hive-muted mb-3">Schedule who logs each trackable, and how it rotates.</p>

      <NewTemplate familyId={fid} trackables={trackables.filter((t) => t.active)} />

      {templates.length > 0 && (
        <>
          <div className="flex flex-col gap-2 mt-4">
            {templates.map((tpl) => (
              <TemplateRow key={tpl.id} tpl={tpl} familyId={fid} trackables={trackables} />
            ))}
          </div>
          <button
            onClick={runGenerate}
            disabled={genBusy}
            className="w-full mt-3 border-2 border-pulse-navy text-pulse-navy rounded-2xl py-2.5 font-nunito font-black text-sm disabled:opacity-50"
          >
            {genBusy ? 'Generating…' : "Generate today's tasks"}
          </button>
          {genMsg && <p className="text-[12px] text-center text-hive-muted font-bold mt-2">{genMsg}</p>}
          <p className="text-[11px] text-hive-muted text-center mt-1 leading-snug">
            Tasks auto-generate each morning — use this to create today's now (setup/testing).
          </p>
        </>
      )}
    </div>
  );
}

/* ── A meter row with Pulse enable + direction + threshold ───────── */
function MeterPulseRow({ meter, familyId, currency }: { meter: UtilityMeter; familyId: string; currency: string }) {
  const enabled = !!meter.pulseEnabled;
  const [dir, setDir] = useState<MeterDir>(meter.direction ?? (meter.type === 'water' ? 'up' : 'down'));
  const [thresholdMajor, setThresholdMajor] = useState<string>(
    meter.minUnitsThreshold != null ? String(meter.minUnitsThreshold) : '',
  );
  const [busy, setBusy] = useState(false);

  const hasPrice = !!meter.pricePerUnitCents && meter.pricePerUnitCents > 0;

  const toggle = async () => {
    setBusy(true);
    try {
      await updateMeter(familyId, meter.id, {
        pulseEnabled: !enabled,
        direction: !enabled ? dir : meter.direction,
      });
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

  return (
    <div className={`rounded-2xl p-3 border ${enabled ? 'bg-pulse-bone border-pulse-gold' : 'bg-white border-pulse-gold/30'}`}>
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base">{meterEmoji(meter.type)}</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-extrabold text-sm text-pulse-navy truncate">{meter.label}</div>
          <div className="text-[11px] text-hive-muted font-bold">
            {hasPrice ? `${formatCents(meter.pricePerUnitCents!, currency)}/${meter.unit || 'unit'}` : 'No unit price set'}
          </div>
        </div>
        <button
          onClick={toggle}
          disabled={busy}
          className={`text-xs font-nunito font-black px-3 py-1.5 rounded-full border ${
            enabled ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-white text-pulse-navy border-pulse-gold'
          }`}
        >{enabled ? '✓ In Pulse' : '＋ Track'}</button>
      </div>

      {enabled && (
        <div className="mt-3 pt-3 border-t border-pulse-gold/30">
          {!hasPrice && (
            <p className="text-[11px] text-pulse-coral font-bold mb-2">
              ⚠ Set a price/unit in <Link href="/pantry/utility-meters" className="underline">Manage meters</Link> so cost can be computed.
            </p>
          )}
          <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Reading direction</span>
          <div className="flex gap-2 mt-1 mb-2">
            {([['down', 'Prepaid · counts down'], ['up', 'Postpaid · counts up']] as [MeterDir, string][]).map(([d, lbl]) => (
              <button
                key={d}
                type="button"
                onClick={() => { setDir(d); saveConfig(d, thresholdMajor); }}
                className={`flex-1 text-[11px] font-nunito font-extrabold px-2 py-2 rounded-xl border ${
                  dir === d ? 'bg-pulse-navy text-pulse-gold border-pulse-navy' : 'bg-white text-pulse-navy border-pulse-gold/40'
                }`}
              >{lbl}</button>
            ))}
          </div>
          {dir === 'down' && (
            <label className="block">
              <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Auto top-up below (units)</span>
              <div className="flex items-center gap-2 mt-1">
                <input
                  type="number" min={0} step="1"
                  value={thresholdMajor}
                  onChange={(e) => setThresholdMajor(e.target.value)}
                  onBlur={() => saveConfig(dir, thresholdMajor)}
                  placeholder="e.g. 20"
                  className="flex-1 border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold focus:outline-none focus:border-pulse-gold"
                />
                <span className="text-[11px] text-hive-muted font-bold">{meter.unit || 'units'} left</span>
              </div>
              <p className="text-[10px] text-hive-muted mt-1 leading-snug">When the balance drops below this, Pulse files a top-up request for your approval.</p>
            </label>
          )}
        </div>
      )}
    </div>
  );
}

/* ── New reading-task (template) form ───────────────────────────── */
function NewTemplate({ familyId, trackables }: { familyId: string; trackables: Trackable[] }) {
  const { profile } = useAuth();
  const { children: kids } = useFamily();
  const [open, setOpen] = useState(false);
  const [trackableId, setTrackableId] = useState('');
  const [cadence, setCadence] = useState<PulseCadence>('daily');
  const [cadenceN, setCadenceN] = useState(2);
  const [ownerType, setOwnerType] = useState<OwnerType>('rotating');
  const [fixedOwner, setFixedOwner] = useState('');
  const [pool, setPool] = useState<string[]>([]);
  const [rotationPeriod, setRotationPeriod] = useState<RotationPeriod>('weekly');
  const [points, setPoints] = useState(10);
  const [dueTime, setDueTime] = useState('20:00');
  const [saving, setSaving] = useState(false);

  const selected = trackables.find((t) => t.id === trackableId);
  const togglePool = (id: string) =>
    setPool((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const canSave = !!selected
    && (ownerType === 'fixed' ? !!fixedOwner : pool.length >= 2)
    && points >= 0;

  const submit = async () => {
    if (!selected || !profile?.uid || saving) return;
    setSaving(true);
    try {
      await addTemplate(familyId, {
        trackableId: selected.id,
        trackableSource: selected.source,
        cadence,
        cadenceN: cadence === 'everyNWeeks' ? cadenceN : undefined,
        ownerKind: 'kid',
        ownerType,
        ownerId: ownerType === 'fixed' ? fixedOwner : undefined,
        rotationPool: ownerType === 'rotating' ? pool : undefined,
        rotationPeriod: ownerType === 'rotating' ? rotationPeriod : undefined,
        rotationCurrent: ownerType === 'rotating' ? pool[0] : undefined,
        pointsValue: points,
        dueTimeLocal: dueTime,
        createdBy: profile.uid,
      });
      setOpen(false);
      setTrackableId(''); setOwnerType('rotating'); setFixedOwner(''); setPool([]); setPoints(10); setDueTime('20:00');
    } finally { setSaving(false); }
  };

  if (trackables.length === 0) {
    return (
      <div className="bg-white border border-pulse-gold/30 rounded-2xl p-4 text-center text-sm text-hive-muted">
        Enable a trackable above first, then schedule a reading task.
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="w-full bg-pulse-navy text-pulse-gold rounded-2xl py-3 font-nunito font-black text-sm">
        ＋ New reading task
      </button>
    );
  }

  return (
    <div className="bg-white border border-pulse-gold rounded-2xl p-4">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pulse-gold-dk mb-3">New reading task</p>

      <Field label="Trackable">
        <div className="flex flex-wrap gap-1.5">
          {trackables.map((t) => (
            <button key={`${t.source}:${t.id}`} type="button" onClick={() => setTrackableId(t.id)}
              className={chip(trackableId === t.id)}>{t.emoji} {t.name}</button>
          ))}
        </div>
      </Field>

      <Field label="How often">
        <div className="flex flex-wrap gap-1.5">
          {CADENCE_OPTS.map((c) => (
            <button key={c.id} type="button" onClick={() => setCadence(c.id)} className={chip(cadence === c.id)}>{c.label}</button>
          ))}
          {cadence === 'everyNWeeks' && (
            <input type="number" min={2} value={cadenceN} onChange={(e) => setCadenceN(Math.max(2, Number(e.target.value)))}
              className="w-16 border border-pulse-gold/40 rounded-lg px-2 py-1 text-sm font-nunito font-bold" />
          )}
        </div>
      </Field>

      <Field label="Owner">
        <div className="flex gap-1.5 mb-2">
          <button type="button" onClick={() => setOwnerType('fixed')} className={chip(ownerType === 'fixed')}>Fixed</button>
          <button type="button" onClick={() => setOwnerType('rotating')} className={chip(ownerType === 'rotating')}>Rotating</button>
        </div>
        {ownerType === 'fixed' ? (
          <div className="flex flex-wrap gap-1.5">
            {kids.map((k) => (
              <button key={k.id} type="button" onClick={() => setFixedOwner(k.id)} className={chip(fixedOwner === k.id)}>
                {k.avatarEmoji ?? '🧒'} {k.name}
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {kids.map((k) => (
                <button key={k.id} type="button" onClick={() => togglePool(k.id)} className={chip(pool.includes(k.id))}>
                  {k.avatarEmoji ?? '🧒'} {k.name}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">Rotates</span>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {ROTATION_OPTS.map((r) => (
                <button key={r.id} type="button" onClick={() => setRotationPeriod(r.id)} className={chip(rotationPeriod === r.id)}>{r.label}</button>
              ))}
            </div>
            {pool.length < 2 && <p className="text-[10px] text-pulse-coral font-bold mt-1">Pick at least 2 kids to rotate between.</p>}
          </>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Points (kid)">
          <input type="number" min={0} value={points} onChange={(e) => setPoints(Math.max(0, Number(e.target.value)))}
            className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold" />
        </Field>
        <Field label="Due time">
          <input type="time" value={dueTime} onChange={(e) => setDueTime(e.target.value)}
            className="w-full border border-pulse-gold/40 rounded-lg px-3 py-2 text-sm font-nunito font-bold" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-2 mt-2">
        <button onClick={() => setOpen(false)} className="border border-pulse-gold/40 rounded-xl py-2 font-nunito font-bold text-sm text-pulse-navy">Cancel</button>
        <button onClick={submit} disabled={!canSave || saving} className="bg-pulse-navy text-pulse-gold rounded-xl py-2 font-nunito font-black text-sm disabled:opacity-50">
          {saving ? 'Creating…' : 'Create task'}
        </button>
      </div>
    </div>
  );
}

function TemplateRow({ tpl, familyId, trackables }: { tpl: PulseTemplate; familyId: string; trackables: Trackable[] }) {
  const confirmAction = useConfirm();
  const { children: kids } = useFamily();
  const [busy, setBusy] = useState(false);
  const tk = trackables.find((t) => t.id === tpl.trackableId);
  const kidName = (id?: string) => kids.find((k) => k.id === id)?.name ?? 'Unknown';
  const ownerText = tpl.ownerType === 'fixed'
    ? kidName(tpl.ownerId)
    : `${(tpl.rotationPool ?? []).map(kidName).join(' ↔ ')} · ${tpl.rotationPeriod ?? 'weekly'}`;

  const remove = async () => {
    const ok = await confirmAction({ title: 'Delete this reading task?', message: 'Past readings stay. No new tasks will generate.', confirmLabel: 'Delete', tone: 'danger' });
    if (!ok) return;
    setBusy(true);
    try { await removeTemplate(familyId, tpl.id); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-pulse-gold/30 rounded-2xl p-3 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl bg-pulse-cream flex items-center justify-center text-base">{tk?.emoji ?? '📊'}</div>
      <div className="flex-1 min-w-0">
        <div className="font-nunito font-extrabold text-sm text-pulse-navy truncate">{tk?.name ?? 'Trackable'}</div>
        <div className="text-[11px] text-hive-muted font-bold">{tpl.cadence} · {ownerText} · {tpl.pointsValue} pts · {tpl.dueTimeLocal}</div>
      </div>
      <button onClick={remove} disabled={busy} className="text-xs font-nunito font-bold text-pulse-coral px-2">Delete</button>
    </div>
  );
}

/* ── tiny presentational helpers ────────────────────────────────── */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block mb-3">
      <span className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px] block mb-1">{label}</span>
      {children}
    </label>
  );
}
function chip(active: boolean): string {
  return `text-[11px] font-nunito font-extrabold px-3 py-1.5 rounded-full border ${
    active ? 'bg-pulse-gold text-pulse-navy border-pulse-gold' : 'bg-white text-hive-muted border-pulse-gold/40'
  }`;
}
