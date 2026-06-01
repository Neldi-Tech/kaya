// Kaya Wealth · presentational formatters (Phase 1 · 2026-06-01).
// Pure, dependency-light helpers for the hero headline + edit-log dates,
// matching the approved mockup's number style.

import type { Timestamp } from 'firebase/firestore';
import { toDisplayDate } from '@/lib/dates';
import type { AssetClassId, Liquidity } from '@/lib/wealth';

/** 'USD' → 'US$', everything else shows its ISO code (the mockup style). */
export function curLabel(code: string): string {
  return code === 'USD' ? 'US$' : code;
}

export interface CompactParts { value: string; unit: string }

/** Compact a MAJOR-unit amount into { value, unit } the way the mockup hero
 *  does — 2_840_000_000 → { '2.84', 'B' }, 486_000_000 → { '486', 'M' }. */
export function compactMajor(major: number): CompactParts {
  const m = Math.abs(major);
  if (m >= 1e9) return { value: (major / 1e9).toFixed(2), unit: 'B' };
  if (m >= 1e6) { const v = major / 1e6; return { value: v < 10 ? v.toFixed(1) : Math.round(v).toString(), unit: 'M' }; }
  if (m >= 1e3) return { value: Math.round(major / 1e3).toString(), unit: 'K' };
  return { value: Math.round(major).toString(), unit: '' };
}

export function compactCents(cents: number): CompactParts {
  return compactMajor(cents / 100);
}

/** Indicative KC (Kaya Coin) detail line only (Concept Note §13) — pegged
 *  to the USD benchmark at an indicative rate until KC has a real peg.
 *  Figures are illustrative. */
const KC_PER_USD = 0.26;
export function kcFromUsdCents(usdCents: number | null): number {
  if (usdCents == null || !Number.isFinite(usdCents)) return 0;
  return Math.round((usdCents / 100) * KC_PER_USD);
}

/** Firestore Timestamp → 'YYYY-MM-DD' in LOCAL time (Kaya users are
 *  worldwide — never derive the calendar day in UTC). */
export function tsToIsoDate(ts: Timestamp | null | undefined): string {
  const d = ts?.toDate?.();
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Timestamp → 'DD-Mmm-YYYY' (the app-wide display format). */
export function tsToDisplay(ts: Timestamp | null | undefined): string {
  return toDisplayDate(tsToIsoDate(ts));
}

/** Asset class → the mockup's icon-tile background utility class. */
export const CLASS_ICON_BG: Record<AssetClassId, string> = {
  cash: 'i-cash', public_markets: 'i-stk', private_alt: 'i-biz',
  real_estate: 'i-home', retirement: 'i-pen', vehicles: 'i-home',
  valuables: 'i-biz', receivables: 'i-fin', insurance: 'i-fin',
  digital: 'i-stk', liabilities: 'i-pen',
};

/** Liquidity → the mockup's liquidity-pill style (high / mid / low). */
export function liqPillClass(liq: Liquidity): 'high' | 'mid' | 'low' {
  if (liq === 'high') return 'high';
  if (liq === 'medium' || liq === 'varies') return 'mid';
  return 'low';
}
