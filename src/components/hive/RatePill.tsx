'use client';

// Tiny "100 HP = 1 🍯" pill matching the v2 design. Used on the Hive Home
// summary, on the convert screens (PR-Hive-B), and anywhere we want to
// remind the kid what the family's current rates are.
//
// Honey is benchmarked in USD on purpose (same value for every Kaya
// family, same language for every kid). The cash side of the pill
// always renders in the *family's* currency — we convert through the
// live USD-to-family rate (`fxUsdToFamily`) and apply the clean-bucket
// rounding rule so "1 🍯 ≈ TSh 2,600" rather than the raw
// "1 🍯 = TSh 2,605". For USD families fxUsdToFamily is 1 and the
// math is a no-op.

import { formatCash } from './format';

export default function RatePill({
  hpToHoneyRate,
  honeyToCashRate,
  variant = 'hp-to-honey',
  currency = 'USD',
  fxUsdToFamily = 1,
}: {
  hpToHoneyRate: number;
  /** USD per Honey Coin (Lever B). */
  honeyToCashRate: number;
  variant?: 'hp-to-honey' | 'honey-to-cash' | 'both';
  /** Family currency code, e.g. 'USD', 'TZS', 'KES'. */
  currency?: string;
  /** Live USD→family rate. Null while fetch is in flight — falls back
   *  to 1 (correct for USD, best-effort for non-USD until rates land). */
  fxUsdToFamily?: number | null;
}) {
  const fx = fxUsdToFamily ?? 1;
  // USD-per-honey × USD-to-family → family-currency-per-honey. Shown
  // EXACT (not bucket-rounded) so the rate ties out with the HP value:
  // HP × this rate = the displayed worth (transparent, no 2,585→2,600
  // drift). 2026-05-23.
  const familyPerHoneyCents = Math.round(honeyToCashRate * fx * 100);
  const cashSide = formatCash(familyPerHoneyCents, currency);

  if (variant === 'hp-to-honey') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-hive-honey-soft/60 text-hive-honey-dk px-3 py-1.5 rounded-hive-pill font-nunito font-extrabold text-[11px]">
        ⇆ {hpToHoneyRate} HP = 1 🍯
      </span>
    );
  }
  if (variant === 'honey-to-cash') {
    return (
      <span className="inline-flex items-center gap-1.5 bg-hive-honey-soft/60 text-hive-honey-dk px-3 py-1.5 rounded-hive-pill font-nunito font-extrabold text-[11px]">
        ⇆ 1 🍯 = {cashSide}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 bg-hive-honey-soft/60 text-hive-honey-dk px-3 py-1.5 rounded-hive-pill font-nunito font-extrabold text-[11px]">
      <span>⇆ {hpToHoneyRate} HP = 1 🍯</span>
      <span className="opacity-50">·</span>
      <span>1 🍯 = {cashSide}</span>
    </span>
  );
}
