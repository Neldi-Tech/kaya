'use client';

// /hive/convert — section-3 of the v2 mockup. Two modes (HP→Honey,
// Honey→Cash); each shows a FROM card → ↓ arrow → TO card with rate
// pill and live preview. Submitting always creates an approvalRequest
// (per family.requireApprovalForHpToHoney; can be flipped to instant
// for HP→Honey via /parent/rates, but for v1 we always go through the
// queue per the user's "parents to approve transfers" rule).

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { requestHpToHoney, requestCashOut } from '@/lib/hive';
import RatePill from '@/components/hive/RatePill';
import KidSwitcher from '@/components/hive/KidSwitcher';
import NumberInput from '@/components/hive/NumberInput';
import BackButton from '@/components/ui/BackButton';
import { formatCash, formatHoney, formatHp, honeyToCashCents } from '@/components/hive/format';

type Mode = 'hp_to_honey' | 'honey_to_cash';

export default function ConvertPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const { activeKidId, wallet, config, fxUsdToFamily } = useHive();

  const [mode, setMode] = useState<Mode>('hp_to_honey');
  const [amount, setAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const activeKid = children.find((c) => c.id === activeKidId);
  const numAmount = Math.max(0, Math.round(amount));
  const fxRate = fxUsdToFamily ?? 1;

  // Compute the "TO" preview live. Honey is USD-benchmarked, so the cash
  // amount lands in family currency via the live USD→family FX rate.
  const fromHoneyToCashCents = honeyToCashCents(numAmount, config.honeyToCashRate, fxRate);
  const fromHpToHoney = config.hpToHoneyRate > 0 ? Math.floor(numAmount / config.hpToHoneyRate) : 0;

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError('');
    if (numAmount <= 0) { setError('Pick an amount.'); return; }

    setSubmitting(true);
    try {
      if (mode === 'hp_to_honey') {
        if (numAmount > wallet.housePoints) throw new Error(`You only have ${formatHp(wallet.housePoints)} HP.`);
        await requestHpToHoney(profile.familyId, activeKidId, numAmount, config, profile.uid);
      } else {
        if (numAmount > wallet.honeyCoins) throw new Error(`You only have ${formatHoney(wallet.honeyCoins)} 🍯.`);
        await requestCashOut(
          profile.familyId, activeKidId, numAmount, config, profile.uid,
          fxRate,
        );
      }
      router.push('/hive/wallet?pending=1');
    } catch (e: any) {
      setError(e?.message || 'Failed to submit.');
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Convert</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">
          {mode === 'hp_to_honey' ? 'Save my points 🍯' : 'Get real money 💵'}
        </h1>
      </div>

      <KidSwitcher />

      {/* Mode switcher */}
      <div className="grid grid-cols-2 gap-2 mb-5">
        <button
          onClick={() => { setMode('hp_to_honey'); setAmount(0); setError(''); }}
          className={`h-12 rounded-hive-pill font-nunito font-black text-[13px] transition-colors ${
            mode === 'hp_to_honey' ? 'bg-hive-honey text-white shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]' : 'bg-hive-paper border border-hive-line text-hive-muted'
          }`}
        >
          ⭐ → 🍯  Save HP
        </button>
        <button
          onClick={() => { setMode('honey_to_cash'); setAmount(0); setError(''); }}
          className={`h-12 rounded-hive-pill font-nunito font-black text-[13px] transition-colors ${
            mode === 'honey_to_cash' ? 'bg-hive-green text-white shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)]' : 'bg-hive-paper border border-hive-line text-hive-muted'
          }`}
        >
          🍯 → 💵  Cash out
        </button>
      </div>

      {/* FROM card */}
      <div className={`rounded-hive p-4 mb-2 border ${
        mode === 'hp_to_honey'
          ? 'bg-gradient-to-br from-[#E5EBF3] to-[#F4F7FB] border-[#D5DEE9]'
          : 'bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft border-hive-honey'
      }`}>
        <div className="flex justify-between items-center mb-2">
          <p className="font-nunito font-black text-[13px] uppercase tracking-[2px] text-hive-muted">
            {mode === 'hp_to_honey' ? 'FROM ⭐ House Points' : 'FROM 🍯 Honey Coins'}
          </p>
          <p className="text-[11px] text-hive-muted font-bold">
            Available: {mode === 'hp_to_honey' ? formatHp(wallet.housePoints) : formatHoney(wallet.honeyCoins)}
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <NumberInput
            value={amount}
            onChange={setAmount}
            min={0}
            ariaLabel="Amount to convert"
            placeholder="0"
            className="font-nunito font-black text-[44px] leading-none bg-transparent outline-none w-full max-w-[200px] placeholder:text-hive-muted/30 min-w-0"
          />
          <span className="text-base text-hive-muted font-bold">
            {mode === 'hp_to_honey' ? 'HP' : '🍯'}
          </span>
        </div>
        <div className="mt-3">
          <RatePill
            hpToHoneyRate={config.hpToHoneyRate}
            honeyToCashRate={config.honeyToCashRate}
            currency={config.currency}
            fxUsdToFamily={fxUsdToFamily}
            variant={mode === 'hp_to_honey' ? 'hp-to-honey' : 'honey-to-cash'}
          />
        </div>
      </div>

      <div className="text-center text-2xl text-hive-honey -my-1">↓</div>

      {/* TO card */}
      <div className={`rounded-hive p-4 mb-4 border ${
        mode === 'hp_to_honey'
          ? 'bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft border-hive-honey'
          : 'bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7] border-[#8FD3AB]'
      }`}>
        <div className="flex justify-between items-center mb-2">
          <p className="font-nunito font-black text-[13px] uppercase tracking-[2px] text-hive-muted">
            {mode === 'hp_to_honey' ? 'TO 🍯 Honey Coins' : 'TO 💵 Cash'}
          </p>
          <p className="text-[11px] text-hive-muted font-bold">
            Current: {mode === 'hp_to_honey' ? formatHoney(wallet.honeyCoins) : formatCash(wallet.cashCents, config.currency)}
          </p>
        </div>
        <div>
          <span
            className="font-nunito font-black text-[40px] leading-none"
            style={{ color: mode === 'hp_to_honey' ? '#D17F1A' : '#3FAF6C' }}
          >
            {mode === 'hp_to_honey' ? `+${formatHoney(fromHpToHoney)}` : `+${formatCash(fromHoneyToCashCents, config.currency)}`}
          </span>
          {mode === 'hp_to_honey' && <span className="text-base text-hive-muted font-bold ml-2">🍯</span>}
        </div>
        <p className="text-[11px] text-hive-muted mt-2">
          New balance:{' '}
          {mode === 'hp_to_honey'
            ? `${formatHoney(wallet.honeyCoins + fromHpToHoney)} 🍯 (≈ ${formatCash(honeyToCashCents(wallet.honeyCoins + fromHpToHoney, config.honeyToCashRate, fxRate), config.currency)})`
            : formatCash(wallet.cashCents + fromHoneyToCashCents, config.currency)}
        </p>
      </div>

      {error && (
        <p className="text-hive-rose text-sm font-bold text-center mb-3">{error}</p>
      )}

      <button
        onClick={submit}
        disabled={submitting || numAmount <= 0 || isGuest || !activeKidId}
        className={`w-full h-12 rounded-hive font-nunito font-black text-[14px] text-white transition disabled:opacity-40 ${
          mode === 'hp_to_honey'
            ? 'bg-hive-honey hover:bg-hive-honey-dk shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]'
            : 'bg-hive-green hover:brightness-110 shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)]'
        }`}
      >
        {submitting
          ? 'Sending…'
          : mode === 'hp_to_honey'
            ? 'Request save (parent approves) →'
            : 'Request cash-out (parent approves) →'}
      </button>

      <p className="mt-3 text-[11px] text-hive-muted text-center leading-relaxed">
        ⚠️ Needs parent approval · usually within 1 day. You&apos;ll see it in your wallet&apos;s pending list.
      </p>

      <div className="mt-6 text-center">
        <Link href="/hive/wallet" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          ← Back to wallet
        </Link>
      </div>
    </div>
  );
}
