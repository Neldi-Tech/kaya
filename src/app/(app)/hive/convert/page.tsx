'use client';

// /hive/convert — the saving side of the money ladder:
//   HP → Coins (parent-approved) · Coins → Honey Pot (instant).
// CASH UPGRADE: getting real Cash out of the Pot moved to the Kaya ATM at
// /hive/withdraw (parent OK + 🤝 handover) — one ladder, one exit. The old
// direct Coins→Cash shortcut is retired from the UI.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { requestHpToHoney, convertCoinsToTreasury } from '@/lib/hive';
import KidSwitcher from '@/components/hive/KidSwitcher';
import NumberInput from '@/components/hive/NumberInput';
import BackButton from '@/components/ui/BackButton';
import { formatHoney, formatHp, honeyToCashCents, formatCash } from '@/components/hive/format';

type Mode = 'hp_to_coins' | 'coins_to_pot';

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
      } else {
        if (num > wallet.honeyCoins) throw new Error(`You only have ${formatHoney(wallet.honeyCoins)} 🪙.`);
        await convertCoinsToTreasury(profile.familyId, activeKidId, num, config, profile.uid, fxRate);
        setDone(`Moved ${formatHoney(num)} 🪙 into your Honey Pot 🍯`);
        setAmount(0); setSubmitting(false);
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
          {mode === 'hp_to_coins' ? 'Save my points 🪙' : 'Fill the Honey Pot 🍯'}
        </h1>
      </div>

      <KidSwitcher />

      {/* Ladder switcher — real Cash now comes out via the Kaya ATM 🏧. */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <button onClick={() => { setMode('hp_to_coins'); setAmount(0); setError(''); setDone(''); }} className={seg('hp_to_coins', '', 'bg-hive-honey shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]')}>⭐→🪙 Save HP</button>
        <button onClick={() => { setMode('coins_to_pot'); setAmount(0); setError(''); setDone(''); }} className={seg('coins_to_pot', '', 'bg-hive-honey-dk shadow-[0_8px_20px_-8px_rgba(209,127,26,0.5)]')}>🪙→🍯 To Pot</button>
        <Link href="/hive/withdraw" className="h-12 rounded-hive-pill font-nunito font-black text-[12px] transition-colors bg-hive-paper border border-hive-green/50 text-hive-green flex items-center justify-center hover:bg-hive-green hover:text-white">🍯→💵 ATM 🏧</Link>
      </div>

      {/* FROM card */}
      <div className="rounded-hive p-4 mb-2 border bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft border-hive-honey">
        <div className="flex justify-between items-center mb-2">
          <p className="font-nunito font-black text-[12px] uppercase tracking-[2px] text-hive-muted">
            {mode === 'hp_to_coins' ? 'FROM ⭐ House Points' : 'FROM 🪙 Coins'}
          </p>
          <p className="text-[11px] text-hive-muted font-bold">
            Available: {mode === 'hp_to_coins'
              ? `${formatHp(Math.max(0, wallet.housePoints - config.minHpReserve))} HP`
              : formatHoney(wallet.honeyCoins)}
          </p>
        </div>
        <div className="flex items-baseline gap-2">
          <NumberInput
            value={amount}
            onChange={setAmount}
            min={0}
            ariaLabel="Amount to convert"
            placeholder="0"
            className="font-nunito font-black text-[44px] leading-none bg-transparent outline-none w-full max-w-[220px] placeholder:text-hive-muted/30 min-w-0"
          />
          <span className="text-base text-hive-muted font-bold">
            {mode === 'hp_to_coins' ? 'HP' : '🪙'}
          </span>
        </div>
      </div>

      <div className="text-center text-2xl text-hive-honey -my-1">↓</div>

      {/* TO card */}
      <div className="rounded-hive p-4 mb-4 border bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7] border-[#8FD3AB]">
        <p className="font-nunito font-black text-[12px] uppercase tracking-[2px] text-hive-muted mb-2">
          {mode === 'hp_to_coins' ? 'TO 🪙 Coins' : 'TO 🍯 Honey Pot'}
        </p>
        <span className="font-nunito font-black text-[36px] leading-none text-hive-honey-dk">
          {mode === 'hp_to_coins'
            ? `+${formatHoney(coinsFromHp)} 🪙`
            : `+${formatCash(potFromCoins, config.currency)}`}
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
          mode === 'coins_to_pot' ? 'bg-hive-honey-dk hover:brightness-110' : 'bg-hive-honey hover:bg-hive-honey-dk'
        }`}
      >
        {submitting ? 'Working…'
          : mode === 'hp_to_coins' ? 'Request save (parent approves) →'
          : 'Move into Honey Pot 🍯'}
      </button>

      <p className="mt-3 text-[11px] text-hive-muted text-center leading-relaxed">
        {mode === 'coins_to_pot'
          ? 'Moving Coins into your Honey Pot is instant — it pools your earned money.'
          : 'Needs parent approval · usually within a day. You\'ll see it in your wallet\'s pending list.'}{' '}
        Need real money? <Link href="/hive/withdraw" className="text-hive-honey-dk font-extrabold hover:underline">Kaya ATM 🏧</Link>
      </p>

      <div className="mt-6 flex items-center justify-center gap-4">
        <Link href="/hive/wallet" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">← Back to wallet</Link>
        <span className="text-hive-line">·</span>
        <Link href="/hive/guide" className="text-[12px] font-nunito font-extrabold text-hive-muted hover:text-hive-honey-dk hover:underline">📚 First time? Read the Guide</Link>
      </div>
    </div>
  );
}
