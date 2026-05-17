'use client';

// Big honey-gradient card for the Hive Home — "🍯 X coins · +N this week"
// matching the section-2 mockup feel. Used at the top of /hive only.

import { formatHoney, formatCash, formatCashClean, formatHp } from './format';

export default function HoneyPotHero({
  honeyCoins,
  housePoints,
  minHpReserve = 0,
  cashCents,
  weeklyEarningsCents,
  cashEquivalentCents,
  currency = 'USD',
}: {
  honeyCoins: number;
  /** Kid's current HP balance — shown as a pill so they see both pots at
   *  once. HP is the earning layer; Honey is what HP converts into for
   *  spending. Cash only flows from Honey, never from HP directly. */
  housePoints: number;
  /** Family's HP reserve floor; when > 0 we annotate the HP pill with
   *  "min X" so the kid knows their convertible balance. */
  minHpReserve?: number;
  cashCents: number;
  weeklyEarningsCents: number;
  /** Honey converted to cash at the current rate, for the "≈ $X" hint. */
  cashEquivalentCents: number;
  currency?: string;
}) {
  // Convertible HP = whatever's above the family reserve. The kid sees
  // their full balance plus what's actually usable for HP→Honey today.
  const convertibleHp = Math.max(0, housePoints - minHpReserve);
  return (
    <div className="rounded-hive-lg p-6 text-hive-ink relative overflow-hidden bg-gradient-to-br from-[#FFE9C2] via-hive-honey-soft to-hive-honey shadow-[0_24px_48px_-24px_rgba(243,156,47,0.55)]">
      {/* Decorative blur */}
      <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-white/30 blur-2xl pointer-events-none" />
      <div className="relative">
        <p className="text-[11px] font-bold uppercase tracking-[3px] text-hive-honey-dk">The Honey Pot</p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="font-nunito font-black text-[56px] leading-none">🍯</span>
          <span className="font-nunito font-black text-[44px] leading-none">{formatHoney(honeyCoins)}</span>
          <span className="text-[13px] text-hive-muted font-bold">coins</span>
        </div>
        <p className="text-[12px] text-hive-muted font-bold mt-2">
          ≈ {formatCashClean(cashEquivalentCents, currency)} if cashed out
        </p>
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span
            className="inline-flex items-center gap-1.5 bg-white/70 border border-hive-honey/40 rounded-hive-pill px-3 py-1.5 text-[11px] font-nunito font-extrabold text-hive-honey-dk"
            title={minHpReserve > 0 ? `${formatHp(housePoints)} HP total · ${formatHp(minHpReserve)} HP locked reserve · ${formatHp(convertibleHp)} HP convertible` : `${formatHp(housePoints)} HP — earn more by doing your routines and chores`}
          >
            ⭐ {formatHp(housePoints)} HP
            {minHpReserve > 0 && (
              <span className="font-bold text-hive-muted">
                · {formatHp(convertibleHp)} usable
              </span>
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
