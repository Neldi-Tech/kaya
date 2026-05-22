// Kaya Business · worth/value display rounding. Big "how much am I worth"
// numbers get hard for kids to read at full precision (e.g. $500,114.20), so
// the parent picks a rounding style (config.displayRounding) and we apply it
// to worth/value displays only. Transaction amounts (prices, sales, costs,
// buys) always use exact formatCash — rounding them would lose meaning.

import { formatCash } from '@/components/hive/format';
import { DisplayRounding } from '@/lib/business';

/** Round a cents amount to the chosen display granularity. */
export function roundWorthCents(cents: number, mode: DisplayRounding): number {
  if (mode === 'exact') return cents;
  const unitCents = mode === 'whole' ? 100 : mode === 'ten' ? 1000 : 10000; // 1 / 10 / 100 units
  return Math.round(cents / unitCents) * unitCents;
}

/** Format a worth/value amount with the family's chosen rounding. Rounded modes
 *  land on whole units, so formatCash naturally shows no decimals; 'exact'
 *  keeps cents. */
export function formatWorth(cents: number, currency: string, mode: DisplayRounding = 'whole'): string {
  return formatCash(roundWorthCents(cents, mode), currency);
}

/** Short human label for each mode (settings UI + previews). */
export const ROUNDING_LABEL: Record<DisplayRounding, string> = {
  exact: 'Exact',
  whole: 'Whole',
  ten: 'Round 10',
  hundred: 'Round 100',
};
