'use client';

// /pantry/setup — Household Setup hub (Drivers v2 / Screen E, 2026-07-05).
//
// ONE gear, everything: every Household module configures from here so
// parents stop hunting through scattered surfaces (/pantry/budget caps,
// /pantry/utility-meters, Manage vehicles, the guardrails card…). Each
// row deep-links into the existing management page — old routes keep
// working; this hub is the front door. Future modules (Kaya Plus
// thresholds…) get a row here too.
//
// The Units & formats card lives INLINE (family-wide distance km/mi +
// fuel volume L/gal). Storage stays canonical; display converts —
// history is never rewritten.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { subscribeToVehicles } from '@/lib/vehicles';
import { subscribeToMeters } from '@/lib/utilityMeters';
import { readPurchaseConfig, readDriversConfig } from '@/lib/purchase';
import {
  readFamilyUnits, setFamilyUnits,
  type DistanceUnit, type FuelVolumeUnit,
} from '@/lib/units';
import { getFamilyMembers, getChildren, type UserProfile, type Child } from '@/lib/firestore';
import {
  setKidEmailPrefs, DEFAULT_DIGEST_TIME, DIGEST_TIME_CHOICES,
  type KidEmailPrefs, type KidEmailSource, type KidEmailUpdatesConfig,
} from '@/lib/kidEmails';
import {
  ALERT_CATEGORIES,
  setGlobalAlertEmails, setCategoryAlertEmails,
  type AlertCategory, type AlertEmailsConfig,
} from '@/lib/alertEmails';

export default function HouseholdSetupHub() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();

  const [vehicleCount, setVehicleCount] = useState<number | null>(null);
  const [meterCount, setMeterCount] = useState<number | null>(null);
  const [savingUnits, setSavingUnits] = useState(false);

  // Parent-only — same guard pattern as /pantry/utility/setup.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent') return;
    const a = subscribeToVehicles(profile.familyId, (v) => setVehicleCount(v.filter((x) => x.active).length));
    const b = subscribeToMeters(profile.familyId, (m) => setMeterCount(m.length));
    return () => { a(); b(); };
  }, [profile?.familyId, profile?.role]);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Household Setup is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Helpers work inside the modules parents have set up here.
        </p>
        <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Household
        </Link>
      </div>
    );
  }

  const units = readFamilyUnits(family);
  const purchaseCfg = readPurchaseConfig(family);
  const driversCfg = readDriversConfig(family);
  const approvalLabel = (family?.approvalModes?.pantry ?? family?.approvalMode ?? 'either') === 'both'
    ? 'Both parents approve'
    : 'Either parent approves';

  const pickUnit = async (patch: { distance?: DistanceUnit; fuelVolume?: FuelVolumeUnit }) => {
    if (!profile?.familyId || savingUnits) return;
    setSavingUnits(true);
    try {
      await setFamilyUnits(profile.familyId, { ...readFamilyUnits(family), ...patch });
    } finally { setSavingUnits(false); }
  };

  const rows: {
    href: string; emoji: string; title: string; sub: string;
  }[] = [
    { href: '/pantry/budget', emoji: '💰', title: 'Budgets & caps', sub: 'Per-module monthly caps' },
    {
      href: '/pantry/setup/vehicles', emoji: '🚗', title: 'Vehicles & service',
      sub: `${vehicleCount ?? '…'} vehicle${vehicleCount === 1 ? '' : 's'} · intervals · reminders · odometer rule`,
    },
    {
      href: '/pantry/utility-meters', emoji: '⚡', title: 'Utility meters',
      sub: `${meterCount ?? '…'} meter${meterCount === 1 ? '' : 's'} · price per unit`,
    },
    {
      href: '/pantry/purchase', emoji: '🛡️', title: 'Purchase guardrails',
      sub: `Price band ±${purchaseCfg.maxPriceChangePct}% · odometer ${driversCfg.odometerMandatoryForHelpers ? 'required' : 'optional'} for drivers`,
    },
    { href: '/settings', emoji: '✅', title: 'Approval mode', sub: approvalLabel },
  ];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-extrabold text-xs">
        ← Household
      </Link>
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk mt-3">
        Household
      </p>
      <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
        ⚙️ Setup
      </h1>
      <p className="text-hive-muted text-sm mt-1 mb-4">
        Everything in one place. Parents only.
      </p>

      <div className="bg-hive-paper border border-hive-line rounded-hive overflow-hidden mb-3">
        {rows.map((r, i) => (
          <Link
            key={r.href}
            href={r.href}
            className={`flex items-center gap-3 px-4 py-3.5 no-underline hover:bg-hive-cream ${
              i > 0 ? 'border-t border-hive-line' : ''
            }`}
          >
            <span className="text-[22px] flex-shrink-0">{r.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block font-nunito font-extrabold text-[15px] text-hive-navy">{r.title}</span>
              <span className="block text-[12px] text-hive-muted font-bold truncate">{r.sub}</span>
            </span>
            <span className="text-hive-muted font-nunito font-black flex-shrink-0">›</span>
          </Link>
        ))}
      </div>

      {/* Units & formats — inline, per the approved Screen E. */}
      <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-2">
          📏 Units & formats
        </p>
        <div className="flex items-center justify-between py-1.5">
          <span className="font-nunito font-extrabold text-sm">Distance</span>
          <div className="flex bg-hive-cream rounded-full p-0.5">
            {(['km', 'mi'] as DistanceUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                disabled={savingUnits}
                onClick={() => pickUnit({ distance: u })}
                className={`px-4 py-1.5 rounded-full text-[13px] font-nunito font-extrabold ${
                  units.distance === u ? 'bg-white shadow text-hive-navy' : 'text-hive-muted'
                }`}
              >
                {u === 'km' ? 'km' : 'miles'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between py-1.5">
          <span className="font-nunito font-extrabold text-sm">Fuel volume</span>
          <div className="flex bg-hive-cream rounded-full p-0.5">
            {(['L', 'gal'] as FuelVolumeUnit[]).map((u) => (
              <button
                key={u}
                type="button"
                disabled={savingUnits}
                onClick={() => pickUnit({ fuelVolume: u })}
                className={`px-4 py-1.5 rounded-full text-[13px] font-nunito font-extrabold ${
                  units.fuelVolume === u ? 'bg-white shadow text-hive-navy' : 'text-hive-muted'
                }`}
              >
                {u === 'L' ? 'litres' : 'gallons'}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-hive-muted font-bold mt-2">
          Family-wide. Changes relabel every screen, reminder and report — history is stored
          raw and converted on display.
        </p>
      </div>

      {/* 🔔 Alert emails — the Global → Category cascade (VIS PR3).
          Per-item overrides live on the item's own editor (VIS PR4). */}
      {profile?.familyId && (
        <AlertEmailsCard familyId={profile.familyId} cfg={family?.alertEmails} />
      )}

      {/* 📬 Kids' email updates (KID PR1) — selection from what's already
          registered, never re-entry; everything defaults OFF (COPPA). */}
      {profile?.familyId && (
        <KidEmailUpdatesCard familyId={profile.familyId} cfg={family?.kidEmailUpdates} contacts={family?.externalContacts} />
      )}
    </div>
  );
}

/* ── 📬 Kids' email updates card — rewards + morning digest per kid.
      The address is a POINTER selected from registered sources (kid profile
      email · parent login · approved contact) and resolves live at send
      time — no re-entry, no stale copies (F2/F9). Streams default OFF;
      toggles stay locked until a source with a real address is picked. ── */
function KidEmailUpdatesCard({ familyId, cfg, contacts }: {
  familyId: string;
  cfg?: KidEmailUpdatesConfig;
  contacts?: { id: string; name: string; email: string }[];
}) {
  const [kids, setKids] = useState<Child[]>([]);
  const [parents, setParents] = useState<UserProfile[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([getChildren(familyId), getFamilyMembers(familyId)]).then(([cs, ms]) => {
      if (!alive) return;
      setKids(cs);
      setParents(ms.filter((m) => m.role === 'parent'));
    });
    return () => { alive = false; };
  }, [familyId]);

  // Resolve a source pointer to its display address — the same rules the
  // server applies at send time (lib/kidEmails.server).
  const addressOf = (kid: Child, source?: KidEmailSource): { email?: string; label: string } => {
    if (!source) return { label: 'pick who receives them' };
    if (source.type === 'kid') return kid.email
      ? { email: kid.email, label: `${kid.name}'s profile email` }
      : { label: 'no profile email yet' };
    if (source.type === 'parent') {
      const p = parents.find((x) => x.uid === source.uid);
      return p?.email ? { email: p.email, label: p.displayName } : { label: 'parent unavailable' };
    }
    const c = (contacts ?? []).find((x) => x.id === source.id);
    return c?.email ? { email: c.email, label: `${c.name} (approved contact)` } : { label: 'contact removed' };
  };

  const save = async (childId: string, prefs: KidEmailPrefs) => {
    if (busy) return;
    setBusy(true);
    try { await setKidEmailPrefs(familyId, childId, prefs); }
    finally { setBusy(false); }
  };

  const srcChip = (on: boolean, label: string, onPick: () => void, disabled?: boolean) => (
    <button
      type="button"
      disabled={busy || disabled}
      onClick={onPick}
      className={`text-[10.5px] font-nunito font-extrabold px-2 py-1 rounded-full border ${
        on ? 'bg-hive-honey text-white border-hive-honey-dk'
          : disabled ? 'bg-white border-dashed border-hive-line text-hive-muted opacity-50'
          : 'bg-white border-hive-line text-hive-muted'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mt-3">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">
        👧👦 Kids&apos; email updates
      </p>
      <p className="text-[12px] text-hive-muted font-bold mb-2">
        Send kids their 🏅 rewards and 🌞 morning routine by email — <b>pick from what&apos;s
        already registered</b>, no typing. Everything starts OFF.
      </p>

      {kids.length === 0 && <p className="text-[12px] text-hive-muted font-bold">No kids on the family yet.</p>}

      {kids.map((kid) => {
        const prefs = cfg?.[kid.id] ?? {};
        const src = prefs.source;
        const addr = addressOf(kid, src);
        const armed = !!addr.email;
        const streamsOn = (prefs.rewards ? 1 : 0) + (prefs.digest ? 1 : 0);
        // Rebuild the prefs object without undefined values on every save —
        // the dot-path map write replaces the whole per-kid entry, and
        // Firestore rejects undefined.
        const base = (over: Partial<KidEmailPrefs>): KidEmailPrefs => {
          const merged = { ...prefs, ...over };
          const next: KidEmailPrefs = {};
          if (merged.source) next.source = merged.source;
          if (merged.rewards) next.rewards = true;
          if (merged.digest) next.digest = true;
          if (merged.digestTime) next.digestTime = merged.digestTime;
          if (merged.lastDigestDayKey) next.lastDigestDayKey = merged.lastDigestDayKey;
          return next;
        };
        return (
          <div key={kid.id} className="rounded-xl border border-hive-line bg-white px-3 py-2.5 mb-2">
            <div className="flex items-center gap-2.5">
              <span className="w-8 h-8 rounded-full bg-[#FFF3D9] text-base flex items-center justify-center shrink-0">
                {kid.avatarEmoji || '🙂'}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-nunito font-extrabold text-[13px] text-hive-navy">{kid.name}</span>
                <span className="block text-[11px] text-hive-muted font-bold truncate">
                  {addr.email ? `→ ${addr.label} · ${addr.email}` : addr.label}
                </span>
              </span>
              {streamsOn > 0 && armed ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#E7F5EC] text-pantry-leaf-dk border border-pantry-leaf-dk/30 shrink-0">{streamsOn} on</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-white text-hive-muted border border-dashed border-hive-line opacity-75 shrink-0">off</span>
              )}
            </div>

            <span className="block text-[9.5px] font-bold uppercase tracking-[1.5px] text-hive-muted mt-2 mb-1">Send to</span>
            <div className="flex flex-wrap gap-1.5">
              {kid.email ? (
                srcChip(src?.type === 'kid', `👧 ${kid.name}'s profile email`, () => save(kid.id, base({ source: { type: 'kid' } })))
              ) : (
                <Link
                  href="/profiles"
                  className="text-[10.5px] font-nunito font-extrabold px-2 py-1 rounded-full border border-dashed border-hive-line text-hive-muted opacity-75"
                >
                  👧 no profile email — add it in Profiles ›
                </Link>
              )}
              {parents.map((p) => srcChip(
                src?.type === 'parent' && src.uid === p.uid,
                `${p.displayName}`,
                () => save(kid.id, base({ source: { type: 'parent', uid: p.uid } })),
                !p.email,
              ))}
              {(contacts ?? []).map((c) => srcChip(
                src?.type === 'contact' && src.id === c.id,
                `📇 ${c.name}`,
                () => save(kid.id, base({ source: { type: 'contact', id: c.id } })),
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2.5">
              <span className={`text-[12px] font-bold flex-1 ${armed ? 'text-hive-navy' : 'text-hive-muted opacity-60'}`}>🏅 Rewards &amp; points — instant</span>
              <button
                type="button"
                aria-label={`Toggle reward emails for ${kid.name}`}
                disabled={busy || !armed}
                onClick={() => save(kid.id, base({ rewards: !prefs.rewards }))}
                className={`w-10 h-[22px] rounded-full relative transition-colors shrink-0 ${prefs.rewards && armed ? 'bg-hive-honey' : 'bg-hive-line'} ${!armed ? 'opacity-50' : ''}`}
              >
                <span className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-all ${prefs.rewards && armed ? 'right-0.5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className={`text-[12px] font-bold flex-1 ${armed ? 'text-hive-navy' : 'text-hive-muted opacity-60'}`}>
                🌞 Morning routine digest
                {prefs.digest && armed && (
                  <select
                    value={prefs.digestTime ?? DEFAULT_DIGEST_TIME}
                    disabled={busy}
                    onChange={(e) => save(kid.id, base({ digestTime: e.target.value }))}
                    className="ml-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk bg-transparent border border-hive-line rounded-lg px-1 py-0.5"
                  >
                    {DIGEST_TIME_CHOICES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                )}
              </span>
              <button
                type="button"
                aria-label={`Toggle morning digest for ${kid.name}`}
                disabled={busy || !armed}
                onClick={() => save(kid.id, base({ digest: !prefs.digest }))}
                className={`w-10 h-[22px] rounded-full relative transition-colors shrink-0 ${prefs.digest && armed ? 'bg-hive-honey' : 'bg-hive-line'} ${!armed ? 'opacity-50' : ''}`}
              >
                <span className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-all ${prefs.digest && armed ? 'right-0.5' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="flex items-center gap-2 mt-1.5 opacity-60">
              <span className="text-[12px] font-bold flex-1 text-hive-muted">📱 WhatsApp · coming soon</span>
            </div>
          </div>
        );
      })}

      <p className="text-[11px] text-hive-muted font-bold mt-1 bg-[#EEF2FA] border border-[#CCD6EA] rounded-lg px-2.5 py-2">
        🛡️ <b>Parent-managed (COPPA):</b> addresses come only from registered sources and resolve
        live — change a profile email once and every future send follows. Every kid email is
        readable in the 📜 Alert log.
      </p>
    </div>
  );
}

/* ── 🔔 Alert emails card — who receives alert EMAILS.
      Global default + per-category detach (amber "custom" badge + reset,
      D10). Zero-recipient saves are refused (F1). In-app + family chat are
      unaffected — email only. ── */
function AlertEmailsCard({ familyId, cfg }: { familyId: string; cfg?: AlertEmailsConfig }) {
  const [parents, setParents] = useState<UserProfile[]>([]);
  const [openCat, setOpenCat] = useState<AlertCategory | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    getFamilyMembers(familyId).then((ms) => {
      if (alive) setParents(ms.filter((m) => m.role === 'parent'));
    });
    return () => { alive = false; };
  }, [familyId]);

  const allUids = parents.map((p) => p.uid);
  const nameOf = (uid: string) => parents.find((p) => p.uid === uid)?.displayName || 'Parent';
  // Same safety floor as the engine's resolver (F1): stored-but-empty (or
  // only ex-parents) → everyone.
  const storedGlobal = (cfg?.global ?? []).filter((u) => allUids.includes(u));
  const effectiveGlobal = storedGlobal.length > 0 ? storedGlobal : allUids;

  const saveGlobal = async (next: string[]) => {
    if (busy || next.length === 0) return; // F1: never save an empty alarm list
    setBusy(true);
    try { await setGlobalAlertEmails(familyId, next.length === allUids.length ? undefined : next); }
    finally { setBusy(false); }
  };
  const saveCategory = async (cat: AlertCategory, next: string[] | undefined) => {
    if (busy || (next && next.length === 0)) return;
    setBusy(true);
    try { await setCategoryAlertEmails(familyId, cat, next); }
    finally { setBusy(false); }
  };

  const ParentToggleRow = ({ uid, on, onToggle, blockOff }: {
    uid: string; on: boolean; onToggle: () => void; blockOff: boolean;
  }) => {
    const p = parents.find((x) => x.uid === uid);
    return (
      <div className="flex items-center gap-2.5 py-1.5">
        <span className="w-7 h-7 rounded-full bg-hive-navy text-white text-[10px] font-nunito font-black flex items-center justify-center shrink-0">
          {(p?.displayName || 'P').slice(0, 1).toUpperCase()}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-nunito font-extrabold text-[13px] text-hive-navy">{p?.displayName || 'Parent'}</span>
          <span className="block text-[11px] text-hive-muted font-bold truncate">{p?.email || '—'}</span>
        </span>
        <button
          type="button"
          aria-label={`Toggle ${p?.displayName || 'parent'}`}
          disabled={busy}
          onClick={() => { if (on && blockOff) return; onToggle(); }}
          className={`w-10 h-[22px] rounded-full relative transition-colors shrink-0 ${on ? 'bg-hive-honey' : 'bg-hive-line'} ${on && blockOff ? 'opacity-50' : ''}`}
        >
          <span className={`absolute top-0.5 w-[18px] h-[18px] bg-white rounded-full transition-all ${on ? 'right-0.5' : 'left-0.5'}`} />
        </button>
      </div>
    );
  };

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mt-3">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">
        🔔 Alert emails
      </p>
      <p className="text-[12px] text-hive-muted font-bold mb-2">
        Who receives low-balance &amp; reminder <b>emails</b>. In-app and family chat aren&apos;t
        affected. Meters can still override per item.
      </p>

      {/* 🌍 Global default */}
      <div className="rounded-xl border border-hive-line bg-white px-3 py-2 mb-2">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-nunito font-black text-[13px]">🌍 Global — all alert emails</span>
          <span className="ml-auto px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#E7F5EC] text-pantry-leaf-dk border border-pantry-leaf-dk/30">default</span>
        </div>
        {parents.map((p) => {
          const on = effectiveGlobal.includes(p.uid);
          return (
            <ParentToggleRow
              key={p.uid}
              uid={p.uid}
              on={on}
              blockOff={on && effectiveGlobal.length === 1}
              onToggle={() => saveGlobal(on ? effectiveGlobal.filter((u) => u !== p.uid) : [...effectiveGlobal, p.uid])}
            />
          );
        })}
        {effectiveGlobal.length === 1 && (
          <p className="text-[10px] text-hive-rose font-bold">At least one parent must stay on — or nobody hears the alarm.</p>
        )}
      </div>

      {/* By category — inherit / detach */}
      <p className="text-[10px] font-nunito font-black uppercase tracking-[1.5px] text-hive-muted mb-1.5">By category</p>
      {ALERT_CATEGORIES.map((c) => {
        const stored = cfg?.[c.key];
        const custom = Array.isArray(stored) && stored.filter((u) => allUids.includes(u)).length > 0;
        const effective = custom ? stored.filter((u) => allUids.includes(u)) : effectiveGlobal;
        const isOpen = openCat === c.key;
        return (
          <div key={c.key} className={`rounded-xl border px-3 py-2 mb-1.5 ${custom ? 'border-dashed border-hive-honey-soft bg-[#FEF6E8]' : 'border-hive-line bg-white'}`}>
            <button type="button" className="w-full flex items-center gap-2 text-left" onClick={() => setOpenCat(isOpen ? null : c.key)}>
              <span className="text-base">{c.emoji}</span>
              <span className="flex-1 min-w-0">
                <span className="block font-nunito font-extrabold text-[13px] text-hive-navy">{c.label}</span>
                <span className="block text-[11px] text-hive-muted font-bold truncate">{effective.map(nameOf).join(' + ') || '—'}</span>
              </span>
              {custom ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#FFF3D9] text-hive-honey-dk border border-hive-honey/40">custom</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-nunito font-black bg-[#EEF2FA] text-[#5B6B8C] border border-[#CCD6EA]">follows global</span>
              )}
              <span className="text-hive-muted font-nunito font-black">{isOpen ? '▾' : '›'}</span>
            </button>
            {isOpen && (
              <div className="mt-1.5 pt-1.5 border-t border-dashed border-hive-line">
                {parents.map((p) => {
                  const on = effective.includes(p.uid);
                  return (
                    <ParentToggleRow
                      key={p.uid}
                      uid={p.uid}
                      on={on}
                      blockOff={on && effective.length === 1}
                      onToggle={() => saveCategory(c.key, on ? effective.filter((u) => u !== p.uid) : [...effective, p.uid])}
                    />
                  );
                })}
                {custom && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => saveCategory(c.key, undefined)}
                    className="text-[11px] font-nunito font-extrabold text-hive-honey-dk mt-1"
                  >
                    ↺ Reset to inherit global
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-hive-muted font-bold mt-2">
        ⚡ Utilities is live now; 🚗 Vehicles &amp; 📄 Subscriptions apply as their reminder
        engines adopt the cascade. The Alert log records which level resolved each send.
      </p>
    </div>
  );
}
