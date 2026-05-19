// Cents → display string for the Pantry. Cents storage matches the rest
// of Kaya so the same `Intl.NumberFormat({ style: 'currency' })` works.
// Currency comes from the family-wide Hive config (parents already
// picked one) — for Phase 1A we just read it via useHive.

export function formatCents(cents: number, currency = 'USD'): string {
  const amount = cents / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Round a cents amount UP to a "neat budget bucket" sized to the
 *  magnitude of the figure. Used for budget displays where messy
 *  precise totals (TZS 47,832.50) make the number hard to scan against
 *  caps and forecasts. (2026-05-19 — Elia: "round up totals in the
 *  nearest 100 depending on amounts to make the budget neat.")
 *
 *  Bucket scale (in display units, not cents):
 *    < 1,000        → nearest 10
 *    < 100,000      → nearest 100
 *    ≥ 100,000      → nearest 1,000
 *
 *  Always rounds UP (Math.ceil) so the displayed figure is never
 *  lower than reality — a safer signal for budget projection.
 *  Returns cents so callers can keep passing it to formatCents. */
export function roundUpDisplay(cents: number): number {
  if (cents <= 0) return 0;
  const display = cents / 100;
  let bucketDisplay: number;
  if (display < 1000) bucketDisplay = 10;
  else if (display < 100000) bucketDisplay = 100;
  else bucketDisplay = 1000;
  const bucketCents = bucketDisplay * 100;
  return Math.ceil(cents / bucketCents) * bucketCents;
}

/** Convenience: formatCents(roundUpDisplay(cents), currency). For
 *  callers that always want a budget-neat display string. */
export function formatCentsBudgetNeat(cents: number, currency = 'USD'): string {
  return formatCents(roundUpDisplay(cents), currency);
}
