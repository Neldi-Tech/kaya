'use client';

// /hive/convert — the money ladder, step by step:
//   HP → Coins (parent-approved) · Coins → Honey Pot (instant) ·
//   Honey Pot → Cash (parent-approved, single/both per family setting).
// Cash is parent-fed only — kids reach it by filling the Honey Pot, then a
// parent turns the Pot into Cash.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { requestHpToHoney, convertCoinsToTreasury, requestTreasuryToCash } from '@/lib/hive';
import KidSwitcher from '@/components/hive/KidSwitcher';
import NumberInput from '@/components/hive/NumberInput';
import BackButton from '@/components/ui/BackButton';
import { formatCash, formatHoney, formatHp, honeyToCashCents } from '@/components/hive/format';

type Mode = 'hp_to_coins' | 'coins_to_pot' | 'pot_to_cash';

export default function ConvertPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { children } = useFamily();
  const { activeKidId, wallet, config, fxUsdToFamily } = useHive();

  const [mode, setMode] = useState<Mode>('hp_to_coins');
  const [amount, setAmount] = useState<number>(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const fxRate = fxUsdToFamily ?? 1;
  const num = Math.max(0, Math.round(amount));
  const treasuryCents = wallet.treasuryCents || 0;

  // Reserve floor only applies to HP→Coins.
  const hpAfter = wallet.housePoints - num;
  const breachReserve = mode === 'hp_to_coins' && config.minHpReserve > 0 && num > 0 && hpAfter < config.minHpReserve;

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError(''); setDone('');
    if (num <= 0) { setError('Pick an amount.'); return; }
    setSubmitting(true);
    try {
      if (mode === 'hp_to_coins') {
        if (num > wallet.housePoints) throw new Error(`You only have ${formatHp(wallet.housePoints)} HP.`);
        await requestHpToHoney(profile.familyId, activeKidId, num, config, profile.uid, wallet.housePoints);
        router.push('/hive/wallet?pending=1');
      } else if (mode === 'coins_to_pot') {
        if (num > wallet.honeyCoins) throw new Error(`You only have ${formatHoney(wallet.honeyCoins)} 🪙.`);
        await convertCoinsToTreasury(profile.familyId, activeKidId, num, config, profile.uid, fxRate);
        setDone(`Moved ${formatHoney(num)} 🪙 into your Honey Pot 🍯`);
        setAmount(0); setSubmitting(false);
      } else {
        // pot_to_cash — amount is in family-currency major units → cents.
        const cents = Math.round(amount * 100);
        if (cents <= 0) throw new Error('Pick an amount.');
        if (cents > treasuryCents) throw new Error(`Your Honey Pot has ${formatCash(treasuryCents, config.currency)}.`);
        await requestTreasuryToCash(profile.familyId, activeKidId, cents, profile.uid, config.treasuryCashApprovers);
        router.push('/hive/wallet?pending=1');
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to submit.');
      setSubmitting(false);
    }
  };

  const seg = (m: Mode, label: string, on: string) =>
    `h-12 rounded-hive-pill font-nunito font-black text-[12px] transition-colors ${
      mode === m ? `${on} text-white` : 'bg-hive-paper border border-hive-line text-hive-muted'
    }`;

  // Live preview of the destination.
  const coinsFromHp = config.hpToHoneyRate > 0 ? Math.floor(num / config.hpToHoneyRate) : 0;
  const potFromCoins = honeyToCashCents(num, config.honeyToCashRate, fxRate);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Convert</p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">
          {mode === 'hp_to_coins' ? 'Save my points 🪙' : mode === 'coins_to_pot' ? 'Fill the Honey Pot 🍯' : 'Get real money 💵'}
        </h1>
      </div>

      <KidSwitcher />

      {/* Ladder switcher */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <button onClick={() => { setMode('hp_to_coins'); setAmount(0); setError(''); setDone(''); }} className={seg('hp_to_coins', '', 'bg-hive-honey shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]')}>⭐→🪙 Save HP</button>
        <button onClick={() => { setMode('coins_to_pot'); setAmount(0); setError(''); setDone(''); }} className={seg('coins_to_pot', '', 'bg-hive-honey-dk shadow-[0_8px_20px_-8px_rgba(209,127,26,0.5)]')}>🪙→🍯 To Pot</button>
        <button onClick={() => { setMode('pot_to_cash'); setAmount(0); setError(''); setDone(''); }} className={seg('pot_to_cash', '', 'bg-hive-green shadow-[0_8px_20px_-8px_rgba(63,175,108,0.5)]')}>🍯→💵 Cash</button>
      </div>

      {/* FROM card */}
      <div className="rounded-hive p-4 mb-2 border bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft border-hive-honey">
        <div className="flex justify-between items-center mb-2">
          <p className="font-nunito font-black text-[12px] uppercase tracking-[2px] text-hive-muted">
            {mode === 'hp_to_coins' ? 'FROM ⭐ House Points' : mode === 'coins_to_pot' ? 'FROM 🪙 Coins' : 'FROM 🍯 Honey Pot'}
          </p>
          <p className="text-[11px] text-hive-muted font-bold">
            Available: {mode === 'hp_to_coins'
              ? `${formatHp(Math.max(0, wallet.housePoints - config.minHpReserve))} HP`
              : mode === 'coins_to_pot'
                ? formatHoney(wallet.honeyCoins)
                : formatCash(treasuryCents, config.currency)}
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <NumberInput
            value={amount}
            onChange={setAmount}
            allowDecimal={mode === 'pot_to_cash'}
            min={0}
            ariaLabel="Amount to convert"
            placeholder="0"
            className="font-nunito font-black text-[44px] leading-none bg-transparent outline-none w-full max-w-[220px] placeholder:text-hive-muted/30 min-w-0"
          />
          <span className="text-base text-hive-muted font-bold">
            {mode === 'hp_to_coins' ? 'HP' : mode === 'coins_to_pot' ? '🪙' : config.currency}
          </span>
        </div>
      </div>

      <div className="text-center text-2xl text-hive-honey -my-1">↓</div>

      {/* TO card */}
      <div className="rounded-hive p-4 mb-4 border bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7] border-[#8FD3AB]">
        <p className="font-nunito font-black text-[12px] uppercase tracking-[2px] text-hive-muted mb-2">
          {mode === 'hp_to_coins' ? 'TO 🪙 Coins' : mode === 'coins_to_pot' ? 'TO 🍯 Honey Pot' : 'TO 💵 Cash'}
        </p>
        <span className="font-nunito font-black text-[36px] leading-none text-hive-honey-dk">
          {mode === 'hp_to_coins'
            ? `+${formatHoney(coinsFromHp)} 🪙`
            : mode === 'coins_to_pot'
              ? `+${formatCash(potFromCoins, config.currency)}`
              : `+${formatCash(Math.round(amount * 100) || 0, config.currency)}`}
        </span>
      </div>

      {breachReserve && (
        <div className="bg-hive-rose/10 border border-hive-rose/40 rounded-hive p-3 mb-3 text-[12px] font-nunito font-bold text-hive-rose">
          🛟 Keep at least {formatHp(config.minHpReserve)} HP — convert at most {formatHp(Math.max(0, wallet.housePoints - config.minHpReserve))} HP today.
        </div>
      )}
      {error && <p className="text-hive-rose text-sm font-bold text-center mb-3">{error}</p>}
      {done && <p className="text-hive-green text-sm font-bold text-center mb-3">✓ {done}</p>}

      <button
        onClick={submit}
        disabled={submitting || num <= 0 || isGuest || !activeKidId || breachReserve}
        className={`w-full h-12 rounded-hive font-nunito font-black text-[14px] text-white transition disabled:opacity-40 ${
          mode === 'coins_to_pot' ? 'bg-hive-honey-dk hover:brightness-110' : mode === 'pot_to_cash' ? 'bg-hive-green hover:brightness-110' : 'bg-hive-honey hover:bg-hive-honey-dk'
        }`}
      >
        {submitting ? 'Working…'
          : mode === 'hp_to_coins' ? 'Request save (parent approves) →'
          : mode === 'coins_to_pot' ? 'Move into Honey Pot 🍯'
          : `Ask ${config.treasuryCashApprovers >= 2 ? 'both parents' : 'a parent'} for Cash →`}
      </button>

      <p className="mt-3 text-[11px] text-hive-muted text-center leading-relaxed">
        {mode === 'coins_to_pot'
          ? 'Moving Coins into your Honey Pot is instant — it pools your earned money.'
          : `Needs ${mode === 'pot_to_cash' && config.treasuryCashApprovers >= 2 ? 'both parents' : 'parent'} approval · usually within a day. You'll see it in your wallet's pending list.`}
      </p>

      <div className="mt-6 flex items-center justify-center gap-4">
        <Link href="/hive/wallet" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">← Back to wallet</Link>
        <span className="text-hive-line">·</span>
        <Link href="/hive/guide" className="text-[12px] font-nunito font-extrabold text-hive-muted hover:text-hive-honey-dk hover:underline">📚 First time? Read the Guide</Link>
      </div>
    </div>
  );
}
