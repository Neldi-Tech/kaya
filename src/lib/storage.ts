// Storage usage helpers — pure (no firebase). Safe to import from any
// component / page / server route.
//
// Per-family Firebase Storage caps. Effective cap = tier base + family
// extra-GB top-up. UI never shows our raw cost; Castle shows "Plenty of
// room" instead of a hard number so the cap feels infinite to those
// families.

import type { TierConfig } from './tiers';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const KB = 1024;

/** Resolve a family's effective storage cap in BYTES. Sums the tier's
 *  base storageGB plus any operator-granted extraGB top-up.
 *  Founding families are bypassed at the call site — don't gate them
 *  here. */
export function tierCapBytes(tier: TierConfig, extraGB: number = 0): number {
  const totalGB = tier.storageGB + (Number.isFinite(extraGB) ? Math.max(0, extraGB) : 0);
  return Math.round(totalGB * GB);
}

/** Used / cap as a 0–100 percent (clamped). */
export function usagePercent(usedBytes: number, capBytes: number): number {
  if (!Number.isFinite(usedBytes) || !Number.isFinite(capBytes) || capBytes <= 0) return 0;
  const raw = (usedBytes / capBytes) * 100;
  return Math.max(0, Math.min(100, raw));
}

/** Bar colour: green < 80 %, amber 80–99 %, red ≥ 100 %. Returns the
 *  semantic name; pages map it to brand colours. */
export type UsageState = 'fine' | 'warning' | 'over';
export function usageState(pct: number): UsageState {
  if (pct >= 100) return 'over';
  if (pct >= 80)  return 'warning';
  return 'fine';
}

/** Format a byte count for display. Single decimal place above MB
 *  ("4.2 GB"); whole MB below ("420 MB"); whole KB below ("12 KB").
 *  Zero / NaN renders "0 MB" to keep the bar legible. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  if (bytes >= GB) {
    const v = bytes / GB;
    return `${v >= 10 ? v.toFixed(0) : v.toFixed(1)} GB`;
  }
  if (bytes >= MB) {
    return `${Math.round(bytes / MB)} MB`;
  }
  if (bytes >= KB) {
    return `${Math.round(bytes / KB)} KB`;
  }
  return `${bytes} B`;
}

/** Castle gets a friendlier copy than the raw GB cap so the impression
 *  stays "you have plenty of room" rather than a hard number. Used by
 *  the /settings/subscription banner. */
export function capCopy(tierId: string, capBytes: number, isFoundingBypass: boolean): string {
  if (isFoundingBypass) return 'Founding family — uncapped';
  if (tierId === 'castle') return 'Plenty of room';
  return formatBytes(capBytes);
}
