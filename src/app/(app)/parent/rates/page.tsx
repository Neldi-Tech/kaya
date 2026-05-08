'use client';

// /parent/rates — Lever A (HP→🍯) + Lever B (🍯→$) + approval policy
// toggles. Writes the merged hiveConfig back to the family doc; the
// HiveContext picks up the change live across every kid wallet.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { setHiveConfig } from '@/lib/hive';
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
  }, [config]);

  const dirty =
    hpToHoney !== config.hpToHoneyRate ||
    honeyToCash !== config.honeyToCashRate ||
    minCashOut !== config.minCashOut ||
    requireHpToHoney !== config.requireApprovalForHpToHoney ||
    spendApproval !== config.spendRequiresApproval ||
    cashOutApproval !== config.cashOutRequiresApproval;

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
    setError('');
  };

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
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">Lever B · 🍯 → $</p>
          <p className="text-[12px] text-hive-muted mt-1 mb-3">How much real cash does each Honey Coin become?</p>
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
            desc="Recommended on. Kids submit a description; you approve before money leaves."
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
