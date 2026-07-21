'use client';

// Wealth = A + B. The honest, whole picture for a kid:
//   A (money) = HP-as-value + Coins + Honey Pot (Treasury) + Cash
//   B (assets) = what their business owns (inventory + tools), as commentary.
// HP + Coins also show their ≈ cash value so the A·Money total isn't a mystery.
// All money figures follow the family's display-rounding setting (kid-readable).

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { DisplayRounding } from '@/lib/business';
import { formatWorth } from '@/components/business/money';
import HoneyPotIcon from './HoneyPotIcon';
import { formatHp, formatHoney, honeyToCashCents } from './format';
import HoneyCoin from './HoneyCoin';
import MeaningSheet, { type MeaningKind } from './MeaningSheet';

export default function WealthCard({
  treasuryCents, honeyCoins, housePoints, cashCents, businessAssetsCents,
  hpToHoneyRate, honeyToCashRate, currency = 'USD', fxUsdToFamily = 1, rounding = 'whole',
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
  rounding?: DisplayRounding;
}) {
  const [open, setOpen] = useState(false);
  // HIVE PR3 (Elia's ④) — tapping A·Money / B·Business opens the meaning
  // sheet: definition first, then the story that sums to the number.
  const [sheet, setSheet] = useState<MeaningKind | null>(null);
  const fx = fxUsdToFamily ?? 1;
  const money = (cents: number) => formatWorth(cents, currency, rounding);

  const coinsCents = honeyToCashCents(honeyCoins, honeyToCashRate, fx);
  const hpCoins = hpToHoneyRate > 0 ? housePoints / hpToHoneyRate : 0;
  const hpCents = honeyToCashCents(hpCoins, honeyToCashRate, fx);
  const moneyA = coinsCents + treasuryCents + cashCents + hpCents;
  const assetsB = Math.max(0, businessAssetsCents || 0);
  const total = moneyA + assetsB;

  const tiers: Array<{ icon: ReactNode; name: string; amount: string; sub?: string; def: string; pot?: boolean }> = [
    { icon: '🏅', name: 'House Points', amount: `${formatHp(housePoints)} HP`, sub: `≈ ${money(hpCents)}`, def: 'Your effort score — chores, kindness, learning, your business.' },
    { icon: <HoneyCoin size={18} />, name: 'Honey Coins', amount: `${formatHoney(honeyCoins)} HC`, sub: `≈ ${money(coinsCents)}`, def: 'Swap House Points for Honey Coins — your in-Kaya money, ready to grow.' },
    { icon: <HoneyPotIcon size={20} />, name: 'Treasury Reserve (Honey Pot)', amount: money(treasuryCents), def: 'Your spending money — earnings, sales and Coins land here. Spend straight from it (a parent says yes).', pot: true },
    { icon: '💵', name: 'Cash', amount: money(cashCents), def: 'A second pocket a parent can hand you directly. Spent after your Honey Pot.' },
  ];

  return (
    <div className="rounded-hive-lg border border-hive-line bg-hive-paper p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">💎 My Wealth</p>
          <p className="font-nunito font-black text-[30px] leading-tight mt-0.5">{money(total)}</p>
          <p className="text-[11px] text-hive-muted font-bold mt-0.5">everything you've built — money + what your business owns</p>
        </div>
        <button onClick={() => setOpen((o) => !o)} className="shrink-0 text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          {open ? 'Hide' : "What's what?"}
        </button>
      </div>

      <div className="mt-3 flex gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setSheet('money')}
          className="flex-1 bg-hive-cream rounded-hive p-2.5 text-left hover:ring-2 hover:ring-hive-honey/50 transition-shadow"
        >
          <p className="text-hive-muted font-bold">A · Money</p>
          <p className="font-nunito font-black text-[15px]">{money(moneyA)}</p>
          <p className="text-[10px] text-hive-honey-dk font-bold mt-0.5">meaning + story ›</p>
        </button>
        <button
          type="button"
          onClick={() => setSheet('business')}
          className="flex-1 bg-hive-cream rounded-hive p-2.5 text-left hover:ring-2 hover:ring-hive-honey/50 transition-shadow"
        >
          <p className="text-hive-muted font-bold">B · Business</p>
          <p className="font-nunito font-black text-[15px]">{money(assetsB)}</p>
          <p className="text-[10px] text-hive-honey-dk font-bold mt-0.5">meaning + story ›</p>
        </button>
      </div>

      {sheet && (
        <MeaningSheet
          kind={sheet}
          open
          onClose={() => setSheet(null)}
          treasuryCents={treasuryCents}
          honeyCoins={honeyCoins}
          housePoints={housePoints}
          cashCents={cashCents}
          businessAssetsCents={assetsB}
          hpToHoneyRate={hpToHoneyRate}
          honeyToCashRate={honeyToCashRate}
          fxUsdToFamily={fx}
          currency={currency}
        />
      )}

      {open && (
        <div className="mt-3 space-y-2">
          {tiers.map((t) => (
            <div key={t.name} className={`flex items-start gap-2.5 rounded-hive p-2.5 border ${t.pot ? 'border-hive-honey bg-[#FFFBEE]' : 'border-hive-line bg-white'}`}>
              <span className="text-[18px] leading-none flex items-center">{t.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-nunito font-extrabold text-[13px]">{t.name}</span>
                  <span className="text-right whitespace-nowrap">
                    <span className="font-nunito font-extrabold text-[12px] block">{t.amount}</span>
                    {t.sub && <span className="text-[10.5px] text-hive-muted font-bold block">{t.sub}</span>}
                  </span>
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
                <span className="font-nunito font-extrabold text-[12px] whitespace-nowrap">{money(assetsB)}</span>
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
