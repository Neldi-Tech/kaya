// HP2 (Helper Performance 2.0, 2026-08-23) — the parent's helper-email
// frequency, shared by Settings → Notifications and the crons.
//
//   users/{uid}.perfDigest: 'off' | 'weekly' | 'daily'
//
// Legacy mapping (D7 + Q1 — weekly is ON by default for every parent):
//   perfDigestEmail === true  → 'weekly'  (they wanted helper emails)
//   perfDigestEmail === false → 'off'     (they explicitly turned it off)
//   absent                    → 'weekly'
// `perfDigestEmail` is still written by the settings UI (true only for
// 'daily') so older readers keep a consistent view.

export type PerfDigestFreq = 'off' | 'weekly' | 'daily';

export function resolvePerfDigest(
  d: { perfDigest?: string; perfDigestEmail?: boolean } | undefined | null,
): PerfDigestFreq {
  if (d?.perfDigest === 'off' || d?.perfDigest === 'weekly' || d?.perfDigest === 'daily') return d.perfDigest;
  if (d?.perfDigestEmail === true) return 'weekly';
  if (d?.perfDigestEmail === false) return 'off';
  return 'weekly';
}
