'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { Copy, Check, UserPlus, Pause, Play, Trash2, ChevronLeft, KeyRound, ChevronDown, ChevronUp, Info, Clock, Eye, Pencil, ClipboardList, Plus } from 'lucide-react';
import {
  ensureFamilyCode,
  listHelpers,
  createHelper,
  updateHelperLink,
  removeHelper,
  generateShortCode,
  generatePassword,
  DEFAULT_HELPER_SESSION_DAYS,
  type CreateHelperResult,
} from '@/lib/helpers';
import { KID_MODULES, DEFAULT_KID_MODULES } from '@/lib/kidModules';
import { HELPER_MODULES } from '@/lib/helperModules';
import {
  listWorkplanItems, addWorkplanItem, updateWorkplanItem, deleteWorkplanItem,
  todayDayOfWeek, NANNY_STARTER_ITEMS,
} from '@/lib/workplan';
import {
  updateFamily,
  type HelperLink,
  type WorkplanItem,
  type WorkplanPeriod,
  type DayOfWeek,
} from '@/lib/firestore';

const SESSION_LENGTH_CHOICES: { days: number; label: string }[] = [
  { days: 7,   label: '7 days' },
  { days: 30,  label: '30 days' },
  { days: 90,  label: '90 days' },
  { days: 365, label: '1 year' },
];

type Preset = HelperLink['preset'];
type Frequency = NonNullable<HelperLink['expectedFrequency']>;

// Role presets the parent picks at Add Helper time. The actual
// module grants are derived by `buildModuleAccessFromPreset()` in
// lib/helpers.ts — these entries carry only the UI shape (label +
// description + default expected-frequency).
const PRESETS: { id: Preset; label: string; description: string; frequency: Frequency }[] = [
  { id: 'nanny',       label: 'Nanny',       description: 'Routines, meals, kudos, photos',     frequency: 'both' },
  { id: 'tutor',       label: 'Tutor',       description: 'Homework & study routines',          frequency: 'evening' },
  { id: 'driver',      label: 'Driver',      description: 'Pickup, dropoff, schedule',          frequency: 'flexible' },
  { id: 'grandparent', label: 'Grandparent', description: 'View-only across granted modules',   frequency: 'flexible' },
  { id: 'custom',      label: 'Custom',      description: 'Pick everything by hand',            frequency: 'both' },
];

const FREQUENCY_CHOICES: { id: Frequency; label: string; hint: string }[] = [
  { id: 'morning',  label: 'Morning only',     hint: 'Expected to log the morning rating each day' },
  { id: 'evening',  label: 'Evening only',     hint: 'Expected to log the evening rating each day' },
  { id: 'both',     label: 'Morning + Evening', hint: 'Expected to log both ratings each day' },
  { id: 'flexible', label: 'Flexible',         hint: 'No daily expectation — fills in when relevant' },
];

const FREQUENCY_LABEL: Record<Frequency, string> = {
  morning: 'Morning only',
  evening: 'Evening only',
  both: 'Morning + Evening',
  flexible: 'Flexible',
};

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
  // Compose the full login URL client-side so dev/staging/prod each
  // show their own origin. SSR returns '' for the placeholder render;
  // hydration replaces it on the client before any user can copy.
  const [loginUrl, setLoginUrl] = useState('');
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLoginUrl(`${window.location.origin}/h`);
    }
  }, []);

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

      {/* How it works — quick parent guidance so first-time use is
          obvious without leaving the page. Plain English, short. */}
      <div className="mt-4 bg-kaya-cream/70 border border-kaya-warm-dark/60 rounded-kaya p-4 text-xs text-kaya-chocolate leading-relaxed">
        <p className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-kaya-sand text-[10px] mb-2">
          <Info size={13} /> How this works
        </p>
        <ol className="list-decimal pl-4 space-y-1">
          <li>Tap <span className="font-bold">Add helper</span> below. Pick which kids they can act on; password is generated for you.</li>
          <li>The credentials card gives you a <span className="font-bold">login URL + 3 codes</span>. Tap <span className="font-bold">Copy all</span> and paste into WhatsApp / SMS to share with your helper.</li>
          <li>The helper opens the URL, types the 3 codes, and lands on a dashboard showing only the kids you assigned.</li>
          <li>They&apos;ll stay signed in for the session length below before needing to enter codes again.</li>
          <li>Tap a helper row to <span className="font-bold">edit</span> their name, kids, areas of access, or expected fill frequency. Need an instant lockout? Tap <span className="font-bold">Pause</span> on their row.</li>
        </ol>
      </div>

      {/* Family code + login URL card — both pieces a helper needs are
          here, big and copyable. The full URL is built from the current
          origin so dev/staging/prod always show the right value. */}
      <div className="mt-6 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 space-y-4">
        {/* Family code */}
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-kaya-sand">Your family code</p>
            <p className="font-display font-black text-3xl tracking-tight mt-1">{familyCode || '••••'}</p>
          </div>
          <button
            onClick={() => familyCode && copy(familyCode, 'familyCode')}
            disabled={!familyCode}
            className="px-3 py-2 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya hover:bg-white inline-flex items-center gap-2 disabled:opacity-50"
          >
            {copiedField === 'familyCode' ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy</>}
          </button>
        </div>

        {/* Login URL */}
        <div className="pt-4 border-t border-kaya-warm-dark/40 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-kaya-sand">Login URL for helpers</p>
            <p className="font-mono font-bold text-sm lg:text-base mt-1 truncate">{loginUrl}</p>
          </div>
          <button
            onClick={() => loginUrl && copy(loginUrl, 'loginUrl')}
            disabled={!loginUrl}
            className="px-3 py-2 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya hover:bg-white inline-flex items-center gap-2 disabled:opacity-50"
          >
            {copiedField === 'loginUrl' ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy link</>}
          </button>
        </div>

        <p className="text-xs text-kaya-sand">
          Helpers open the URL above, then enter the <span className="font-bold">family code</span> + their <span className="font-bold">helper code</span> + their <span className="font-bold">password</span> to sign in.
        </p>
      </div>

      {/* Session length card — family-wide cap on how long helpers
          stay signed in. Changing this takes effect on the next page
          load for currently-signed-in helpers. */}
      {family && (
        <div className="mt-4 bg-white border border-kaya-warm-dark rounded-kaya-lg p-5">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.14em] font-bold text-kaya-sand inline-flex items-center gap-1.5">
                <Clock size={12} /> Helper sign-in length
              </p>
              <p className="text-xs text-kaya-sand mt-1 leading-relaxed">
                How long a helper stays signed in before they need to enter their codes again. Shorter = safer if a helper loses their phone. Default <span className="font-bold">{DEFAULT_HELPER_SESSION_DAYS} days</span>.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {SESSION_LENGTH_CHOICES.map((choice) => {
              const current = family.helperSessionDays ?? DEFAULT_HELPER_SESSION_DAYS;
              const on = current === choice.days;
              return (
                <button
                  key={choice.days}
                  type="button"
                  onClick={async () => {
                    if (on) return;
                    try {
                      await updateFamily(family.id, { helperSessionDays: choice.days });
                      await refresh();
                    } catch (e) {
                      console.error('updateFamily(helperSessionDays) failed', e);
                    }
                  }}
                  className={`px-2 py-2 text-sm rounded-kaya border font-bold ${on
                    ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                    : 'bg-kaya-cream border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                  }`}
                >
                  {choice.label}
                </button>
              );
            })}
          </div>
        </div>
      )}

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
        {activeHelpers.map((h) => family && (
          <HelperRow
            key={h.uid}
            helper={h}
            familyId={family.id}
            childOptions={children.map((c) => ({ id: c.id, name: c.name }))}
            familyModules={family?.kidModules ?? DEFAULT_KID_MODULES}
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
            onUpdate={async (patch) => {
              if (!family) return;
              setBusyHelperUid(h.uid);
              try {
                await updateHelperLink(family.id, h.uid, patch);
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
          placeholder="e.g. Jane"
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
              placeholder="JANE"
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
              // modules=[] lets createHelper derive from preset
              // (presetDefaultKeys in lib/helpers.ts).
              modules: [],
              expectedFrequency: presetCfg.frequency,
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

function HelperRow({ helper, familyId, childOptions, familyModules, busy, onPauseToggle, onRemove, onUpdate }: {
  helper: HelperLink;
  familyId: string;
  childOptions: { id: string; name: string }[];
  familyModules: string[];
  busy: boolean;
  onPauseToggle: () => void;
  onRemove: () => void;
  onUpdate: (patch: Partial<HelperLink>) => Promise<void>;
}) {
  const childNameById = Object.fromEntries(childOptions.map((c) => [c.id, c.name]));
  const kidNames =
    helper.kidIds.map((id) => childNameById[id]).filter(Boolean).join(', ') || 'No kids assigned';
  const [expanded, setExpanded] = useState(false);
  const [nameDraft, setNameDraft] = useState(helper.displayName);
  useEffect(() => { setNameDraft(helper.displayName); }, [helper.displayName]);

  // Persistent save-state indicator at the top of the expanded panel.
  //   'idle'   → "All changes saved" with check (default after load)
  //   'saving' → "Saving…" while a write is in flight
  //   'saved'  → "Saved just now" for ~2s after a successful write,
  //              then back to 'idle'
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const flashSaved = () => {
    setSaveState('saved');
    setTimeout(() => setSaveState((s) => (s === 'saved' ? 'idle' : s)), 2000);
  };

  // Wrap onUpdate to drive the save-state indicator. Every auto-save
  // (kid toggle, module toggle, frequency click, name blur) routes
  // through this so the parent always sees current save status.
  const save = async (patch: Partial<HelperLink>) => {
    setSaveState('saving');
    try {
      await onUpdate(patch);
      flashSaved();
    } catch {
      // Surface as 'saved' won't be accurate; revert to idle and let
      // the standard error path handle it. Future: add a 'failed'
      // state with a retry CTA.
      setSaveState('idle');
    }
  };

  const toggleKid = async (kidId: string) => {
    const has = helper.kidIds.includes(kidId);
    const next = has ? helper.kidIds.filter((id) => id !== kidId) : [...helper.kidIds, kidId];
    await save({ kidIds: next });
  };

  // Resolve the current per-module {view, act} state. Prefer
  // moduleAccess (canonical); fall back to legacy `modules` array
  // treated as view+act.
  const moduleAccessNow: Record<string, { view: boolean; act: boolean }> = {};
  if (helper.moduleAccess) {
    Object.assign(moduleAccessNow, helper.moduleAccess);
  } else {
    for (const id of helper.modules) moduleAccessNow[id] = { view: true, act: true };
  }

  // Toggle one tier (view or act) for one module. Enforces the
  // invariant act ⊆ view: turning view off also turns act off;
  // turning act on also turns view on. Keeps `modules` (legacy
  // array) in sync — entries with act:true count as legacy-granted.
  const toggleModuleTier = async (moduleId: string, tier: 'view' | 'act') => {
    const current = moduleAccessNow[moduleId] ?? { view: false, act: false };
    let next = { ...current };
    if (tier === 'view') {
      next.view = !current.view;
      if (!next.view) next.act = false;
    } else {
      next.act = !current.act;
      if (next.act) next.view = true;
    }
    const nextMap: Record<string, { view: boolean; act: boolean }> = { ...moduleAccessNow };
    if (next.view || next.act) nextMap[moduleId] = next;
    else delete nextMap[moduleId];
    // Legacy `modules` array tracks the act-granted set so older
    // readers (and any rule still using the array fallback) see the
    // intended scope.
    const legacyArr = Object.entries(nextMap)
      .filter(([, f]) => f.act)
      .map(([id]) => id);
    await save({ moduleAccess: nextMap, modules: legacyArr });
  };

  const setFrequency = async (f: Frequency) => {
    if (helper.expectedFrequency === f) return;
    await save({ expectedFrequency: f });
  };

  const saveName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === helper.displayName) return;
    await save({ displayName: trimmed });
  };

  // Helper-side module list — Kaya + Household have nested sub-pages
  // each toggleable on its own. Modules in this list use the
  // helper-vocabulary (HELPER_MODULES), not the kid sidebar (which
  // had "Home" etc. that don't apply to helpers).
  const moduleOptions = HELPER_MODULES.map((m) => ({
    ...m,
    // helperOnly modules (Kaya, Profiles) ignore family.kidModules
    // since they have no kid-side toggle. Other modules check the
    // family-enabled set so a disabled parent module shows grayed.
    enabledByFamily: m.helperOnly || familyModules.includes(m.id),
  }));

  // Bulk-toggle ALL sub keys of a parent module to the same state.
  // Used when the parent card View/Act is clicked on a module that
  // has sub-modules — convenience for "grant everything in this
  // module" with one tap. Writes individual sub keys (no parent key
  // stored when subs exist).
  const togglePresetSubs = async (parent: typeof HELPER_MODULES[number], tier: 'view' | 'act', enable: boolean) => {
    if (!parent.subModules) return;
    const nextMap: Record<string, { view: boolean; act: boolean }> = { ...moduleAccessNow };
    for (const sub of parent.subModules) {
      const key = `${parent.id}:${sub.id}`;
      const current = nextMap[key] ?? { view: false, act: false };
      const next = { ...current };
      if (tier === 'view') {
        next.view = enable;
        if (!enable) next.act = false;
      } else {
        next.act = enable;
        if (enable) next.view = true;
      }
      if (next.view || next.act) nextMap[key] = next;
      else delete nextMap[key];
    }
    const legacyArr = Object.entries(nextMap)
      .filter(([, f]) => f.act)
      .map(([k]) => k);
    await save({ moduleAccess: nextMap, modules: legacyArr });
  };

  // Aggregate state for a parent card: derived from its sub-grants
  // when subs exist, or its own key otherwise. `none/some/all` for
  // each tier — used to render parent View/Act in indeterminate
  // visual states.
  const parentAggregate = (parent: typeof HELPER_MODULES[number]): {
    view: 'none' | 'some' | 'all'; act: 'none' | 'some' | 'all';
  } => {
    if (!parent.subModules) {
      const a = moduleAccessNow[parent.id] ?? { view: false, act: false };
      return {
        view: a.view ? 'all' : 'none',
        act:  a.act  ? 'all' : 'none',
      };
    }
    const total = parent.subModules.length;
    let v = 0, c = 0;
    for (const sub of parent.subModules) {
      const a = moduleAccessNow[`${parent.id}:${sub.id}`];
      if (a?.view) v++;
      if (a?.act) c++;
    }
    return {
      view: v === 0 ? 'none' : v === total ? 'all' : 'some',
      act:  c === 0 ? 'none' : c === total ? 'all' : 'some',
    };
  };

  const currentFrequency: Frequency = helper.expectedFrequency ?? 'flexible';

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
            <span className="font-bold uppercase">{helper.helperCode}</span> · {helper.preset} · {kidNames} · {FREQUENCY_LABEL[currentFrequency]}
          </p>
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            disabled={busy}
            onClick={onPauseToggle}
            className="p-2 text-kaya-sand hover:text-kaya-chocolate disabled:opacity-50"
            title={helper.status === 'paused' ? 'Resume' : 'Pause (instant lockout — use if you suspect a problem)'}
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
        <div className="border-t border-kaya-warm-dark/40 bg-kaya-cream/50 p-4 space-y-4">
          {/* Persistent save status — high-contrast pill so the parent
              can't miss it. Color flips per state:
                idle   → green (everything is saved)
                saving → amber pulsing
                saved  → green (same as idle but with explicit confirmation)
              Sits at the top of the panel + visible at all times. */}
          <div
            className={`rounded-kaya px-3 py-2 text-xs font-bold inline-flex items-center gap-2 border-2 ${
              saveState === 'saving'
                ? 'bg-amber-50 border-amber-300 text-amber-900'
                : 'bg-green-50 border-green-300 text-green-800'
            }`}
            role="status"
            aria-live="polite"
          >
            {saveState === 'saving' && (
              <>
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
                Saving your changes…
              </>
            )}
            {saveState === 'saved' && (
              <>
                <Check size={14} />
                Saved just now · safe to go back
              </>
            )}
            {saveState === 'idle' && (
              <>
                <Check size={14} />
                All changes saved · safe to go back
              </>
            )}
          </div>

          {/* Display name — auto-saves on blur. No explicit Save button
              (it was a disabled gray nub that visually contradicted the
              "everything auto-saves" status pill above). Tab-out or
              click-away writes the new name immediately. */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand mb-2">Display name</p>
            <input
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => { void saveName(); }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              disabled={busy}
              className="w-full px-3 py-2 bg-white border border-kaya-warm-dark rounded-kaya text-sm focus:outline-none focus:border-kaya-chocolate disabled:opacity-50"
            />
            <p className="text-[10px] text-kaya-sand mt-1">Saves automatically when you click out of the field.</p>
          </div>

          {/* Kids */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand mb-2">Kids this helper can act on</p>
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
          </div>

          {/* Areas — stacked-card "role editor" matching the kid-side
              "What kids see" pattern. Each card carries two checkboxes:
              View (read access) and Act (write access). Invariant:
              act implies view. Cards rule-enforced through
              firestore.rules' helperCanViewModule / helperCanActOnModule. */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand mb-2">Areas this helper can access</p>
            <p className="text-[11px] text-kaya-sand mb-3 leading-relaxed">
              <span className="inline-flex items-center gap-1 mr-2"><Eye size={11} /> <span className="font-bold">View</span> = can see the data</span>
              <span className="inline-flex items-center gap-1"><Pencil size={11} /> <span className="font-bold">Act</span> = can add / edit / delete</span>
            </p>
            <div className="space-y-2">
              {moduleOptions.map((m) => {
                const agg = parentAggregate(m);
                const hasSubs = !!m.subModules && m.subModules.length > 0;
                // Parent card visual treatment by module lifecycle +
                // whether the helper has any grant inside this module.
                const anyGranted = agg.view !== 'none' || agg.act !== 'none';
                const borderClass =
                  m.tier === 'soon' ? 'border-kaya-gold/50 bg-kaya-gold-light/10' :
                  m.tier === 'legacy' ? 'border-kaya-warm-dark bg-kaya-cream/60' :
                  anyGranted ? 'border-kaya-gold bg-kaya-gold-light/20' :
                  'border-kaya-warm-dark bg-white';
                return (
                  <div key={m.id} className={`rounded-kaya border-2 ${borderClass} overflow-hidden`}>
                    {/* Parent row — View/Act here bulk-toggle all subs. */}
                    <div className="p-3 flex items-center gap-3">
                      <span className="text-2xl flex-shrink-0">{m.icon}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-sm truncate">
                          {m.label}
                          {m.tier === 'soon' && (
                            <span className="ml-2 text-[9px] uppercase tracking-wider bg-kaya-gold-light/40 text-kaya-chocolate px-1.5 py-0.5 rounded-full font-bold align-middle">Soon</span>
                          )}
                          {m.tier === 'legacy' && (
                            <span className="ml-2 text-[9px] uppercase tracking-wider bg-kaya-sand/30 text-kaya-sand px-1.5 py-0.5 rounded-full font-bold align-middle">Legacy</span>
                          )}
                          {!m.enabledByFamily && (
                            <span className="ml-2 text-[9px] uppercase tracking-wider text-kaya-sand/70 font-bold align-middle">family disabled</span>
                          )}
                          {hasSubs && agg.view === 'some' && (
                            <span className="ml-2 text-[9px] uppercase tracking-wider text-kaya-sand/80 font-bold align-middle">partial</span>
                          )}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <ParentTierToggle
                          tier="view"
                          state={agg.view}
                          busy={busy}
                          onToggle={() => hasSubs
                            ? togglePresetSubs(m, 'view', agg.view !== 'all')
                            : toggleModuleTier(m.id, 'view')}
                        />
                        <ParentTierToggle
                          tier="act"
                          state={agg.act}
                          busy={busy}
                          onToggle={() => hasSubs
                            ? togglePresetSubs(m, 'act', agg.act !== 'all')
                            : toggleModuleTier(m.id, 'act')}
                        />
                      </div>
                    </div>

                    {/* Sub-rows — indented; each has its own View/Act
                        toggles. Only render when the parent has subs. */}
                    {hasSubs && (
                      <div className="border-t border-kaya-warm-dark/30 bg-white/40 px-3 py-2 space-y-1.5">
                        {m.subModules!.map((sub) => {
                          const key = `${m.id}:${sub.id}`;
                          const a = moduleAccessNow[key] ?? { view: false, act: false };
                          return (
                            <div key={sub.id} className="flex items-center gap-2 pl-6">
                              <span className="text-lg flex-shrink-0">{sub.icon}</span>
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-bold truncate">{sub.label}</p>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <SubTierToggle
                                  tier="view"
                                  on={a.view}
                                  busy={busy}
                                  onToggle={() => toggleModuleTier(key, 'view')}
                                />
                                <SubTierToggle
                                  tier="act"
                                  on={a.act}
                                  busy={busy}
                                  onToggle={() => toggleModuleTier(key, 'act')}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-kaya-sand mt-2">
              Turning <span className="font-bold">Act</span> on auto-enables <span className="font-bold">View</span>. Turning View off auto-disables Act. Grandparents default to View-only across everything.
            </p>
          </div>

          {/* Workplan — recurring tasks per day. Inline so it lives
              alongside access settings; collapses by default to avoid
              overwhelming the panel. */}
          <WorkplanEditor
            familyId={familyId}
            helperUid={helper.uid}
            helperName={helper.displayName}
            presetHint={helper.preset}
          />


          {/* Frequency expectation */}
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand mb-2">Expected fill frequency</p>
            <div className="grid grid-cols-2 gap-2">
              {FREQUENCY_CHOICES.map((f) => {
                const on = currentFrequency === f.id;
                return (
                  <button
                    key={f.id}
                    type="button"
                    disabled={busy}
                    onClick={() => setFrequency(f.id)}
                    className={`p-2 text-xs rounded-kaya border text-left disabled:opacity-50 ${on
                      ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                      : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                    }`}
                  >
                    <p className="font-bold">{f.label}</p>
                    <p className={`text-[10px] mt-0.5 leading-tight ${on ? 'text-white/80' : 'text-kaya-sand'}`}>
                      {f.hint}
                    </p>
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-kaya-sand mt-2">
              The helper sees this on their dashboard. Performance % will use this in a future build.
            </p>
          </div>

          {/* Login code + tier footer */}
          <div className="text-[11px] text-kaya-sand pt-2 border-t border-kaya-warm-dark/30">
            Login code: <span className="font-mono font-bold text-kaya-chocolate">{helper.helperCode}</span>
            {' '}· Created via Tier {helper.authTier}
            <span className="block mt-1 text-[10px]">
              To rotate password or change the helper code, <button className="underline" onClick={onRemove}>remove</button> this helper and add them again. Suspect compromise? Use <span className="font-bold">Pause</span> for instant lockout.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tier toggles ───────────────────────────────────
// Parent-card View/Act with tri-state ('none' | 'some' | 'all').
// "some" visually = partially-on (cream border with chocolate text).
function ParentTierToggle({ tier, state, busy, onToggle }: {
  tier: 'view' | 'act';
  state: 'none' | 'some' | 'all';
  busy: boolean;
  onToggle: () => void;
}) {
  const Icon = tier === 'view' ? Eye : Pencil;
  const label = tier === 'view' ? 'View' : 'Act';
  const className =
    state === 'all'  ? 'bg-kaya-chocolate text-white border-kaya-chocolate' :
    state === 'some' ? 'bg-kaya-gold-light/30 text-kaya-chocolate border-kaya-gold' :
                       'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-kaya border font-bold ${className} ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
      aria-pressed={state === 'all'}
    >
      <Icon size={12} />
      {label}
      {state === 'some' && <span className="text-[9px] ml-1">·</span>}
    </button>
  );
}

// Sub-row View/Act — binary (on/off), smaller chips.
function SubTierToggle({ tier, on, busy, onToggle }: {
  tier: 'view' | 'act';
  on: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const Icon = tier === 'view' ? Eye : Pencil;
  const label = tier === 'view' ? 'View' : 'Act';
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded-kaya border ${on
        ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
        : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
      } ${busy ? 'opacity-50 cursor-not-allowed' : ''}`}
      aria-pressed={on}
    >
      <Icon size={10} />
      <span className="font-bold">{label}</span>
    </button>
  );
}

// ── Workplan editor ────────────────────────────────
// Parent-facing workplan setup for one helper. Loads items from the
// helper's `workplanItems` subcollection; auto-saves on every edit.
// Sits inside the HelperRow expanded panel — collapsed by default
// so the panel doesn't blow up.
function WorkplanEditor({ familyId, helperUid, helperName, presetHint }: {
  familyId: string;
  helperUid: string;
  helperName: string;
  presetHint: HelperLink['preset'];
}) {
  const { profile } = useAuth();
  const [items, setItems] = useState<WorkplanItem[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const flash = () => { setSavedFlash(true); setTimeout(() => setSavedFlash(false), 1500); };

  const reload = useCallback(async () => {
    const list = await listWorkplanItems(familyId, helperUid);
    setItems(list);
  }, [familyId, helperUid]);
  useEffect(() => { reload(); }, [reload]);

  const grouped: Record<WorkplanPeriod, WorkplanItem[]> = {
    morning: [],
    anytime: [],
    evening: [],
  };
  for (const i of items ?? []) grouped[i.period].push(i);

  const todaysCount = (items ?? []).filter((i) => i.active && i.daysOfWeek.includes(todayDayOfWeek())).length;
  const totalActive = (items ?? []).filter((i) => i.active).length;

  // Seed a starter pack of items the first time a Nanny-preset
  // helper's workplan is opened with nothing in it. Other presets
  // start blank (parent defines from scratch).
  const seedStarter = async () => {
    if (!profile?.uid) return;
    setBusy(true);
    try {
      for (const item of NANNY_STARTER_ITEMS) {
        await addWorkplanItem(familyId, helperUid, { ...item, createdBy: profile.uid });
      }
      await reload();
      flash();
    } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full px-3 py-2.5 flex items-center justify-between gap-3 text-left hover:bg-kaya-cream/40"
        aria-expanded={open}
      >
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand inline-flex items-center gap-1.5">
            <ClipboardList size={12} /> Workplan
          </p>
          <p className="text-[11px] text-kaya-sand mt-0.5 truncate">
            {items === null ? 'Loading…' :
             totalActive === 0 ? 'No tasks yet — tap to set up' :
             `${todaysCount} today · ${totalActive} total`}
          </p>
        </div>
        {open ? <ChevronUp size={16} className="text-kaya-sand flex-shrink-0" /> : <ChevronDown size={16} className="text-kaya-sand flex-shrink-0" />}
      </button>

      {open && (
        <div className="border-t border-kaya-warm-dark/40 p-3 space-y-3 bg-kaya-cream/30">
          {savedFlash && (
            <div className="text-[10px] uppercase tracking-wider text-green-700 font-bold inline-flex items-center gap-1">
              <Check size={12} /> Saved
            </div>
          )}

          {items !== null && items.length === 0 && presetHint === 'nanny' && (
            <button
              type="button"
              onClick={seedStarter}
              disabled={busy}
              className="w-full px-3 py-2.5 text-xs bg-kaya-gold-light/30 border-2 border-dashed border-kaya-gold rounded-kaya hover:bg-kaya-gold-light/50 font-bold disabled:opacity-50"
            >
              ✨ Start with a Nanny starter pack (8 typical tasks)
            </button>
          )}
          {items !== null && items.length === 0 && presetHint !== 'nanny' && (
            <p className="text-[11px] text-kaya-sand italic">No tasks yet. Use <span className="font-bold">Add task</span> to give {helperName} their daily responsibilities.</p>
          )}

          {/* Items grouped by period */}
          {(['morning', 'anytime', 'evening'] as WorkplanPeriod[]).map((period) => (
            grouped[period].length > 0 && (
              <div key={period}>
                <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">
                  {period === 'morning' ? '☀️ Morning' : period === 'evening' ? '🌙 Evening' : '⏱️ Anytime'}
                </p>
                <div className="space-y-1.5">
                  {grouped[period].map((item) => (
                    <WorkplanItemRow
                      key={item.id}
                      item={item}
                      busy={busy}
                      onUpdate={async (patch) => {
                        setBusy(true);
                        try { await updateWorkplanItem(familyId, helperUid, item.id, patch); await reload(); flash(); }
                        finally { setBusy(false); }
                      }}
                      onDelete={async () => {
                        if (!confirm(`Remove "${item.label}" from this helper's workplan?`)) return;
                        setBusy(true);
                        try { await deleteWorkplanItem(familyId, helperUid, item.id); await reload(); flash(); }
                        finally { setBusy(false); }
                      }}
                    />
                  ))}
                </div>
              </div>
            )
          ))}

          {/* Add task */}
          {!showAdd ? (
            <button
              type="button"
              onClick={() => setShowAdd(true)}
              className="w-full px-3 py-2 text-xs font-bold bg-kaya-chocolate text-white rounded-kaya hover:bg-kaya-chocolate/90 inline-flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Add task
            </button>
          ) : (
            <AddWorkplanItemForm
              onCancel={() => setShowAdd(false)}
              onAdd={async (input) => {
                if (!profile?.uid) return;
                setBusy(true);
                try {
                  await addWorkplanItem(familyId, helperUid, { ...input, createdBy: profile.uid });
                  await reload();
                  flash();
                  setShowAdd(false);
                } finally { setBusy(false); }
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ── Workplan item row (existing) ───────────────────
function WorkplanItemRow({ item, busy, onUpdate, onDelete }: {
  item: WorkplanItem;
  busy: boolean;
  onUpdate: (patch: Partial<WorkplanItem>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={`bg-white border border-kaya-warm-dark rounded-kaya ${item.active ? '' : 'opacity-50'}`}>
      <div className="px-2.5 py-2 flex items-center gap-2">
        <span className="text-xl flex-shrink-0">{item.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold truncate">{item.label}</p>
          <div className="mt-0.5 flex items-center gap-1 flex-wrap">
            {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[]).map((d) => {
              const on = item.daysOfWeek.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    const next = on ? item.daysOfWeek.filter((x) => x !== d) : [...item.daysOfWeek, d];
                    await onUpdate({ daysOfWeek: next });
                  }}
                  className={`text-[9px] uppercase tracking-wider font-bold px-1 py-0.5 rounded ${on
                    ? 'bg-kaya-chocolate text-white'
                    : 'bg-kaya-cream text-kaya-sand hover:bg-white border border-kaya-warm-dark'
                  } disabled:opacity-50`}
                >
                  {d.slice(0, 1).toUpperCase()}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            disabled={busy}
            onClick={() => onUpdate({ active: !item.active })}
            className="p-1.5 text-kaya-sand hover:text-kaya-chocolate disabled:opacity-50"
            title={item.active ? 'Pause this task' : 'Resume'}
          >
            {item.active ? <Pause size={12} /> : <Play size={12} />}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="p-1.5 text-kaya-sand hover:text-red-600 disabled:opacity-50"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add workplan item form ─────────────────────────
function AddWorkplanItemForm({ onCancel, onAdd }: {
  onCancel: () => void;
  onAdd: (input: Omit<WorkplanItem, 'id' | 'createdAt' | 'createdBy'>) => Promise<void>;
}) {
  const [label, setLabel] = useState('');
  const [icon, setIcon] = useState('✅');
  const [days, setDays] = useState<DayOfWeek[]>(['mon', 'tue', 'wed', 'thu', 'fri']);
  const [period, setPeriod] = useState<WorkplanPeriod>('anytime');
  const [busy, setBusy] = useState(false);

  const toggleDay = (d: DayOfWeek) =>
    setDays((prev) => prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]);

  return (
    <div className="bg-white border-2 border-kaya-gold rounded-kaya p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={icon}
          onChange={(e) => setIcon(e.target.value.slice(0, 2))}
          className="w-12 text-center text-xl px-1 py-1.5 bg-kaya-cream border border-kaya-warm-dark rounded-kaya"
          placeholder="🛏️"
          aria-label="Emoji"
        />
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Task name (e.g. Make beds)"
          className="flex-1 px-2 py-1.5 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate"
          autoFocus
        />
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1">Days</p>
        <div className="flex items-center gap-1">
          {(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as DayOfWeek[]).map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                onClick={() => toggleDay(d)}
                className={`text-[10px] uppercase tracking-wider font-bold px-2 py-1 rounded ${on
                  ? 'bg-kaya-chocolate text-white'
                  : 'bg-kaya-cream text-kaya-sand hover:bg-white border border-kaya-warm-dark'
                }`}
              >
                {d.slice(0, 1).toUpperCase()}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1">When</p>
        <div className="grid grid-cols-3 gap-1">
          {(['morning', 'anytime', 'evening'] as WorkplanPeriod[]).map((p) => {
            const on = p === period;
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`text-xs py-1.5 rounded-kaya border ${on
                  ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                  : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                }`}
              >
                {p === 'morning' ? '☀️ Morning' : p === 'evening' ? '🌙 Evening' : '⏱️ Anytime'}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-kaya-sand hover:text-kaya-chocolate"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || !label.trim() || days.length === 0}
          onClick={async () => {
            setBusy(true);
            try {
              await onAdd({ label: label.trim(), icon, daysOfWeek: days, period, active: true });
            } finally { setBusy(false); }
          }}
          className="flex-1 px-3 py-1.5 text-xs font-bold bg-kaya-chocolate text-white rounded-kaya hover:bg-kaya-chocolate/90 disabled:opacity-50"
        >
          Add task
        </button>
      </div>
    </div>
  );
}
