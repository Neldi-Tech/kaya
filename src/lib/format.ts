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
