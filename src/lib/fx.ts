// Household · FX helper for Subscriptions + Contributions.
//
// Thin wrapper around lib/fxRates.ts that adds the "lock at entry"
// convention these modules need: when a user writes an entry in TZS but
// the family currency is USD, the entry stores BOTH amount_original
// (TZS) and amount_household (USD), with the FX rate at write-time
// frozen on the entry. Re-conversion is never retroactive.

import { fetchFxRates, suggestedRate, type FxRates } from './fxRates';

/** Resolve an FX multiplier from `sourceCurrency` to `targetCurrency`.
 *  Returns 1 when source === target. Returns null when rates cannot
 *  be fetched and source !== target (caller should show "FX unknown,
 *  enter manually"). Cached + memoised per (base, date) by fxRates.ts. */
export async function resolveFxRate(
  sourceCurrency: string,
  targetCurrency: string,
): Promise<number | null> {
  if (sourceCurrency === targetCurrency) return 1;
  const rates: FxRates | null = await fetchFxRates(sourceCurrency);
  if (!rates) return null;
  return suggestedRate(rates, sourceCurrency, targetCurrency);
}

/** Convert `amountOriginalCents` to the target currency using the
 *  passed FX rate, returning the household-currency cents amount.
 *  Pure math — no network. Use after the rate is resolved + locked
 *  on the form. */
export function applyFxRate(amountOriginalCents: number, fxRate: number): number {
  return Math.round(amountOriginalCents * fxRate);
}

/** Compact list of supported currencies for the picker. Add as needed —
 *  Kaya's footprint is global so this can grow. Same set used by hive
 *  payment-method labels. */
export const SUPPORTED_CURRENCIES: { code: string; label: string }[] = [
  { code: 'TZS', label: 'TZS · Tanzanian Shilling' },
  { code: 'KES', label: 'KES · Kenyan Shilling' },
  { code: 'UGX', label: 'UGX · Ugandan Shilling' },
  { code: 'RWF', label: 'RWF · Rwandan Franc' },
  { code: 'USD', label: 'USD · US Dollar' },
  { code: 'EUR', label: 'EUR · Euro' },
  { code: 'GBP', label: 'GBP · British Pound' },
  { code: 'AED', label: 'AED · UAE Dirham' },
  { code: 'INR', label: 'INR · Indian Rupee' },
  { code: 'ZAR', label: 'ZAR · South African Rand' },
];
