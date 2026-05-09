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
