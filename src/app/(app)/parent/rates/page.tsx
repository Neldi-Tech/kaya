'use client';

// /parent/rates — Lever A (HP→🍯) + Lever B (🍯→$) + approval policy
// toggles. Writes the merged hiveConfig back to the family doc; the
// HiveContext picks up the change live across every kid wallet.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { setHiveConfig, CURRENCIES, currencyMeta } from '@/lib/hive';
import { useFamily } from '@/contexts/FamilyContext';
import { updateChild, Child } from '@/lib/firestore';
import { fetchFxRates, suggestedRate, formatRate, FxRates } from '@/lib/fxRates';
import KidAvatar from '@/components/ui/KidAvatar';
import BackButton from '@/components/ui/BackButton';

export default function ParentRatesPage() {
  const { profile, isGuest } = useAuth();
  const { config } = useHive();

  // Local working copy so the sliders feel snappy; persist on Save.
  const [hpToHoney, setHpToHoney] = useState(config.hpToHoneyRate);
  const [honeyToCash, setHoneyToCash] = useState(config.honeyToCashRate);
  const [minCashOut, setMinCashOut] = useState(config.minCashOut);
  const [requireHpToHoney, setRequireHpToHoney] = useState(config.requireApprovalForHpToHoney);
  const [spendApproval, setSpendApproval] = useState(config.spendRequiresApproval);
  const [cashOutApproval, setCashOutApproval] = useState(config.cashOutRequiresApproval);
  const [currency, setCurrency] = useState(config.currency);
  // Auto-approve threshold is held in dollars (the user-facing unit) and
  // converted to cents on save so the UI can show "$5.00" cleanly.
  const [autoApproveDollars, setAutoApproveDollars] = useState((config.spendAutoApproveBelowCents || 0) / 100);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  // Re-sync when config changes externally (other parent saves).
  useEffect(() => {
    setHpToHoney(config.hpToHoneyRate);
    setHoneyToCash(config.honeyToCashRate);
    setMinCashOut(config.minCashOut);
    setRequireHpToHoney(config.requireApprovalForHpToHoney);
    setSpendApproval(config.spendRequiresApproval);
    setCashOutApproval(config.cashOutRequiresApproval);
    setCurrency(config.currency);
    setAutoApproveDollars((config.spendAutoApproveBelowCents || 0) / 100);
  }, [config]);

  const autoApproveCents = Math.max(0, Math.round(autoApproveDollars * 100));

  const dirty =
    hpToHoney !== config.hpToHoneyRate ||
    honeyToCash !== config.honeyToCashRate ||
    minCashOut !== config.minCashOut ||
    requireHpToHoney !== config.requireApprovalForHpToHoney ||
    spendApproval !== config.spendRequiresApproval ||
    cashOutApproval !== config.cashOutRequiresApproval ||
    currency !== config.currency ||
    autoApproveCents !== (config.spendAutoApproveBelowCents || 0);

  const save = async () => {
    if (isGuest || !profile?.familyId) return;
    setError('');
    if (hpToHoney <= 0 || honeyToCash <= 0 || minCashOut < 0) {
      setError('Rates must be positive.');
      return;
    }
    setSaving(true);
    try {
      await setHiveConfig(profile.familyId, {
        hpToHoneyRate: Math.round(hpToHoney),
        honeyToCashRate: Math.round(honeyToCash * 100) / 100,
        minCashOut: Math.round(minCashOut),
        requireApprovalForHpToHoney: requireHpToHoney,
        spendRequiresApproval: spendApproval,
        cashOutRequiresApproval: cashOutApproval,
        currency,
        spendAutoApproveBelowCents: autoApproveCents,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e: any) {
      setError(e?.message || 'Failed to save.');
    }
    setSaving(false);
  };

  const reset = () => {
    setHpToHoney(config.hpToHoneyRate);
    setHoneyToCash(config.honeyToCashRate);
    setMinCashOut(config.minCashOut);
    setRequireHpToHoney(config.requireApprovalForHpToHoney);
    setSpendApproval(config.spendRequiresApproval);
    setCashOutApproval(config.cashOutRequiresApproval);
    setCurrency(config.currency);
    setAutoApproveDollars((config.spendAutoApproveBelowCents || 0) / 100);
    setError('');
  };

  const meta = currencyMeta(currency);
  const currencySymbol = meta.symbol;
  const symbolText = currencySymbol.trim() || '$';

  // Live FX rates (used for the Lever B "today's market" hint). Fetched
  // once when the page mounts; cached in localStorage per (base, day).
  const [fx, setFx] = useState<FxRates | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetchFxRates('USD').then((r) => { if (!cancelled) setFx(r); });
    return () => { cancelled = true; };
  }, []);

  // Per-USD rate of the active currency (e.g. 2650 for TZS). Drives the
  // Lever B suggestion: "If you want 1 🍯 ≈ $1, set 1 🍯 = TSh 2,650".
  const usdToActive = useMemo(() => {
    if (currency === 'USD') return 1;
    return suggestedRate(fx, 'USD', currency);
  }, [fx, currency]);

  // Live preview: e.g. 100 HP / 100 = 1 🍯 × $1 = $1.
  const preview100 = (hpToHoney > 0 ? (100 / hpToHoney) * honeyToCash : 0).toFixed(2);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · The Hive</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1">Rates &amp; policy</h1>
        <p className="text-sm text-hive-muted mt-2">
          Two levers control the whole flow. Higher Lever A = kids accumulate Honey faster.
          Higher Lever B = Honey converts to more real cash.
        </p>
      </div>

      <div className="space-y-4">
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Lever A · HP → 🍯</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-3">How many House Points convert to one Honey Coin?</p>
          <div className="flex items-baseline gap-3">
            <input
              type="number"
              min={1}
              max={1000}
              step={1}
              value={hpToHoney}
              onChange={(e) => setHpToHoney(Math.max(1, parseInt(e.target.value || '0', 10) || 0))}
              className="w-28 h-12 px-3 bg-hive-cream rounded-hive-pill text-center font-nunito font-black text-2xl border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            />
            <span className="font-nunito font-extrabold text-lg">HP = 1 🍯</span>
          </div>
          <input
            type="range"
            min={10}
            max={500}
            step={5}
            value={hpToHoney}
            onChange={(e) => setHpToHoney(parseInt(e.target.value, 10))}
            className="w-full mt-3 accent-hive-honey"
          />
        </div>

        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Lever B · 🍯 → $ USD</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-3">
            How many <strong>US dollars</strong> does each Honey Coin become?
            Honey is benchmarked in USD on purpose — same value across every Kaya family,
            same language for every kid. The cash that lands in the wallet shows up in your family currency.
          </p>
          <div className="flex items-baseline gap-3">
            <span className="font-nunito font-extrabold text-lg">1 🍯 = $</span>
            <input
              type="number"
              min={0}
              max={100}
              step={0.05}
              value={honeyToCash}
              onChange={(e) => setHoneyToCash(Math.max(0, parseFloat(e.target.value || '0') || 0))}
              className="w-28 h-12 px-3 bg-hive-cream rounded-hive-pill text-center font-nunito font-black text-2xl border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            />
            <span className="font-nunito font-extrabold text-sm text-hive-muted">USD</span>
          </div>
          <input
            type="range"
            min={0}
            max={5}
            step={0.05}
            value={honeyToCash}
            onChange={(e) => setHoneyToCash(parseFloat(e.target.value))}
            className="w-full mt-3 accent-hive-honey"
          />

          {/* Family-currency "what does that look like today" preview. */}
          {currency !== 'USD' && (
            usdToActive ? (
              <p className="mt-3 text-[11px] text-hive-honey-dk font-nunito font-extrabold">
                💡 Today: 1 🍯 = ${honeyToCash.toFixed(2)} USD ≈ {symbolText}{formatRate(honeyToCash * usdToActive)} {currency}
              </p>
            ) : (
              <p className="mt-3 text-[11px] text-hive-muted">
                Today&apos;s {currency} preview unavailable — falls back to the USD value when offline.
              </p>
            )
          )}
        </div>

        <div className="bg-gradient-to-br from-[#FFE9C2] to-hive-honey-soft rounded-hive-lg p-5">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Live preview</p>
          <p className="font-nunito font-black text-2xl mt-1">100 HP ≈ ${preview100}</p>
          <p className="text-[12px] text-hive-muted mt-1">At these rates, kids see the conversion line in their wallet.</p>
        </div>

        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk mb-3">Cash-out minimum</p>
          <div className="flex items-baseline gap-3">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={minCashOut}
              onChange={(e) => setMinCashOut(Math.max(0, parseInt(e.target.value || '0', 10) || 0))}
              className="w-24 h-11 px-3 bg-hive-cream rounded-hive-pill text-center font-nunito font-black text-lg border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            />
            <span className="font-nunito font-extrabold text-sm">🍯 minimum to cash out</span>
          </div>
          <p className="text-[12px] text-hive-muted mt-2">Stops kids from cashing out tiny amounts.</p>
        </div>

        {/* Currency. Family picks once; everything in the Hive renders
            in this currency. Existing balances aren't mathematically
            converted on switch — see the helper note. */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk mb-2">Currency</p>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full h-12 px-3 bg-hive-cream rounded-hive-pill font-nunito font-extrabold text-base border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>{c.symbol.trim()}  {c.code} — {c.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-hive-muted mt-2 leading-relaxed">
            Default for every kid wallet, plan, deposit and ledger entry. When you receive cash in a different
            currency, you can enter the source amount + exchange rate on{' '}
            <strong>Deposit cash</strong>.
          </p>
        </div>

        {/* Spend auto-approve threshold. Spends strictly below this go
            straight through; spends at or above the threshold still need
            your approval. Default 0 = approve everything. Chips and step
            scale per active currency so TZS doesn't get $1-sized presets. */}
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Auto-approve small spends</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-3">
            Spends under this amount post instantly — no approval inbox tap. Anything at or above still needs you.
          </p>
          <div className="flex items-baseline gap-3">
            <span className="font-nunito font-extrabold text-lg">Below</span>
            <span className="font-nunito font-black text-2xl text-hive-muted">{symbolText}</span>
            <input
              type="number"
              min={0}
              max={meta.max}
              step={meta.step}
              value={autoApproveDollars}
              onChange={(e) => setAutoApproveDollars(Math.max(0, parseFloat(e.target.value || '0') || 0))}
              className="w-32 h-12 px-3 bg-hive-cream rounded-hive-pill text-center font-nunito font-black text-2xl border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => setAutoApproveDollars(0)}
              className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                autoApproveDollars === 0
                  ? 'bg-hive-honey text-white border-transparent'
                  : 'border-hive-line bg-hive-paper text-hive-muted hover:border-hive-honey/40'
              }`}
            >
              Off
            </button>
            {meta.smallSpends.map((v) => (
              <button
                key={v}
                onClick={() => setAutoApproveDollars(v)}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  autoApproveDollars === v
                    ? 'bg-hive-honey text-white border-transparent'
                    : 'border-hive-line bg-hive-paper text-hive-muted hover:border-hive-honey/40'
                }`}
              >
                {symbolText}{v.toLocaleString('en-US')}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-hive-muted mt-3 leading-relaxed">
            {autoApproveCents > 0
              ? `Kids can spend up to ${symbolText}${autoApproveDollars.toLocaleString('en-US')} on their own — perfect for snacks and small treats.`
              : 'Off — every spend lands in your Approvals inbox.'}
          </p>
        </div>

        {/* Per-child overrides — different kids, different ages,
            different ceilings. A kid with a custom value uses theirs;
            otherwise the family default above. */}
        <PerChildOverrides
          symbolText={symbolText}
          familyDefaultCents={autoApproveCents}
          smallSpends={meta.smallSpends}
          step={meta.step}
          max={meta.max}
        />

        <div className="bg-hive-paper border border-hive-line rounded-hive-lg divide-y divide-hive-line">
          <PolicyToggle
            label="Approve every HP → 🍯 conversion"
            desc="Off = kids can save HP into Honey instantly (the original design). On = even saving needs your tap."
            on={requireHpToHoney}
            onChange={setRequireHpToHoney}
          />
          <PolicyToggle
            label="Approve every cash-out (🍯 → $)"
            desc="Recommended on. Each request shows up in your Approvals inbox."
            on={cashOutApproval}
            onChange={setCashOutApproval}
          />
          <PolicyToggle
            label="Approve every cash spend"
            desc={`Recommended on. Kids submit a description; you approve before money leaves.${autoApproveCents > 0 ? ` (Spends below ${currencySymbol.trim() || '$'}${(autoApproveCents / 100).toFixed(2)} skip this and post instantly.)` : ''}`}
            on={spendApproval}
            onChange={setSpendApproval}
          />
        </div>

        {error && (
          <p className="text-hive-rose text-sm font-bold">{error}</p>
        )}

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={save}
            disabled={!dirty || saving || isGuest}
            className="h-12 px-6 bg-hive-honey hover:bg-hive-honey-dk text-white rounded-hive-pill font-nunito font-black text-sm disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
          </button>
          {dirty && !saving && (
            <button onClick={reset} className="h-12 px-4 text-[12px] font-nunito font-extrabold text-hive-muted hover:text-hive-navy">
              Reset
            </button>
          )}
          <Link href="/parent/approvals" className="ml-auto text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
            Approvals →
          </Link>
        </div>
      </div>
    </div>
  );
}

// Per-child overrides for the auto-approve threshold. Renders one row per
// kid with a Custom toggle: when off the kid uses the family default;
// when on they get their own value (which can be 0 = always require
// approval — useful for a younger kid you'd rather double-check).
function PerChildOverrides({
  symbolText, familyDefaultCents, smallSpends, step, max,
}: {
  symbolText: string;
  familyDefaultCents: number;
  smallSpends: number[];
  step: number;
  max: number;
}) {
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  if (children.length === 0) return null;
  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5">
      <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Per-kid overrides</p>
      <p className="text-[12px] text-hive-muted mt-1 mb-3">
        Different kids, different ceilings. Off → uses the family default
        of {familyDefaultCents > 0 ? `${symbolText}${(familyDefaultCents / 100).toLocaleString('en-US')}` : '“Off”'} above.
      </p>
      <div className="space-y-2">
        {children.map((c) => (
          <ChildOverrideRow
            key={c.id}
            familyId={profile?.familyId || ''}
            child={c}
            isGuest={isGuest}
            symbolText={symbolText}
            familyDefaultCents={familyDefaultCents}
            smallSpends={smallSpends}
            step={step}
            max={max}
          />
        ))}
      </div>
    </div>
  );
}

function ChildOverrideRow({
  familyId, child, isGuest, symbolText, familyDefaultCents, smallSpends, step, max,
}: {
  familyId: string;
  child: Child;
  isGuest: boolean;
  symbolText: string;
  familyDefaultCents: number;
  smallSpends: number[];
  step: number;
  max: number;
}) {
  const persisted = (child as any).spendAutoApproveBelowCents as number | null | undefined;
  const hasOverride = typeof persisted === 'number';
  // Local working copy so the input is snappy. We persist on chip-tap and
  // on blur for the free-form input.
  const [working, setWorking] = useState<number>(
    hasOverride ? persisted! : familyDefaultCents,
  );
  // Sync if the persisted value changes (e.g. another parent toggles).
  useEffect(() => {
    if (hasOverride) setWorking(persisted!);
  }, [hasOverride, persisted]);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const persist = async (cents: number | null) => {
    if (!familyId || isGuest) return;
    setSaving(true);
    try {
      await updateChild(familyId, child.id, { spendAutoApproveBelowCents: cents } as any);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1400);
    } catch {}
    setSaving(false);
  };

  const toggle = async () => {
    if (hasOverride) {
      await persist(null);
    } else {
      await persist(working);
    }
  };

  const setMajor = async (major: number) => {
    const cents = Math.max(0, Math.round(major * 100));
    setWorking(cents);
    await persist(cents);
  };

  return (
    <div className="rounded-hive border border-hive-line bg-hive-cream/60 p-3">
      <div className="flex items-center gap-3">
        <KidAvatar child={child} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="font-nunito font-extrabold text-[13px] truncate">{child.name}</p>
          <p className="text-[11px] text-hive-muted">
            {hasOverride
              ? (persisted === 0
                  ? 'Always require approval (custom)'
                  : `Custom: ${symbolText}${(persisted! / 100).toLocaleString('en-US')}`)
              : (familyDefaultCents > 0
                  ? `Using default: ${symbolText}${(familyDefaultCents / 100).toLocaleString('en-US')}`
                  : 'Using default: Off')}
            {saving && <span className="ml-2 text-hive-muted">· Saving…</span>}
            {savedFlash && <span className="ml-2 text-hive-green font-bold">· ✓ Saved</span>}
          </p>
        </div>
        <button
          onClick={toggle}
          disabled={saving || isGuest}
          className="flex items-center gap-2 disabled:opacity-60"
          aria-label={hasOverride ? 'Use family default' : 'Use a custom value for this kid'}
        >
          <div className={`w-10 h-6 rounded-hive-pill relative transition-colors ${hasOverride ? 'bg-hive-honey' : 'bg-hive-line'}`}>
            <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all" style={{ left: hasOverride ? '18px' : '2px' }} />
          </div>
        </button>
      </div>

      {hasOverride && (
        <div className="mt-3">
          <div className="flex items-baseline gap-2">
            <span className="font-nunito font-black text-lg text-hive-muted">{symbolText}</span>
            <input
              type="number"
              min={0}
              max={max}
              step={step}
              value={working / 100}
              onChange={(e) => setWorking(Math.max(0, Math.round((parseFloat(e.target.value || '0') || 0) * 100)))}
              onBlur={() => persist(working)}
              className="flex-1 h-10 px-3 bg-hive-paper rounded-hive-pill font-nunito font-black text-lg border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => setMajor(0)}
              className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                working === 0
                  ? 'bg-hive-rose text-white border-transparent'
                  : 'border-hive-line bg-hive-paper text-hive-muted hover:border-hive-rose/40'
              }`}
            >
              Always approve
            </button>
            {smallSpends.map((v) => (
              <button
                key={v}
                onClick={() => setMajor(v)}
                className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                  working === Math.round(v * 100)
                    ? 'bg-hive-honey text-white border-transparent'
                    : 'border-hive-line bg-hive-paper text-hive-muted hover:border-hive-honey/40'
                }`}
              >
                {symbolText}{v.toLocaleString('en-US')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PolicyToggle({
  label, desc, on, onChange,
}: { label: string; desc: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="w-full text-left p-4 flex items-start gap-3 hover:bg-hive-cream transition-colors">
      <div className={`w-10 h-6 rounded-hive-pill shrink-0 mt-0.5 relative transition-colors ${on ? 'bg-hive-honey' : 'bg-hive-line'}`}>
        <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-all" style={{ left: on ? '18px' : '2px' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-extrabold text-[13px] leading-tight">{label}</p>
        <p className="text-[11px] text-hive-muted mt-1 leading-relaxed">{desc}</p>
      </div>
    </button>
  );
}
