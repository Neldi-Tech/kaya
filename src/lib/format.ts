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
