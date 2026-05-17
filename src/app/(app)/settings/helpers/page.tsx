'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { Copy, Check, UserPlus, Pause, Play, Trash2, ChevronLeft, KeyRound, ChevronDown, ChevronUp } from 'lucide-react';
import {
  ensureFamilyCode,
  listHelpers,
  createHelper,
  updateHelperLink,
  removeHelper,
  generateShortCode,
  generatePassword,
  type CreateHelperResult,
} from '@/lib/helpers';
import { KID_MODULES, DEFAULT_KID_MODULES } from '@/lib/kidModules';
import type { HelperLink } from '@/lib/firestore';

type Preset = HelperLink['preset'];

const PRESETS: { id: Preset; label: string; description: string; modules: string[]; canAward: boolean }[] = [
  { id: 'nanny',       label: 'Nanny',       description: 'Routines, meals, kudos, photos', modules: ['home', 'household', 'moments'], canAward: true },
  { id: 'tutor',       label: 'Tutor',       description: 'Homework & study routines',      modules: ['home'],                          canAward: false },
  { id: 'driver',      label: 'Driver',      description: 'Pickup, dropoff, schedule',      modules: ['home'],                          canAward: false },
  { id: 'grandparent', label: 'Grandparent', description: 'View-only across granted modules', modules: ['home', 'moments'],             canAward: true },
  { id: 'custom',      label: 'Custom',      description: 'Pick everything by hand',         modules: ['home'],                          canAward: false },
];

export default function HelpersSettingsPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children, refresh } = useFamily();

  const [familyCode, setFamilyCode] = useState<string | null>(null);
  const [helpers, setHelpers] = useState<HelperLink[] | null>(null);
  const [loadingHelpers, setLoadingHelpers] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [busyHelperUid, setBusyHelperUid] = useState<string | null>(null);

  // Lazily backfill familyCode the first time a parent opens this page.
  useEffect(() => {
    if (!family) return;
    let cancelled = false;
    (async () => {
      try {
        const code = await ensureFamilyCode(family);
        if (!cancelled) setFamilyCode(code);
      } catch (e) {
        console.error('ensureFamilyCode failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [family]);

  const reloadHelpers = useCallback(async () => {
    if (!family) return;
    setLoadingHelpers(true);
    try {
      const list = await listHelpers(family.id);
      setHelpers(list);
    } finally {
      setLoadingHelpers(false);
    }
  }, [family]);

  useEffect(() => { reloadHelpers(); }, [reloadHelpers]);

  const copy = async (value: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField((c) => (c === fieldId ? null : c)), 1400);
    } catch { /* clipboard blocked — fail silent */ }
  };

  if (!profile || profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-xl px-4 py-10 text-center">
        <p className="text-kaya-sand">Only parents can manage helpers.</p>
      </div>
    );
  }

  const activeHelpers = (helpers ?? []).filter((h) => h.status !== 'removed');
  const removedHelpers = (helpers ?? []).filter((h) => h.status === 'removed');

  return (
    <div className="mx-auto max-w-3xl px-4 lg:px-8 py-6 lg:py-8">
      {/* Header */}
      <button
        onClick={() => router.push('/settings')}
        className="inline-flex items-center gap-1 text-sm text-kaya-sand hover:text-kaya-chocolate mb-4"
      >
        <ChevronLeft size={16} /> Settings
      </button>
      <h1 className="font-display font-extrabold text-2xl lg:text-3xl tracking-tight">Helpers</h1>
      <p className="text-sm text-kaya-sand mt-1 max-w-xl">
        Helpers (nannies, tutors, grandparents, drivers) can log routines and feedback for the kids you give them access to.
      </p>

      {/* Family code card */}
      <div className="mt-6 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-kaya-sand">Your family code</p>
            <p className="font-display font-black text-3xl tracking-tight mt-1">{familyCode || '••••'}</p>
            <p className="text-xs text-kaya-sand mt-1">Helpers use this + their helper code + password to log in at <span className="font-bold">/h</span>.</p>
          </div>
          <button
            onClick={() => familyCode && copy(familyCode, 'familyCode')}
            disabled={!familyCode}
            className="px-3 py-2 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya hover:bg-white inline-flex items-center gap-2 disabled:opacity-50"
          >
            {copiedField === 'familyCode' ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}
          </button>
        </div>
      </div>

      {/* Helpers list */}
      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-display font-bold text-lg">Helpers in this family</h2>
        {!showAdd && (
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 text-sm bg-kaya-chocolate text-white rounded-kaya hover:bg-kaya-chocolate/90 inline-flex items-center gap-2"
          >
            <UserPlus size={16} /> Add helper
          </button>
        )}
      </div>

      {showAdd && familyCode && family && profile && (
        <AddHelperForm
          familyCode={familyCode}
          familyId={family.id}
          parentUid={profile.uid}
          childOptions={children.map((c) => ({ id: c.id, name: c.name }))}
          familyModules={family.kidModules ?? DEFAULT_KID_MODULES}
          existingHelperCodes={(helpers ?? []).map((h) => h.helperCode.toUpperCase())}
          onClose={() => setShowAdd(false)}
          onCreated={async () => {
            await reloadHelpers();
          }}
        />
      )}

      <div className="mt-4 space-y-3">
        {loadingHelpers && <p className="text-sm text-kaya-sand">Loading helpers…</p>}
        {!loadingHelpers && activeHelpers.length === 0 && !showAdd && (
          <div className="bg-white border border-dashed border-kaya-warm-dark rounded-kaya-lg p-6 text-center">
            <p className="text-sm text-kaya-sand">No helpers yet. Add the first one to start.</p>
          </div>
        )}
        {activeHelpers.map((h) => (
          <HelperRow
            key={h.uid}
            helper={h}
            childOptions={children.map((c) => ({ id: c.id, name: c.name }))}
            busy={busyHelperUid === h.uid}
            onPauseToggle={async () => {
              if (!family) return;
              setBusyHelperUid(h.uid);
              try {
                await updateHelperLink(family.id, h.uid, {
                  status: h.status === 'paused' ? 'active' : 'paused',
                });
                await reloadHelpers();
              } finally { setBusyHelperUid(null); }
            }}
            onRemove={async () => {
              if (!family) return;
              if (!confirm(`Remove ${h.displayName}? Their login will stop working immediately. Past entries are kept.`)) return;
              setBusyHelperUid(h.uid);
              try {
                await removeHelper(family.id, h.uid);
                await reloadHelpers();
              } finally { setBusyHelperUid(null); }
            }}
            onUpdateKids={async (kidIds) => {
              if (!family) return;
              setBusyHelperUid(h.uid);
              try {
                await updateHelperLink(family.id, h.uid, { kidIds });
                await reloadHelpers();
              } finally { setBusyHelperUid(null); }
            }}
          />
        ))}
      </div>

      {removedHelpers.length > 0 && (
        <details className="mt-8">
          <summary className="text-xs text-kaya-sand cursor-pointer">
            Removed helpers ({removedHelpers.length})
          </summary>
          <div className="mt-3 space-y-2">
            {removedHelpers.map((h) => (
              <div key={h.uid} className="text-xs text-kaya-sand p-3 bg-white/60 border border-kaya-warm-dark rounded-kaya">
                {h.displayName} · {h.helperCode}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// ── Add Helper form ────────────────────────────────
function AddHelperForm({
  familyCode, familyId, parentUid, childOptions, familyModules, existingHelperCodes,
  onClose, onCreated,
}: {
  familyCode: string;
  familyId: string;
  parentUid: string;
  childOptions: { id: string; name: string }[];
  familyModules: string[];
  existingHelperCodes: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState('');
  const [helperCode, setHelperCode] = useState('');
  const [password, setPassword] = useState('');
  const [preset, setPreset] = useState<Preset>('nanny');
  const [selectedKidIds, setSelectedKidIds] = useState<string[]>(childOptions.map((c) => c.id));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateHelperResult | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // Auto-fill defaults on open. Helper code is derived from name (first
  // 5 chars, uppercased) the first time the parent types a name. Password
  // is auto-generated immediately so it's ready to share.
  useEffect(() => { if (!password) setPassword(generatePassword()); }, [password]);
  useEffect(() => {
    if (!helperCode && name) {
      const auto = name.trim().split(/\s+/)[0]?.slice(0, 5).toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (auto) setHelperCode(auto);
    }
  }, [name, helperCode]);

  const presetCfg = PRESETS.find((p) => p.id === preset)!;

  const copy = async (value: string, id: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(id);
      setTimeout(() => setCopiedField((c) => (c === id ? null : c)), 1400);
    } catch { /* noop */ }
  };

  // After creation: render the credentials card and a "Done" button.
  if (result) {
    const { familyCode: fc, helperCode: hc, password: pw } = result.loginInstructions;
    // Full shareable URL — built client-side from the current origin so
    // it's always correct in dev (localhost), staging, and production.
    // `window` is only touched inside the component body which runs
    // client-only ('use client' at the top), so SSR is safe.
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const loginUrl = `${origin}/h`;
    const oneLine =
      `Kaya helper sign-in:\n` +
      `${loginUrl}\n\n` +
      `Family code: ${fc}\n` +
      `Helper code: ${hc}\n` +
      `Password: ${pw}`;
    return (
      <div className="mt-4 bg-kaya-gold-light/20 border-2 border-kaya-gold rounded-kaya-lg p-5">
        <p className="font-display font-bold text-lg">Helper added — share these with them</p>
        <p className="text-xs text-kaya-sand mt-1">
          The password is shown ONCE. Copy it now and send via WhatsApp / in person.
        </p>
        <div className="mt-4 space-y-2">
          <CredRow label="Login URL"   value={loginUrl} id="url" copy={copy} copied={copiedField === 'url'} />
          <CredRow label="Family code" value={fc}       id="fc"  copy={copy} copied={copiedField === 'fc'} />
          <CredRow label="Helper code" value={hc}       id="hc"  copy={copy} copied={copiedField === 'hc'} />
          <CredRow label="Password"    value={pw}       id="pw"  copy={copy} copied={copiedField === 'pw'} mono />
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button
            onClick={() => copy(oneLine, 'all')}
            className="flex-1 px-3 py-2 text-sm bg-white border border-kaya-warm-dark rounded-kaya hover:bg-kaya-cream inline-flex items-center justify-center gap-2"
          >
            {copiedField === 'all' ? <><Check size={16} /> Copied (paste in WhatsApp)</> : <><Copy size={16} /> Copy all 4 (WhatsApp-ready)</>}
          </button>
          <button
            onClick={() => { setResult(null); onClose(); onCreated(); }}
            className="px-4 py-2 text-sm bg-kaya-chocolate text-white rounded-kaya hover:bg-kaya-chocolate/90"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-4 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="font-display font-bold text-lg">New helper</p>
        <button onClick={onClose} className="text-xs text-kaya-sand hover:text-kaya-chocolate">Cancel</button>
      </div>

      {/* Name */}
      <label className="block mb-3">
        <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Name</span>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Amina"
          className="mt-1 w-full px-3 py-2 bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate"
        />
      </label>

      {/* Helper code + password */}
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Helper code</span>
          <div className="mt-1 flex">
            <input
              type="text"
              value={helperCode}
              onChange={(e) => setHelperCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
              placeholder="AMINA"
              className="flex-1 px-3 py-2 bg-kaya-cream border border-kaya-warm-dark rounded-l-kaya focus:outline-none focus:border-kaya-chocolate font-mono"
            />
            <button
              type="button"
              onClick={() => setHelperCode(generateShortCode(5))}
              className="px-3 bg-kaya-cream border border-l-0 border-kaya-warm-dark rounded-r-kaya text-xs"
              title="Generate random code"
            >
              ↻
            </button>
          </div>
        </label>
        <label className="block">
          <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Password</span>
          <div className="mt-1 flex">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value.slice(0, 32))}
              className="flex-1 px-3 py-2 bg-kaya-cream border border-kaya-warm-dark rounded-l-kaya focus:outline-none focus:border-kaya-chocolate font-mono"
            />
            <button
              type="button"
              onClick={() => setPassword(generatePassword(6))}
              className="px-3 bg-kaya-cream border border-l-0 border-kaya-warm-dark rounded-r-kaya text-xs"
              title="Generate new password"
            >
              ↻
            </button>
          </div>
        </label>
      </div>

      {/* Preset */}
      <div className="mb-3">
        <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand mb-2">Role</p>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`p-2 text-xs border rounded-kaya text-left ${preset === p.id
                ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                : 'bg-kaya-cream border-kaya-warm-dark hover:border-kaya-chocolate'
              }`}
            >
              <p className="font-bold">{p.label}</p>
              <p className={`text-[10px] mt-0.5 leading-tight ${preset === p.id ? 'text-white/80' : 'text-kaya-sand'}`}>
                {p.description}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Kids */}
      <div className="mb-4">
        <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand mb-2">Which kids?</p>
        {childOptions.length === 0 && (
          <p className="text-sm text-kaya-sand bg-kaya-cream rounded-kaya p-3">
            Add a kid first (Settings → Children) before creating a helper.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {childOptions.map((c) => {
            const on = selectedKidIds.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedKidIds((prev) =>
                  on ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                )}
                className={`px-3 py-1.5 text-sm rounded-full border ${on
                  ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                  : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                }`}
              >
                {on ? '✓ ' : ''}{c.name}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-kaya text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        disabled={busy || !name.trim() || !helperCode.trim() || !password.trim() || selectedKidIds.length === 0 || existingHelperCodes.includes(helperCode.toUpperCase()) || childOptions.length === 0}
        onClick={async () => {
          setError(null);
          setBusy(true);
          try {
            const r = await createHelper({
              familyId,
              familyCode,
              helperCode,
              displayName: name.trim(),
              password,
              preset,
              kidIds: selectedKidIds,
              modules: presetCfg.modules.filter((m) => familyModules.includes(m) || m === 'home'),
              canAward: presetCfg.canAward,
              createdBy: parentUid,
            });
            setResult(r);
          } catch (e: any) {
            setError(e?.message || 'Could not create helper. Try again.');
          } finally {
            setBusy(false);
          }
        }}
        className="w-full px-4 py-3 bg-kaya-chocolate text-white rounded-kaya font-bold hover:bg-kaya-chocolate/90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
      >
        {busy ? 'Creating…' : <><KeyRound size={16} /> Create helper + show login codes</>}
      </button>
      {existingHelperCodes.includes(helperCode.toUpperCase()) && (
        <p className="text-xs text-red-600 mt-2">That helper code already exists in this family — pick a different one.</p>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────
function CredRow({ label, value, id, copy, copied, mono }: {
  label: string; value: string; id: string;
  copy: (v: string, id: string) => void; copied: boolean; mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 bg-white border border-kaya-warm-dark rounded-kaya px-3 py-2">
      <span className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold w-20 flex-shrink-0">{label}</span>
      <span className={`flex-1 ${mono ? 'font-mono' : ''} text-sm font-bold`}>{value}</span>
      <button
        onClick={() => copy(value, id)}
        className="text-kaya-sand hover:text-kaya-chocolate"
        aria-label={`Copy ${label}`}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

function HelperRow({ helper, childOptions, busy, onPauseToggle, onRemove, onUpdateKids }: {
  helper: HelperLink;
  childOptions: { id: string; name: string }[];
  busy: boolean;
  onPauseToggle: () => void;
  onRemove: () => void;
  onUpdateKids: (kidIds: string[]) => Promise<void>;
}) {
  const childNameById = Object.fromEntries(childOptions.map((c) => [c.id, c.name]));
  const kidNames =
    helper.kidIds.map((id) => childNameById[id]).filter(Boolean).join(', ') || 'No kids assigned';
  const [expanded, setExpanded] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const toggleKid = async (kidId: string) => {
    const has = helper.kidIds.includes(kidId);
    const next = has ? helper.kidIds.filter((id) => id !== kidId) : [...helper.kidIds, kidId];
    await onUpdateKids(next);
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 1200);
  };

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg overflow-hidden">
      <div className="p-4 flex items-start justify-between gap-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 text-left"
          aria-expanded={expanded}
        >
          <p className="font-display font-bold text-base truncate">
            {helper.displayName}
            {helper.status === 'paused' && (
              <span className="ml-2 text-[10px] uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full font-bold align-middle">
                Paused
              </span>
            )}
          </p>
          <p className="text-xs text-kaya-sand mt-0.5 truncate">
            <span className="font-bold uppercase">{helper.helperCode}</span> · {helper.preset} · {kidNames}
          </p>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            disabled={busy}
            onClick={onPauseToggle}
            className="p-2 text-kaya-sand hover:text-kaya-chocolate disabled:opacity-50"
            title={helper.status === 'paused' ? 'Resume' : 'Pause'}
          >
            {helper.status === 'paused' ? <Play size={16} /> : <Pause size={16} />}
          </button>
          <button
            disabled={busy}
            onClick={onRemove}
            className="p-2 text-kaya-sand hover:text-red-600 disabled:opacity-50"
            title="Remove"
          >
            <Trash2 size={16} />
          </button>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-2 text-kaya-sand hover:text-kaya-chocolate"
            title={expanded ? 'Collapse' : 'Edit access'}
            aria-expanded={expanded}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-kaya-warm-dark/40 bg-kaya-cream/50 p-4 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Kids this helper can act on</p>
              {justSaved && (
                <span className="text-[10px] uppercase tracking-wider text-green-700 font-bold inline-flex items-center gap-1">
                  <Check size={12} /> Saved
                </span>
              )}
            </div>
            {childOptions.length === 0 ? (
              <p className="text-xs text-kaya-sand italic">No kids in the family yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {childOptions.map((c) => {
                  const on = helper.kidIds.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      disabled={busy}
                      onClick={() => toggleKid(c.id)}
                      className={`px-3 py-1.5 text-sm rounded-full border disabled:opacity-50 ${on
                        ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                        : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                      }`}
                    >
                      {on ? '✓ ' : ''}{c.name}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] text-kaya-sand mt-2">
              Toggle saves instantly. Removing all kids leaves the helper able to sign in but with nothing to do.
            </p>
          </div>

          {/* Helper code (read-only) — handy reference when the parent
              needs to remind a helper what to type. */}
          <div className="text-[11px] text-kaya-sand pt-2 border-t border-kaya-warm-dark/30">
            Login code: <span className="font-mono font-bold text-kaya-chocolate">{helper.helperCode}</span>
            {' '}· Created via Tier {helper.authTier}
          </div>
        </div>
      )}
    </div>
  );
}
