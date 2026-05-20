// Cents → display string for the Pantry. Cents storage matches the rest
// of Kaya so the same `Intl.NumberFormat({ style: 'currency' })` works.
// Currency comes from the family-wide Hive config (parents already
// picked one) — for Phase 1A we just read it via useHive.

import { currencyDecimals } from '@/lib/hive';
import { roundNeatCents } from '@/lib/format';

export function formatCents(cents: number, currency = 'USD'): string {
  const dec = currencyDecimals(currency);
  const amount = cents / 100;
  // Zero-decimal currencies (KES, TZS…) never show a fractional part;
  // "cents" ones drop the ".00" when the amount is whole.
  const maxFrac = dec === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: dec === 0 || amount % 1 === 0 ? 0 : 2,
    maximumFractionDigits: maxFrac,
  }).format(amount);
}

/** Convenience: formatCents(roundNeatCents(cents), currency). For
 *  callers that always want a budget-neat rolled-up display string.
 *  Rounds to the NEAREST neat bucket (10/100/1000 by magnitude) so
 *  messy precise totals (TSh 4,995.90) read cleanly (TSh 5,000).
 *  (2026-05-20 — family preference: nearest, not always-up.) */
export function formatCentsBudgetNeat(cents: number, currency = 'USD'): string {
  return formatCents(roundNeatCents(cents), currency);
}
