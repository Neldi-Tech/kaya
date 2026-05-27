'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { Copy, Check, UserPlus, Pause, Play, Trash2, ChevronLeft, KeyRound, ChevronDown, ChevronUp, Info, Clock, Eye, Pencil } from 'lucide-react';
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
import WorkplanEditor from '@/components/helpers/WorkplanEditor';
import { setPayrollConfig, clearPayrollConfig, payAnchorLabel } from '@/lib/payroll';
import type { HelperPayrollConfig, PayBasis, PayFrequency, PayrollAllowance } from '@/lib/firestore';
import { useHive } from '@/contexts/HiveContext';
import { formatCents } from '@/components/pantry/format';
import { updateFamily, type HelperLink } from '@/lib/firestore';

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
// Order: kid-facing presets first, then household / grounds helpers, then
// custom. 2026-05-27: added Security + Cleaner + Cook + Handyman so common
// non-kid roles have a one-tap setup instead of forcing Custom.
const PRESETS: { id: Preset; label: string; description: string; frequency: Frequency }[] = [
  { id: 'nanny',       label: 'Nanny',       description: 'Routines, meals, kudos, photos',     frequency: 'both' },
  { id: 'tutor',       label: 'Tutor',       description: 'Homework & study routines',          frequency: 'evening' },
  { id: 'grandparent', label: 'Grandparent', description: 'View-only across granted modules',   frequency: 'flexible' },
  { id: 'driver',      label: 'Driver',      description: 'Pickup, dropoff, fuel, service',     frequency: 'flexible' },
  { id: 'gardener',    label: 'Gardener',    description: 'Outdoor + grounds tasks',            frequency: 'flexible' },
  { id: 'security',    label: 'Security',    description: 'Gate, perimeter, visitor log',       frequency: 'flexible' },
  { id: 'cleaner',     label: 'Cleaner',     description: 'Housekeeping + cleaning supplies',   frequency: 'flexible' },
  { id: 'cook',        label: 'Cook',        description: 'Kitchen — meals, list, staples',     frequency: 'flexible' },
  { id: 'handyman',    label: 'Handyman',    description: 'Repairs, utilities, parts',          frequency: 'flexible' },
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
  const confirmAction = useConfirm();

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
              const ok = await confirmAction({
                title: `Remove ${h.displayName}?`,
                message: 'Their login will stop working immediately. Past entries are kept.',
                confirmLabel: 'Remove',
                tone: 'danger',
              });
              if (!ok) return;
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
  // Kid-relevant presets (nanny / tutor / grandparent) default to all kids
  // selected. Driver / gardener / custom / security helpers don't need kid
  // access, so they default to none — Elia's ask 2026-05-27. The parent can
  // override either direction with the chips below. Switching preset
  // resets the picks to the new default (clear intent over preservation).
  const isKidRelevantPreset = (p: Preset) => p === 'nanny' || p === 'tutor' || p === 'grandparent';
  const [selectedKidIds, setSelectedKidIds] = useState<string[]>(
    isKidRelevantPreset('nanny') ? childOptions.map((c) => c.id) : []
  );
  useEffect(() => {
    setSelectedKidIds(isKidRelevantPreset(preset) ? childOptions.map((c) => c.id) : []);
    // childOptions intentionally omitted — we only react to preset switches;
    // the family roster is read once at mount via useFamily.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset]);
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

      {/* Kids — optional. Some helpers (driver / gardener / security / custom)
          have nothing to do with kids; only nanny / tutor / grandparent are
          kid-facing. Empty selection is now allowed at submit. */}
      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-2 gap-3 flex-wrap">
          <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand">
            Which kids? <span className="text-kaya-sand/70 normal-case font-semibold">— optional</span>
          </p>
          {childOptions.length > 0 && (
            <div className="flex items-center gap-3 text-[11px] font-bold">
              <button type="button" onClick={() => setSelectedKidIds(childOptions.map((c) => c.id))}
                className="text-kaya-chocolate hover:underline">Select all</button>
              <button type="button" onClick={() => setSelectedKidIds([])}
                className="text-kaya-sand hover:text-kaya-chocolate hover:underline">Clear</button>
            </div>
          )}
        </div>
        {childOptions.length === 0 ? (
          <p className="text-sm text-kaya-sand bg-kaya-cream rounded-kaya p-3">
            No kids in the family yet — that&apos;s fine for a driver / gardener / security helper. You can add kids later from Settings → Children.
          </p>
        ) : (
          <>
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
            {selectedKidIds.length === 0 && (
              <p className="text-[11px] text-kaya-sand mt-2">
                No kids picked — fine for helpers who don&apos;t work with kids (driver, gardener, security).
              </p>
            )}
          </>
        )}
      </div>

      {error && (
        <div className="mb-3 p-3 bg-red-50 border border-red-200 rounded-kaya text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        // Kids are no longer required — driver / gardener / security helpers
        // can ship with no kids attached. Only the truly required fields
        // (name, codes, password) gate the button now.
        disabled={busy || !name.trim() || !helperCode.trim() || !password.trim() || existingHelperCodes.includes(helperCode.toUpperCase())}
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
  // Which access-area accordions are open (modules with sub-items).
  // Collapsed by default so the access list reads as a calm summary —
  // the parent taps a chevron to reveal + allocate that area's subs.
  const [expandedAreas, setExpandedAreas] = useState<Set<string>>(new Set());
  // Master collapse for the whole "Areas this helper can access" block —
  // parity with the kids' "What kids see" global collapse. Collapsed by
  // default; the per-area chevrons inside still work once it's open.
  const [areasOpen, setAreasOpen] = useState(false);
  const toggleAreaExpand = (id: string) =>
    setExpandedAreas((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
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
            <button
              type="button"
              onClick={() => setAreasOpen((o) => !o)}
              aria-expanded={areasOpen}
              className="w-full flex items-center justify-between gap-2 text-left mb-2"
            >
              <span className="text-xs font-bold uppercase tracking-wider text-kaya-sand">Areas this helper can access</span>
              {/* Labelled Show/Hide pill — matches the shared
                  CollapsibleSection so the expand affordance is obvious. */}
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-kaya-gold-light border border-kaya-gold px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-kaya-chocolate">
                {areasOpen ? 'Hide' : 'Show'}
                <span className={`inline-block leading-none transition-transform ${areasOpen ? 'rotate-180' : ''}`}>⌄</span>
              </span>
            </button>
            {areasOpen && (
              <>
                <p className="text-[11px] text-kaya-sand mb-3 leading-relaxed">
                  <span className="inline-flex items-center gap-1 mr-2"><Eye size={11} /> <span className="font-bold">View</span> = can see the data</span>
                  <span className="inline-flex items-center gap-1"><Pencil size={11} /> <span className="font-bold">Act</span> = can add / edit / delete</span>
                </p>
            <div className="space-y-2">
              {moduleOptions.map((m) => {
                const agg = parentAggregate(m);
                const hasSubs = !!m.subModules && m.subModules.length > 0;
                const areaExpanded = expandedAreas.has(m.id);
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
                      {hasSubs && (
                        <button
                          type="button"
                          onClick={() => toggleAreaExpand(m.id)}
                          aria-expanded={areaExpanded}
                          aria-label={`${areaExpanded ? 'Collapse' : 'Expand'} ${m.label} sub-pages`}
                          className="flex-shrink-0 w-7 h-7 -mr-1 flex items-center justify-center rounded-md text-kaya-sand hover:bg-kaya-warm/60"
                        >
                          {areaExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      )}
                    </div>

                    {/* Sub-rows — indented; each has its own View/Act
                        toggles. Only render when the parent has subs. */}
                    {hasSubs && areaExpanded && (
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
              </>
            )}
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

          {/* Payroll automation (2026-05-19). Optional per-helper
              salary setup — when filled, the system auto-creates a
              pending salary request on each pay date. */}
          <PayrollConfigSection
            familyId={familyId}
            helperUid={helper.uid}
            helper={helper}
          />

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

// ── Payroll configuration section (v1 — 2026-05-19) ──────────────
//
// Collapsible block inside each expanded helper row. Lets a parent
// set the helper's basis (hourly/daily/monthly) + rate + cadence +
// allowances + the pay-day anchor. On save the system starts
// auto-generating pending salary requests on each pay date.

const BASIS_LABELS: Record<PayBasis, { label: string; sub: string }> = {
  monthly: { label: 'Monthly (fixed)',   sub: 'Same amount every cycle — no check-ins needed' },
  daily:   { label: 'Per day worked',    sub: 'Helper logs each day → parent approves → counted' },
  hourly:  { label: 'Per hour',          sub: 'Helper logs hours each day → parent approves → counted' },
};

const FREQ_LABELS: Record<PayFrequency, string> = {
  weekly:   'Weekly',
  biweekly: 'Every 2 weeks',
  monthly:  'Monthly',
};

const DOW_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function PayrollConfigSection({
  familyId, helperUid, helper,
}: { familyId: string; helperUid: string; helper: HelperLink }) {
  const { config: hiveConfig } = useHive();
  const currency = hiveConfig.currency;
  const confirmAction = useConfirm();
  const existing = helper.payrollConfig;
  const [expanded, setExpanded] = useState(!!existing);

  // Form state — pre-fill from existing or sensible defaults.
  const [basis, setBasis] = useState<PayBasis>(existing?.basis ?? 'monthly');
  const [rateMajor, setRateMajor] = useState<number>(existing ? existing.rateCents / 100 : 0);
  const [frequency, setFrequency] = useState<PayFrequency>(existing?.frequency ?? 'monthly');
  const [payAnchor, setPayAnchor] = useState<number>(existing?.payAnchor ?? (existing?.frequency === 'monthly' ? 1 : 5)); // 5=Friday default for weekly
  const [startDate, setStartDate] = useState<string>(existing?.startDate ?? new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>(existing?.endDate ?? '');
  const [allowances, setAllowances] = useState<PayrollAllowance[]>(existing?.allowances ?? []);
  const [allowanceLabel, setAllowanceLabel] = useState('');
  const [allowanceAmt, setAllowanceAmt] = useState<number>(0);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset payAnchor sanely when frequency switches (different domains).
  useEffect(() => {
    if (frequency === 'monthly') {
      if (payAnchor < 1 || payAnchor > 28) setPayAnchor(1);
    } else {
      if (payAnchor < 0 || payAnchor > 6) setPayAnchor(5);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency]);

  const save = async () => {
    setError(null);
    if (rateMajor <= 0) { setError('Rate must be greater than zero.'); return; }
    if (!startDate) { setError('Pick a start date.'); return; }
    setSaving(true);
    try {
      const patch: Partial<HelperPayrollConfig> = {
        basis,
        rateCents: Math.round(rateMajor * 100),
        frequency,
        payAnchor,
        startDate,
        endDate: endDate || undefined,
        allowances: allowances.length > 0 ? allowances : undefined,
      };
      await setPayrollConfig(familyId, helperUid, patch);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally { setSaving(false); }
  };

  const remove = async () => {
    const ok = await confirmAction({
      title: 'Turn off auto-payroll?',
      message: 'Saved config is removed. Existing pending salary requests stay; new ones stop being generated.',
      confirmLabel: 'Turn off',
      tone: 'danger',
    });
    if (!ok) return;
    setSaving(true);
    try { await clearPayrollConfig(familyId, helperUid); }
    finally { setSaving(false); }
  };

  const addAllowance = () => {
    const label = allowanceLabel.trim();
    if (!label || allowanceAmt <= 0) return;
    setAllowances((arr) => [...arr, { label, amountCents: Math.round(allowanceAmt * 100) }]);
    setAllowanceLabel('');
    setAllowanceAmt(0);
  };
  const removeAllowance = (idx: number) => {
    setAllowances((arr) => arr.filter((_, i) => i !== idx));
  };

  return (
    <div className="border-t border-kaya-warm-dark/30 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <p className="text-xs font-bold uppercase tracking-wider text-kaya-sand inline-flex items-center gap-2">
          💼 Auto-payroll
          {existing
            ? <span className="text-[10px] normal-case tracking-normal font-normal text-pantry-leaf-dk">· active · {formatCents(existing.rateCents, currency)} / {existing.basis} · {payAnchorLabel(existing)}</span>
            : <span className="text-[10px] normal-case tracking-normal font-normal text-kaya-sand italic">· not set up</span>
          }
        </p>
        <span className="text-[10px] text-kaya-sand">{expanded ? '▴' : '▾'}</span>
      </button>
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Basis */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">Pay basis</p>
            <div className="grid grid-cols-1 gap-1.5">
              {(Object.keys(BASIS_LABELS) as PayBasis[]).map((b) => {
                const on = basis === b;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBasis(b)}
                    className={`p-2 text-left rounded-kaya border ${on
                      ? 'bg-kaya-chocolate text-white border-kaya-chocolate'
                      : 'bg-white border-kaya-warm-dark text-kaya-chocolate hover:border-kaya-chocolate'
                    }`}
                  >
                    <p className="font-bold text-sm">{BASIS_LABELS[b].label}</p>
                    <p className={`text-[10px] mt-0.5 ${on ? 'text-white/80' : 'text-kaya-sand'}`}>{BASIS_LABELS[b].sub}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Rate */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">
              Rate ({currency} per {basis === 'monthly' ? 'month' : basis === 'daily' ? 'day' : 'hour'})
            </p>
            <input
              type="number" min={0} step="0.01"
              value={rateMajor}
              onChange={(e) => setRateMajor(parseFloat(e.target.value) || 0)}
              className="w-full h-10 px-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-sm font-bold focus:outline-none focus:border-kaya-chocolate"
            />
          </div>

          {/* Frequency + anchor */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">Pay frequency</p>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as PayFrequency)}
                className="w-full h-10 px-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-sm font-bold focus:outline-none focus:border-kaya-chocolate"
              >
                {(Object.keys(FREQ_LABELS) as PayFrequency[]).map((f) => (
                  <option key={f} value={f}>{FREQ_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">
                {frequency === 'monthly' ? 'Pay day of month' : 'Pay day of week'}
              </p>
              {frequency === 'monthly' ? (
                <input
                  type="number" min={1} max={28}
                  value={payAnchor}
                  onChange={(e) => setPayAnchor(Math.min(28, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                  className="w-full h-10 px-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-sm font-bold focus:outline-none focus:border-kaya-chocolate"
                />
              ) : (
                <select
                  value={payAnchor}
                  onChange={(e) => setPayAnchor(parseInt(e.target.value, 10))}
                  className="w-full h-10 px-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-sm font-bold focus:outline-none focus:border-kaya-chocolate"
                >
                  {DOW_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}
                </select>
              )}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">Start date</p>
              <input
                type="date" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full h-10 px-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-sm font-bold focus:outline-none focus:border-kaya-chocolate"
              />
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">End date (optional)</p>
              <input
                type="date" value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full h-10 px-3 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-sm font-bold focus:outline-none focus:border-kaya-chocolate"
              />
            </div>
          </div>

          {/* Allowances */}
          <div>
            <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">Allowances (added every cycle)</p>
            {allowances.length === 0 && (
              <p className="text-[11px] text-kaya-sand italic mb-1">None yet — add transport, airtime, meals, etc.</p>
            )}
            <div className="space-y-1 mb-2">
              {allowances.map((a, i) => (
                <div key={i} className="flex items-center gap-2 text-[11px] bg-white border border-kaya-warm-dark/50 rounded-kaya-sm px-2 py-1">
                  <span className="flex-1 font-bold">{a.label}</span>
                  <span className="text-kaya-sand">{formatCents(a.amountCents, currency)}</span>
                  <button
                    type="button"
                    onClick={() => removeAllowance(i)}
                    className="text-kaya-sand hover:text-red-600 text-xs"
                    aria-label={`Remove ${a.label}`}
                  >×</button>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-[2fr_1fr_auto] gap-1.5">
              <input
                type="text" value={allowanceLabel}
                onChange={(e) => setAllowanceLabel(e.target.value)}
                placeholder="e.g. Transport"
                className="h-9 px-2 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-xs font-bold focus:outline-none focus:border-kaya-chocolate"
              />
              <input
                type="number" min={0} step="0.01"
                value={allowanceAmt}
                onChange={(e) => setAllowanceAmt(parseFloat(e.target.value) || 0)}
                placeholder="0"
                className="h-9 px-2 bg-kaya-cream/40 border border-kaya-warm-dark rounded-kaya-sm text-xs font-bold focus:outline-none focus:border-kaya-chocolate"
              />
              <button
                type="button"
                onClick={addAllowance}
                disabled={!allowanceLabel.trim() || allowanceAmt <= 0}
                className="h-9 px-3 bg-kaya-chocolate text-white rounded-kaya-sm text-xs font-bold disabled:opacity-40"
              >+ Add</button>
            </div>
          </div>

          {/* Save row */}
          <div className="flex items-center gap-2 pt-1">
            {existing && (
              <button
                type="button"
                onClick={remove}
                disabled={saving}
                className="text-[11px] font-bold text-red-600 disabled:opacity-50"
              >Turn off auto-payroll</button>
            )}
            <div className="flex-1" />
            {error && <span className="text-[11px] text-red-600 font-bold">{error}</span>}
            {savedFlash && <span className="text-[11px] text-pantry-leaf-dk font-bold">✓ Saved</span>}
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="h-9 px-4 bg-kaya-chocolate text-white rounded-kaya-sm text-xs font-black disabled:opacity-50"
            >
              {saving ? 'Saving…' : existing ? 'Update' : 'Activate auto-payroll'}
            </button>
          </div>

          {/* Deductions read-only summary (set elsewhere; here just for visibility). */}
          {existing?.deductions && existing.deductions.length > 0 && (
            <div className="border-t border-kaya-warm-dark/30 pt-2">
              <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-1.5">
                Active deductions ({existing.deductions.filter((d) => d.active).length})
              </p>
              <div className="space-y-1">
                {existing.deductions.map((d, i) => (
                  <div key={i} className={`text-[11px] flex items-center gap-2 ${d.active ? '' : 'opacity-50'}`}>
                    <span className="flex-1 truncate">{d.label}</span>
                    <span className="text-kaya-sand">{formatCents(d.perCycleCents, currency)} / cycle · balance {formatCents(d.balanceCents, currency)}</span>
                    {!d.active && <span className="text-[9px] italic">paid off</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

