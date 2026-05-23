'use client';

// Big honey-gradient card for the Hive Home. Headline = the kid's Treasury
// Reserve (the "Honey Pot") — the earned-money pool that business sales land in
// and Coins convert into. HP, Coins, and Cash sit below as pills so the kid
// sees the whole money ladder at a glance:
//   House Points → Coins → Honey Pot (Treasury) → Cash.

import { formatHoney, formatCash, formatCashClean, formatHp } from './format';

export default function HoneyPotHero({
  treasuryCents,
  honeyCoins,
  housePoints,
  minHpReserve = 0,
  cashCents,
  weeklyEarningsCents,
  cashEquivalentCents,
  currency = 'USD',
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
}) {
  const convertibleHp = Math.max(0, housePoints - minHpReserve);
  return (
    <div className="rounded-hive-lg p-6 text-hive-ink relative overflow-hidden bg-gradient-to-br from-[#FFE9C2] via-hive-honey-soft to-hive-honey shadow-[0_24px_48px_-24px_rgba(243,156,47,0.55)]">
      {/* Decorative blur */}
      <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/30 blur-2xl pointer-events-none" />
      <div className="relative">
        <p className="text-[11px] font-bold uppercase tracking-[3px] text-hive-honey-dk">The Honey Pot · Treasury Reserve</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-nunito font-black text-[52px] leading-none">🍯</span>
          <span className="font-nunito font-black text-[40px] leading-none">{formatCash(treasuryCents, currency)}</span>
        </div>
        <p className="text-[12px] text-hive-muted font-bold mt-2">
          Your business pot — sales land here. A parent turns it into Cash.
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk"
            title={`${formatHoney(honeyCoins)} Coins ≈ ${formatCashClean(cashEquivalentCents, currency)} if converted`}
          >
            🪙 {formatHoney(honeyCoins)} Coins
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
          <span className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk">
            ⚡ Cash {formatCash(cashCents, currency)}
          </span>
          {weeklyEarningsCents > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-green/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-green">
              ↑ +{formatCash(weeklyEarningsCents, currency)} this week
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
