// Price estimation for /pantry/list smart-start + templates.
//
// We don't carry a per-item price in the directory (would mean
// hand-tagging 192 items × 3 regions × occasional inflation
// updates). Instead this module gives a deterministic "reasonable
// number" based on the staple's `category` + the household's
// region, so the first list a parent sees feels real with numbers
// rather than empty TSh placeholders.
//
// Numbers are intentionally coarse — the goal is "good first
// estimate", not retail accuracy. The list captures real prices as
// soon as the parent edits a row or closes a list (existing
// lastBoughtCents flow), so the estimates only matter at plan
// time.
//
// Currency is the family's display currency from HiveConfig today
// (TSh / KSh / USD / etc.); the cents value here is in the family's
// currency-minor-units. Conversion between currencies happens
// downstream — this module produces a single "local cents" number
// per item.

import type { DirectoryStaple } from './pantryDirectory';
import type { Region } from './pantryDirectory';
import type { Cadence, StapleCategory } from './pantry';

// ── Base price table ─────────────────────────────────────────────
// Per-unit "typical retail" rounded to the nearest 100 minor units
// (so TSh 2,400 not TSh 2,378). Calibrated for a normal supermarket
// run, not bulk wholesale. The regional multipliers below scale.

interface BaseUnitPrice {
  /** Per-unit baseline price in USD cents (Global region). The
   *  region multiplier converts to the family's local currency
   *  minor unit. */
  perUnitCentsGlobal: number;
}

const CATEGORY_DEFAULTS: Record<StapleCategory, BaseUnitPrice> = {
  produce:  { perUnitCentsGlobal: 200 },   // ~$2 / kg or bunch
  dairy:    { perUnitCentsGlobal: 350 },   // milk / cheese / eggs
  pantry:   { perUnitCentsGlobal: 250 },   // grains, flour, oil, spices
  cleaning: { perUnitCentsGlobal: 400 },   // soaps, detergents
  personal: { perUnitCentsGlobal: 450 },   // hygiene + grooming
  other:    { perUnitCentsGlobal: 600 },   // gas, batteries, misc
};

// ── Per-unit overrides ───────────────────────────────────────────
// Some items have wildly different price/unit than the category
// average. Keyed by lowercased label so adding a new staple
// doesn't break the table.

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

// ── Region multipliers ───────────────────────────────────────────
// Rough scalars so the same baseline number renders in the right
// magnitude. The display currency is decided by HiveConfig — we
// only scale magnitude here.
//
//   global:      USD-ish     · cents = USD¢
//   east-africa: TSh / KSh   · ~150x USD cents (≈ $1 ≈ TSh 150 ?  use 100x for a rough TSh)
//   south-asia:  INR / NPR   · ~80x USD cents

const REGION_MULT: Record<Region | 'any', number> = {
  'global':      1,
  'east-africa': 250,   // dollars * 250 → roughly TSh for that dollar
  'south-asia':  85,    // dollars * 85  → roughly INR for that dollar
  'any':         1,
};

// ── Public API ───────────────────────────────────────────────────

/** Best-effort "what would a parent expect to pay" estimate for one
 *  unit of the staple, in the family's local currency minor unit
 *  (cents-equivalent). Multiply by `qty` at the call site. */
export function estimateUnitPriceCents(staple: DirectoryStaple, region: Region | 'any' = 'any'): number {
  const key = staple.label.toLowerCase();
  const baseGlobal = UNIT_OVERRIDES[key] ?? CATEGORY_DEFAULTS[staple.category].perUnitCentsGlobal;
  const mult = REGION_MULT[region] ?? 1;
  return Math.round(baseGlobal * mult);
}

/** Total line-item estimate = unit price × qty, rounded to a clean
 *  number to keep the list readable (no "TSh 1,237.45"). */
export function estimateLineCents(staple: DirectoryStaple, qty: number, region: Region | 'any' = 'any'): number {
  const raw = estimateUnitPriceCents(staple, region) * Math.max(1, qty);
  // Round to nearest 100 minor units so the list reads cleanly.
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
