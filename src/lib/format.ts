// Display formatters shared across the app. Keep this dependency-free
// so it can be imported from any page without dragging in Firestore
// helpers.

/** Format an integer with thousand separators — e.g. 12345 → "12,345".
 *  Used for every point/score number kids see so big totals stay
 *  readable. Negative numbers come out with a leading minus sign
 *  (Unicode hyphen-minus). Pass any finite number; non-finite falls
 *  back to "0" so we never render NaN. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  return n.toLocaleString('en-US');
}

/** Like `fmt` but always shows the sign — "+12" or "−3" — useful for
 *  delta callouts (weekly +X, derived auto-bonuses, etc.). Zero is
 *  rendered as "0" without sign. */
export function fmtSigned(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '0';
  if (n > 0) return `+${n.toLocaleString('en-US')}`;
  return n.toLocaleString('en-US');
}

/** Round a cents amount to the NEAREST "neat budget bucket" sized to
 *  the magnitude of the figure, so rolled-up totals read cleanly
 *  (TSh 4,995.90 → TSh 5,000). Bucket scale (in display units):
 *    < 1,000    → nearest 10
 *    < 100,000  → nearest 100
 *    ≥ 100,000  → nearest 1,000
 *  Rounds to nearest (not up) per the family's preference. Returns
 *  cents so callers keep passing it to formatCents. */
export function roundNeatCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  const display = cents / 100;
  let bucket: number;
  if (display < 1000) bucket = 10;
  else if (display < 100000) bucket = 100;
  else bucket = 1000;
  const bucketCents = bucket * 100;
  return Math.round(cents / bucketCents) * bucketCents;
}

/** Strip a cents amount down to whole currency units (drop the
 *  sub-unit "cents"). For zero-decimal currencies an entry like
 *  KSh 50.50 (stored 5050) becomes KSh 51 (5100). Used by the
 *  currency calibration to clean nonsensical sub-unit decimals. */
export function roundToWholeUnitCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents / 100) * 100;
}

/** Neatly round a PRICE that's already converted into the family's
 *  currency minor units, for display only.
 *
 *  DO NOT use `roundNeatCents` for prices — its fixed 10/100/1000
 *  buckets snap to the nearest $10 below $1,000, which destroys small
 *  subscription prices ($6 and $14/mo both collapse to "$10", $1–$4
 *  add-ons collapse to "$0"). This rounder scales the step to the
 *  currency's own magnitude (per the pricing-rounding rule: USD base
 *  shown exactly; converted currencies cleaned to 0.5 / 5 / 50 / 500…
 *  by magnitude), so FX conversions read cleanly (KSh 936 → KSh 950)
 *  without flattening the real price.
 *
 *  @param cents  amount in the family currency's minor units
 *  @param fx     USD→currency major-unit rate (1 for the USD base) */
export function neatPriceCents(cents: number, fx: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  // USD base (or an unknown currency that falls back to fx=1): show the
  // authored price exactly — $7.20, $16.80, $1–$4 must survive intact.
  if (!Number.isFinite(fx) || fx === 1) return Math.round(cents);
  // Step = half the order-of-magnitude of the FX rate, in minor units:
  //   EUR(0.92)→0.05  USD(1)→exact  AED(3.67)→0.50  ZAR(18.5)→5  NGN(1550)→500
  const stepMajor = Math.pow(10, Math.floor(Math.log10(fx))) / 2;
  const stepMinor = Math.max(1, Math.round(stepMajor * 100));
  const rounded = Math.round(cents / stepMinor) * stepMinor;
  // Never round a real price away to zero.
  return rounded === 0 ? stepMinor : rounded;
}
