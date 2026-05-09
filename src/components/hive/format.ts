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
