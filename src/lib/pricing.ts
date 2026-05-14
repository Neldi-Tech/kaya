// Price estimation for /pantry/list smart-start + templates.
//
// We don't carry a per-item price in the directory (would mean
// hand-tagging 192 items × every locale × occasional inflation
// updates). Instead this module gives a deterministic "reasonable
// number" by holding a **global retail USD baseline** per category /
// per item, and scaling to the family's local currency at the live
// USD-to-target FX rate.
//
// The list captures real prices the moment the parent edits a row
// or closes a list (existing `lastBoughtCents` flow), so the
// estimates only matter at plan time — they just need to land in
// the right magnitude so the first list a parent sees feels real.
//
// Storage: `estimatedCents` is always in minor units of the
// **family's display currency** (`hiveConfig.currency`). Display
// uses `Intl.NumberFormat` via `formatCents(cents, currency)`,
// which handles the 0-decimal currencies (TZS, JPY, …) correctly.
//
// FX is fetched live via `src/lib/fxRates.ts` (open.er-api.com,
// cached daily per base in localStorage). Callers pass the
// already-resolved `usdToTarget` rate; this module stays pure.
// When live FX is unavailable, `usdToTargetRate` falls back to a
// static table of recent-rate snapshots so the magnitude is still
// roughly right. The fallback intentionally rounds toward the
// realistic side — better a slightly stale number than a placeholder.

import type { DirectoryStaple } from './pantryDirectory';
import type { Cadence, StapleCategory } from './pantry';
import type { FxRates } from './fxRates';
import { suggestedRate } from './fxRates';

// ── USD baseline table ───────────────────────────────────────────
// Per-unit "typical retail USD" baselines, calibrated against
// moderate global supermarket prices. Multiplied by the live
// USD→target rate at call time to produce target-currency cents.
//
// All numbers are USD-cents-equivalent (so `200` means USD 2.00 worth).
// They land somewhere reasonable for both TZ (where 1 USD ≈ TSh 2,600)
// and US/EU markets (where 1 USD = 1 USD). The estimator is for
// "first list a parent sees feels real," not retail accuracy.

interface BaseUnitPrice {
  /** Per-unit baseline in USD cents (i.e., 150 = USD 1.50). The
   *  caller multiplies by usdToTarget to convert to local cents. */
  perUnitUsdCents: number;
}

const CATEGORY_DEFAULTS: Record<StapleCategory, BaseUnitPrice> = {
  produce:  { perUnitUsdCents: 150 },   // ~$1.50 per kg / bunch
  dairy:    { perUnitUsdCents: 250 },   // milk / yogurt / cheese / eggs (per L or dozen)
  pantry:   { perUnitUsdCents: 200 },   // grains, flour, oil, spices — avg
  cleaning: { perUnitUsdCents: 350 },   // soaps, detergents
  personal: { perUnitUsdCents: 400 },   // hygiene + grooming
  other:    { perUnitUsdCents: 500 },   // gas, batteries, misc
};

// ── Per-unit overrides ───────────────────────────────────────────
// Items where the category average is wildly off. Keyed by
// lowercased staple label so adding a new staple doesn't break the
// table. All values in USD cents (per the unit declared on the
// directory staple — usually per kg, per L, or per pack).

const UNIT_OVERRIDES: Record<string, number> = {
  // ── Meat / fish (premium) ──
  'chicken':                 400,   // $4 / kg — TZ ~$3-4, US ~$4-6
  'beef':                    600,   // $6 / kg
  'goat meat':               700,
  'fish (tilapia)':          350,
  'prawns':                 1500,
  'sausages':                500,

  // ── Energy / fuel (one big-ticket item) ──
  'cooking gas refill':     1500,   // $15 / refill (6kg bottle TZ ≈ TSh 38k)
  'firewood':                300,
  'charcoal':                250,

  // ── Baby items (pricier per pack) ──
  'diapers':                1500,   // pack
  'baby formula':           2500,
  'baby wipes':              400,
  'baby lotion':             500,

  // ── Long-life staples sold by kg / litre ──
  'rice (white)':            130,   // ~$1.30 / kg — TZ ~TSh 3.4k, fair
  'basmati rice':            250,
  'maize flour (ugali)':      80,   // ~$0.80 / kg
  'wheat flour':             100,
  'atta / chapati flour':    120,
  'cooking oil':             400,   // ~$4 / L
  'olive oil':               700,
  'sugar':                   100,
  'salt':                     50,
  'tea':                     250,
  'coffee':                  500,

  // ── Dairy specifics ──
  'milk':                    200,   // per L
  'uht milk':                250,
  'eggs':                    250,   // per dozen
  'yogurt':                  300,
  'butter':                  400,
  'cheese':                  500,
  'paneer':                  600,
  'ghee':                    800,
  'cream':                   400,

  // ── Pantry specifics ──
  'beans (dry)':             200,
  'lentils':                 250,
  'toor dal':                300,
  'moong dal':               300,
  'pasta':                   200,
  'noodles':                 150,
  'bread':                   200,
  'tomato paste':            150,
  'stock cubes':             150,
  'coconut milk':            200,
  'pilau masala':            200,
  'garam masala':            300,
  'mustard seeds':           200,
  'coriander (dhania)':      100,
  'spices · curry powder':   200,
  'spices · black pepper':   400,

  // ── Produce specifics (per kg unless tiny) ──
  'tomatoes':                100,
  'onions':                  100,
  'potatoes':                100,
  'garlic':                  200,
  'lemons':                  150,
  'carrots':                 100,
  'cabbage':                  80,
  'spinach':                 100,
  'kale (sukuma wiki)':       80,
  'plantain (matoke)':       100,
  'bananas':                 100,
  'apples':                  250,
  'avocados':                200,
  'cucumber':                100,
  'bell peppers':            200,
  'mangoes':                 150,
  'oranges':                 150,
  'watermelon':              100,
  'passion fruit':           300,

  // ── Cleaning / household ──
  'dish soap':               300,
  'laundry detergent':       500,
  'toilet paper':            350,   // pack
  'bin liners':              250,
  'sponges':                 200,
  'paper towels':            400,
  'fabric softener':         400,
  'toilet cleaner':          400,
  'light bulbs':             300,
  'batteries (aa)':          400,

  // ── Personal care ──
  'bar soap':                100,
  'toothpaste':              300,
  'toothbrush':              200,
  'shampoo':                 500,
  'body lotion':             400,
  'deodorant':               400,
  'sanitary pads':           400,
  'hand sanitiser':          300,
  'painkillers':             400,
  'first-aid plasters':      300,

  // ── Other ──
  'pet food':                500,
  'cereal':                  400,
  'oats':                    300,
};

// ── Static USD→target snapshot (fallback only) ─────────────────────
// Used when live FX is unavailable (network blocked, first ever
// page load offline, etc.). Updated periodically — current as of
// May 2026. Live `fxRates.ts` lookups always win when available.

const STATIC_USD_TO_TARGET: Record<string, number> = {
  USD: 1,
  // Europe
  EUR: 0.93,  GBP: 0.79,  CHF: 0.90,  SEK: 10.5,  NOK: 10.5,  DKK: 6.9,
  // East / Sub-Saharan Africa
  TZS: 2600,  KES: 130,   UGX: 3700,  RWF: 1300,  ETB: 56,    ZAR: 18,
  NGN: 1500,  GHS: 12,    XOF: 605,   XAF: 605,
  // Middle East / North Africa
  AED: 3.67,  SAR: 3.75,  EGP: 49,    MAD: 9.8,   QAR: 3.64,  BHD: 0.38,
  // South / Southeast Asia
  INR: 83,    PKR: 280,   BDT: 110,   LKR: 305,
  IDR: 16000, MYR: 4.5,   THB: 35,    PHP: 56,    VND: 25000, SGD: 1.35,
  // Asia-Pacific
  JPY: 150,   KRW: 1370,  CNY: 7.2,   HKD: 7.8,   TWD: 32,
  AUD: 1.5,   NZD: 1.6,   CAD: 1.35,
  // Latin America
  MXN: 18,    BRL: 5.1,   ARS: 1000,  COP: 4100,  CLP: 950,   PEN: 3.7,
};

/** Resolve the live USD→target rate, falling back to the static
 *  snapshot if FX is unavailable. Always returns a positive number;
 *  unknown currencies fall back to 1 (treat as USD). */
export function usdToTargetRate(
  targetCurrency: string,
  liveRates?: FxRates | null,
): number {
  if (liveRates) {
    const live = suggestedRate(liveRates, 'USD', targetCurrency);
    if (live && live > 0) return live;
  }
  return STATIC_USD_TO_TARGET[targetCurrency] ?? 1;
}

// ── Public API ───────────────────────────────────────────────────

/** Best-effort "what would a parent expect to pay" estimate for
 *  one unit of the staple, in the family's local currency minor
 *  unit. `usdToTarget` is the live USD→family-currency rate from
 *  `fxRates`; pass `1` for USD families. */
export function estimateUnitPriceCents(
  staple: DirectoryStaple,
  usdToTarget = 1,
): number {
  const key = staple.label.toLowerCase();
  const baseUsdCents = UNIT_OVERRIDES[key] ?? CATEGORY_DEFAULTS[staple.category].perUnitUsdCents;
  return Math.round(baseUsdCents * usdToTarget);
}

/** Total line-item estimate = unit price × qty, rounded to keep
 *  the list readable (no "TSh 1,237"). For currencies with high
 *  magnitude (TZS, IDR, VND) we round to the nearest 100;
 *  otherwise to the nearest 10 minor units. */
export function estimateLineCents(
  staple: DirectoryStaple,
  qty: number,
  usdToTarget = 1,
): number {
  const raw = estimateUnitPriceCents(staple, usdToTarget) * Math.max(1, qty);
  // High-magnitude currencies (rate > 50) get coarser rounding.
  const roundTo = usdToTarget > 50 ? 100 : 10;
  return Math.round(raw / roundTo) * roundTo;
}

/** Lifestyle multipliers — drive the smart-start's "lean /
 *  standard / generous" budget tier. */
export const BUDGET_MULT: Record<'lean' | 'standard' | 'generous', number> = {
  lean:     0.8,
  standard: 1.0,
  generous: 1.4,
};

/** Cadence-to-multiplier — if a list represents a month not a
 *  week, the same item needs more qty. Used by the generator when
 *  the parent picks monthly cadence. */
export const CADENCE_MULT: Record<Cadence, number> = {
  daily:      0.2,
  weekly:     1,
  biweekly:   2,
  monthly:    4,
  'as-needed': 0,
};
