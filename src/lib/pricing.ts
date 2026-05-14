// Price estimation for the Pantry directory + /pantry/list
// smart-start + templates.
//
// We don't carry a per-item price in the directory (would mean
// hand-tagging 192 items and re-touching them on every inflation
// tick). Instead this module gives a deterministic "reasonable
// number" from the staple's `category` + a small per-item override
// table — a USD baseline — then converts it into the family's
// actual display currency using a real exchange rate.
//
// Numbers are intentionally coarse — the goal is "good first
// estimate", not retail accuracy. The list captures real prices as
// soon as the parent edits a row or closes a list, so the estimates
// only matter at plan time. The conversion does respect the
// family's currency though: a TZS family sees TSh-scale numbers,
// an INR family sees ₹-scale numbers, a USD family sees dollars —
// using the FX table below rather than a crude region guess.

import type { DirectoryStaple } from './pantryDirectory';
import type { Cadence, StapleCategory } from './pantry';

// ── Base price table ─────────────────────────────────────────────
// Per-unit "typical retail" baseline in USD cents. Calibrated for a
// normal supermarket run, not bulk wholesale. The FX table converts
// to the family's currency.

interface BaseUnitPrice {
  /** Per-unit baseline price in USD cents. */
  perUnitCentsUsd: number;
}

const CATEGORY_DEFAULTS: Record<StapleCategory, BaseUnitPrice> = {
  produce:  { perUnitCentsUsd: 200 },   // ~$2 / kg or bunch
  dairy:    { perUnitCentsUsd: 350 },   // milk / cheese / eggs
  pantry:   { perUnitCentsUsd: 250 },   // grains, flour, oil, spices
  cleaning: { perUnitCentsUsd: 400 },   // soaps, detergents
  personal: { perUnitCentsUsd: 450 },   // hygiene + grooming
  other:    { perUnitCentsUsd: 600 },   // gas, batteries, misc
};

// ── Per-unit overrides ───────────────────────────────────────────
// Some items have wildly different price/unit than the category
// average. USD cents, keyed by lowercased label.

const UNIT_OVERRIDES: Record<string, number> = {
  // Meat / fish (premium)
  'chicken':                 800,
  'beef':                   1200,
  'goat meat':              1500,
  'fish (tilapia)':          900,
  'prawns':                 1800,
  'sausages':                500,
  // Cooking gas (one big item)
  'cooking gas refill':     3000,
  'firewood':                500,
  'charcoal':                400,
  // Baby items (pricier per pack)
  'diapers':                1200,
  'baby formula':           1500,
  'baby wipes':              400,
  // Long-life staples sold in big bags
  'rice (white)':            300,
  'basmati rice':            400,
  'maize flour (ugali)':     200,
  'cooking oil':             400,
  // Premium dairy
  'paneer':                  500,
  'ghee':                    700,
};

// ── USD → family-currency exchange rates ─────────────────────────
// Covers every currency in the HiveConfig CURRENCIES catalog. These
// are coarse, hand-maintained mid-rates — a budget *estimate*, not a
// forex feed — but they mean a Tanzanian family sees realistic
// TSh-scale numbers instead of the old "region × 250" guess that
// ignored which currency the family actually uses.
//
// Maintenance note: bump these when a rate drifts a lot. They only
// affect the *initial* estimate; once a parent edits a price or
// closes a list, the real number takes over.
const USD_FX: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  TZS: 2650,
  KES: 129,
  UGX: 3700,
  ZAR: 18.5,
  NGN: 1550,
  AED: 3.67,
  INR: 83,
  CAD: 1.37,
  AUD: 1.52,
};

/** USD → `currency` rate. Unknown / missing codes fall back to 1
 *  (treat as USD) so a new currency never crashes the estimator. */
export function usdFxRate(currency: string | undefined): number {
  if (!currency) return 1;
  return USD_FX[currency] ?? 1;
}

// ── Public API ───────────────────────────────────────────────────

/** Best-effort "what would a parent expect to pay" estimate for one
 *  unit of the staple, in the family's currency MINOR units (cents-
 *  equivalent). Multiply by `qty` at the call site.
 *
 *  The math lines up cleanly: a USD-cents baseline × the USD→target
 *  major-unit rate already lands in target minor units, because
 *  `USDcents × (targetMajor / USDmajor) = targetMajor × 100 =
 *  targetMinor`. So 200 USD¢ ($2) at TZS 2650/USD → 530000 (TSh
 *  5,300). */
export function estimateUnitPriceCents(staple: DirectoryStaple, currency: string = 'USD'): number {
  const key = staple.label.toLowerCase();
  const baseUsdCents = UNIT_OVERRIDES[key] ?? CATEGORY_DEFAULTS[staple.category].perUnitCentsUsd;
  return Math.round(baseUsdCents * usdFxRate(currency));
}

/** Total line-item estimate = unit price × qty, rounded to a clean
 *  number to keep the list readable (no "TSh 1,237.45"). */
export function estimateLineCents(staple: DirectoryStaple, qty: number, currency: string = 'USD'): number {
  const raw = estimateUnitPriceCents(staple, currency) * Math.max(1, qty);
  // Round to the nearest 100 minor units so the list reads cleanly.
  return Math.round(raw / 100) * 100;
}

/** Lifestyle multipliers applied on top of the size scaling — drive
 *  the smart-start's "lean / standard / generous" budget tier. */
export const BUDGET_MULT: Record<'lean' | 'standard' | 'generous', number> = {
  lean:     0.8,
  standard: 1.0,
  generous: 1.4,
};

/** Cadence-to-multiplier — if a list represents a month not a week,
 *  the same item needs more qty. Used by the generator when the
 *  parent picks monthly cadence. */
export const CADENCE_MULT: Record<Cadence, number> = {
  daily:      0.2,
  weekly:     1,
  biweekly:   2,
  monthly:    4,
  'as-needed': 0,
};
