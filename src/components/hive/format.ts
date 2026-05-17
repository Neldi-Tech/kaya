'use client';

// Shared currency formatting for the Hive UI. Cents in storage → dollars in
// display, and the configured Honey ↔ Cash rate drives the "≈ $X" hints
// that show on Honey balance cards.

export function formatCash(cents: number, currency = 'USD'): string {
  const amount = cents / 100;
  // Compact: drop trailing .00 only when integer dollars, keep decimals
  // otherwise so $42.50 doesn't degrade to $42.5.
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return fmt.format(amount);
}

export function formatHoney(coins: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(coins)));
}

export function formatHp(points: number): string {
  return new Intl.NumberFormat('en-US').format(Math.max(0, Math.floor(points)));
}

/**
 * Convert a Honey amount to cents in the family's display currency.
 * Honey is USD-benchmarked, so we apply the USD-per-honey rate first,
 * then convert to the family currency at `fxUsdToFamily` (live, with
 * a 1.0 fallback that's correct for USD families and a "best effort"
 * for non-USD families when the FX fetch is still in flight).
 */
export function honeyToCashCents(
  honey: number,
  rateUsdPerHoney: number,
  fxUsdToFamily: number = 1,
): number {
  return Math.round(honey * rateUsdPerHoney * (fxUsdToFamily || 1) * 100);
}

/**
 * Round an FX-converted display value to a clean bucket scaled to the
 * currency's magnitude vs USD. Per the team rule: USD is the base,
 * converted prices snap to buckets of 0.5 / 5 / 10 / 100 / 1000.
 *
 * Picks the largest bucket that keeps the rounding error ≤ 5%. So $1
 * worth of Honey in TZS (~2,605) lands at "TSh 2,600" not the raw
 * "TSh 2,605", and in KES (~128) it lands at "KSh 130". Sub-1 values
 * keep two decimals so cents stay readable.
 *
 * Used for *display-only* values — wallet balances and settlement
 * amounts must keep their exact cents.
 */
export function roundForDisplay(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1) return Math.round(value * 100) / 100;
  const buckets = [0.5, 5, 10, 100, 1000];
  const target = value / 20; // 5% error tolerance
  let chosen = buckets[0];
  for (const b of buckets) {
    if (b <= target) chosen = b;
  }
  return Math.round(value / chosen) * chosen;
}

/**
 * Cents → family-currency string with `roundForDisplay` applied. Use
 * for FX-converted hints ("≈ TSh 2,600 if cashed out", "1 🍯 = TSh
 * 2,600"). For exact balances, settlement amounts, or anything the
 * kid will actually receive, keep using `formatCash()` so the displayed
 * number matches the underlying value to the cent.
 */
export function formatCashClean(cents: number, currency = 'USD'): string {
  const amount = cents / 100;
  const rounded = roundForDisplay(amount);
  const showDecimals = rounded > 0 && rounded < 1;
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: showDecimals ? 2 : 0,
    maximumFractionDigits: showDecimals ? 2 : 0,
  });
  return fmt.format(rounded);
}
