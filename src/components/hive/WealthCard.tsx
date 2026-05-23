'use client';

// Wealth = A + B. The honest, whole picture for a kid:
//   A (money) = HP-as-value + Coins + Honey Pot (Treasury) + Cash
//   B (assets) = what their business owns (inventory + tools), as commentary.
// Tucks the kid-friendly definitions behind a "What's what?" toggle so the
// money words are always explained.

import { useState } from 'react';
import Link from 'next/link';
import { formatCash, formatHp, formatHoney, honeyToCashCents } from './format';

export default function WealthCard({
  treasuryCents, honeyCoins, housePoints, cashCents, businessAssetsCents,
  hpToHoneyRate, honeyToCashRate, currency = 'USD', fxUsdToFamily = 1,
}: {
  treasuryCents: number;
  honeyCoins: number;
  housePoints: number;
  cashCents: number;
  businessAssetsCents: number;
  hpToHoneyRate: number;
  honeyToCashRate: number;
  currency?: string;
  fxUsdToFamily?: number;
}) {
  const [open, setOpen] = useState(false);
  const fx = fxUsdToFamily ?? 1;

  const coinsCents = honeyToCashCents(honeyCoins, honeyToCashRate, fx);
  const hpCoins = hpToHoneyRate > 0 ? housePoints / hpToHoneyRate : 0;
  const hpCents = honeyToCashCents(hpCoins, honeyToCashRate, fx);
  const moneyA = coinsCents + treasuryCents + cashCents + hpCents;
  const assetsB = Math.max(0, businessAssetsCents || 0);
  const total = moneyA + assetsB;

  const tiers: Array<{ emoji: string; name: string; amount: string; def: string; pot?: boolean }> = [
    { emoji: '🏅', name: 'House Points', amount: `${formatHp(housePoints)} HP`, def: 'Your effort score — chores, kindness, learning, your business.' },
    { emoji: '🪙', name: 'Coins', amount: `${formatHoney(honeyCoins)} 🪙`, def: 'Swap House Points for Coins — your in-Kaya money, ready to grow.' },
    { emoji: '🍯', name: 'Honey Pot', amount: formatCash(treasuryCents, currency), def: 'Your Treasury Reserve. Sales land here & Coins flow in — a parent turns it into Cash.', pot: true },
    { emoji: '💵', name: 'Cash', amount: formatCash(cashCents, currency), def: 'Real money to spend. Only a parent adds it — directly or from your Honey Pot.' },
  ];

  return (
    <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">💎 My Wealth</p>
          <p className="font-nunito font-black text-[30px] leading-tight mt-0.5">{formatCash(total, currency)}</p>
          <p className="text-[11px] text-hive-muted font-bold mt-0.5">everything you've built — money + what your business owns</p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="shrink-0 text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          {open ? 'Hide' : "What's what?"}
        </button>
      </div>

      <div className="mt-3 flex gap-2 text-[11px]">
        <div className="flex-1 bg-hive-cream rounded-hive p-2.5">
          <p className="text-hive-muted font-bold">A · Money</p>
          <p className="font-nunito font-black text-[15px]">{formatCash(moneyA, currency)}</p>
        </div>
        <div className="flex-1 bg-hive-cream rounded-hive p-2.5">
          <p className="text-hive-muted font-bold">B · Business</p>
          <p className="font-nunito font-black text-[15px]">{formatCash(assetsB, currency)}</p>
        </div>
      </div>

      {open && (
        <div className="mt-3 space-y-2">
          {tiers.map((t) => (
            <div key={t.name} className={`flex items-start gap-2.5 rounded-hive p-2.5 border ${t.pot ? 'border-hive-honey bg-[#FFFBEE]' : 'border-hive-line bg-white'}`}>
              <span className="text-[18px] leading-none">{t.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-nunito font-extrabold text-[13px]">{t.name}</span>
                  <span className="font-nunito font-extrabold text-[12px] whitespace-nowrap">{t.amount}</span>
                </div>
                <p className="text-[11px] text-hive-muted leading-snug mt-0.5">{t.def}</p>
              </div>
            </div>
          ))}
          <div className="flex items-start gap-2.5 rounded-hive p-2.5 border border-dashed border-hive-honey-dk bg-hive-cream">
            <span className="text-[18px] leading-none">📦</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-nunito font-extrabold text-[13px]">Business Assets</span>
                <span className="font-nunito font-extrabold text-[12px] whitespace-nowrap">{formatCash(assetsB, currency)}</span>
              </div>
              <p className="text-[11px] text-hive-muted leading-snug mt-0.5">
                The stuff your business owns — stock + tools. Counts toward your worth.{' '}
                <Link href="/business" className="text-hive-honey-dk font-bold hover:underline">See business →</Link>
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
