'use client';

// Big honey-gradient card for the Hive Home. Headline = the kid's Treasury
// Reserve (the "Honey Pot") — the earned-money pool that business sales land in
// and Coins convert into. HP, Coins, and Cash sit below as pills so the kid
// sees the whole money ladder at a glance:
//   House Points → Coins → Honey Pot (Treasury) → Cash.

import { useState } from 'react';
import Link from 'next/link';
import { formatHoney, formatCash, formatCashClean, formatHp } from './format';
import HoneyCoin from './HoneyCoin';
import HoneyPotIcon from './HoneyPotIcon';
import MeaningSheet from './MeaningSheet';

export default function HoneyPotHero({
  treasuryCents,
  honeyCoins,
  housePoints,
  minHpReserve = 0,
  cashCents,
  weeklyEarningsCents,
  cashEquivalentCents,
  currency = 'USD',
  isParent = false,
  beeBonusCents = 0,
}: {
  /** Treasury Reserve ("Honey Pot") balance, in family-currency cents. */
  treasuryCents: number;
  honeyCoins: number;
  /** Kid's current HP balance — the earning layer. */
  housePoints: number;
  /** Family's HP reserve floor; when > 0 we annotate the HP pill with the
   *  convertible balance. */
  minHpReserve?: number;
  cashCents: number;
  weeklyEarningsCents: number;
  /** Coins converted to cash at the current rate, for the "≈ $X" hint. */
  cashEquivalentCents: number;
  currency?: string;
  /** CASH UPGRADE — parents see a ＋ Deposit shortcut on the Pot card. */
  isParent?: boolean;
  /** 🐝 Bee Bonus paid in the last 7 days (0 hides the chip). */
  beeBonusCents?: number;
}) {
  const convertibleHp = Math.max(0, housePoints - minHpReserve);
  // HIVE PR3 (Elia's ④) — the Pot itself opens its meaning + story sheet.
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <div className="rounded-hive-lg p-6 text-hive-ink relative overflow-hidden bg-gradient-to-br from-[#FFE9C2] via-hive-honey-soft to-hive-honey shadow-[0_24px_48px_-24px_rgba(243,156,47,0.55)]">
      {/* Decorative blur */}
      <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/30 blur-2xl pointer-events-none" />
      <div className="relative">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-hive-honey-dk">Honey Pot <span className="opacity-70">· your bank</span></p>
          {isParent && (
            <Link
              href="/parent/hive-deposit"
              className="inline-flex items-center gap-1 bg-white/75 border border-hive-honey/40 rounded-hive-pill px-3 py-1 text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:bg-white transition-colors no-underline"
            >
              ＋ Deposit
            </Link>
          )}
        </div>
        {/* HIVEv5 PR1 — tapping the Pot (icon or amount) opens its own filtered
            statement (Elia ②: "clicking the Pot or the amount → details"). */}
        <Link href="/hive/statement?layer=treasury" className="mt-1 flex items-center gap-3 no-underline text-inherit group">
          <HoneyPotIcon size={64} className="drop-shadow-[0_4px_10px_rgba(120,70,5,0.30)] -mt-1" />
          <span className="font-nunito font-black text-[40px] leading-none group-hover:opacity-90">{formatCash(treasuryCents, currency)}</span>
          <span className="text-hive-honey-dk font-black text-lg self-center">›</span>
        </Link>
        <p className="text-[12px] text-hive-muted font-bold mt-2">
          Banked &amp; growing — sales, deposits and coins land here. Withdraw 🏧 to turn it into real cash.
        </p>
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          className="mt-2 inline-flex items-center gap-1 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk hover:bg-white transition-colors"
        >
          🍯 What&apos;s my Pot? · meaning + story ›
        </button>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk"
            title={`${formatHoney(honeyCoins)} Coins ≈ ${formatCashClean(cashEquivalentCents, currency)} if converted`}
          >
            <HoneyCoin size={15} /> {formatHoney(honeyCoins)} Coins
          </span>
          <span
            className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk"
            title={minHpReserve > 0 ? `${formatHp(housePoints)} HP total · ${formatHp(minHpReserve)} HP locked reserve · ${formatHp(convertibleHp)} HP convertible` : `${formatHp(housePoints)} HP — earn more by doing your routines and chores`}
          >
            ⭐ {formatHp(housePoints)} HP
            {minHpReserve > 0 && (
              <span className="font-bold text-hive-muted">· {formatHp(convertibleHp)} usable</span>
            )}
          </span>
          {beeBonusCents > 0 && (
            <span
              className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk"
              title="Bee Bonus — weekly interest your banked honey earned"
            >
              🐝 +{formatCash(beeBonusCents, currency)} this week
            </span>
          )}
          {weeklyEarningsCents > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-green/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-green">
              ↑ +{formatCash(weeklyEarningsCents, currency)} this week
            </span>
          )}
        </div>
      </div>

      {sheetOpen && (
        <MeaningSheet
          kind="pot"
          open
          onClose={() => setSheetOpen(false)}
          treasuryCents={treasuryCents}
          honeyCoins={honeyCoins}
          housePoints={housePoints}
          cashCents={cashCents}
          currency={currency}
        />
      )}
    </div>
  );
}
