// Rule-based "smart-start" list generator for /pantry/list/new.
//
// Takes a SmartStartPrefs and returns a curated GroceryListItem[]
// pulled from DIRECTORY_STAPLES. Deterministic-feeling: same
// preferences → same list (no randomness), so a parent who tweaks
// the form sees the list react predictably.
//
// Decisions live here (not in the UI page) so a future Claude-API
// "refine with AI" pass can take this output as a starting point
// rather than the model building from scratch.

import {
  DIRECTORY_STAPLES,
  type DirectoryStaple,
  type Region,
  type Diet,
} from './pantryDirectory';
import {
  estimateLineCents,
  BUDGET_MULT,
  CADENCE_MULT,
} from './pricing';
import type { GroceryListItem, Cadence } from './pantry';

// ── Inputs ───────────────────────────────────────────────────────

export type HouseholdSize = 'solo' | 'family' | 'big';
export type HouseholdType = 'apartment' | 'house' | 'shared';
export type Lifestyle    = 'mixed' | 'veg' | 'vegan' | 'halal';
export type Budget       = 'lean' | 'standard' | 'generous';
export type SpecialNeed  = 'baby' | 'pet' | 'elderly';

export interface SmartStartPrefs {
  size: HouseholdSize;
  household: HouseholdType;
  region: Region | 'any';
  /** Free-text city — display only today; passed back to the list
   *  so the WhatsApp message can include "Run for Nairobi" later. */
  city?: string;
  lifestyle: Lifestyle;
  /** Tap any that apply — these gate inclusion of baby/pet items. */
  special: SpecialNeed[];
  budget: Budget;
  cadence: Cadence;
}

// ── Diet filter ──────────────────────────────────────────────────

// Items that get filtered out when the parent picks veg / vegan.
// Halal doesn't filter anything from the staples (it's about the
// meat sourcing, not the absence of meat).
const NON_VEG_LABELS = new Set([
  'Chicken','Beef','Goat meat','Fish (tilapia)','Prawns','Sausages',
]);
const NON_VEGAN_LABELS = new Set([
  ...Array.from(NON_VEG_LABELS),
  'Milk','UHT milk','Yogurt','Butter','Cheese','Paneer','Cream','Eggs','Ghee',
]);

// ── Size → qty multiplier ────────────────────────────────────────

const SIZE_MULT: Record<HouseholdSize, number> = {
  solo:   0.6,
  family: 1.0,
  big:    1.5,
};

// ── Base picks ───────────────────────────────────────────────────
// Every list starts with this curated essentials core; the
// preferences gate which items get added on top.

const ESSENTIAL_LABELS = [
  // food · daily / weekly
  'Rice (white)', 'Wheat flour', 'Cooking oil', 'Sugar', 'Salt',
  'Onions', 'Tomatoes', 'Potatoes', 'Garlic', 'Lemons',
  'Milk', 'Eggs', 'Bread', 'Tea', 'Coffee',
  // household · monthly
  'Dish soap', 'Laundry detergent', 'Toilet paper',
  'Bar soap', 'Toothpaste', 'Shampoo',
  'Bin liners', 'Cooking gas refill',
];

const FAMILY_EXTRAS = [
  'Carrots', 'Cabbage', 'Spinach', 'Bananas', 'Apples', 'Avocados',
  'Chicken', 'Beef',
  'Pasta', 'Beans (dry)', 'Lentils', 'Tomato paste', 'Stock cubes',
  'Butter', 'Yogurt', 'Cheese',
  'Toothbrush', 'Body lotion', 'Deodorant', 'Sanitary pads',
  'Sponges', 'Paper towels',
];

const BIG_EXTRAS = [
  ...FAMILY_EXTRAS,
  'Cucumber', 'Bell peppers', 'Mangoes', 'Oranges', 'Watermelon',
  'Fish (tilapia)',
  'Noodles', 'Maize flour (ugali)',
  'Spices · curry powder', 'Spices · black pepper',
  'Fabric softener', 'Toilet cleaner',
  'Light bulbs', 'Batteries (AA)',
];

// Region-specific tilts so a Nairobi household gets sukuma + ugali
// flour, and a Mumbai household gets atta + dal.
const REGION_EXTRAS: Record<Region, string[]> = {
  'east-africa': [
    'Maize flour (ugali)', 'Kale (sukuma wiki)', 'Plantain (matoke)',
    'Pilau masala', 'Coconut milk', 'Mangoes', 'Passion fruit',
  ],
  'south-asia': [
    'Atta / chapati flour', 'Basmati rice', 'Toor dal', 'Moong dal',
    'Ghee', 'Paneer', 'Garam masala', 'Mustard seeds', 'Coriander (dhania)',
  ],
  'global': [
    'Cereal', 'Oats', 'Pasta', 'Olive oil', 'Cheese',
  ],
};

const SPECIAL_EXTRAS: Record<SpecialNeed, string[]> = {
  baby:    ['Diapers','Baby wipes','Baby formula','Baby lotion'],
  pet:     ['Pet food'],
  elderly: ['Painkillers','First-aid plasters','Hand sanitiser'],
};

// ── Main ─────────────────────────────────────────────────────────

/** Build a label list for the given prefs. Order matters: we keep
 *  essentials first, then size extras, then region tilts, then
 *  special needs — so a "preview" of the first 10 items is always
 *  the truly daily-needed stuff. */
function pickLabels(prefs: SmartStartPrefs): string[] {
  const set = new Set<string>(ESSENTIAL_LABELS);
  if (prefs.size === 'family') FAMILY_EXTRAS.forEach((l) => set.add(l));
  if (prefs.size === 'big')    BIG_EXTRAS.forEach((l) => set.add(l));

  if (prefs.region !== 'any') {
    (REGION_EXTRAS[prefs.region] || []).forEach((l) => set.add(l));
  }
  prefs.special.forEach((s) => SPECIAL_EXTRAS[s].forEach((l) => set.add(l)));

  // Apartment-dwellers in cities skip firewood/charcoal — they
  // probably cook on gas/electric.
  if (prefs.household === 'apartment') {
    set.delete('Firewood');
    set.delete('Charcoal');
  }

  return Array.from(set);
}

function passesDietFilter(label: string, diet: Lifestyle): boolean {
  if (diet === 'vegan') return !NON_VEGAN_LABELS.has(label);
  if (diet === 'veg')   return !NON_VEG_LABELS.has(label);
  return true;
}

/** Turn prefs into a final GroceryListItem[] ready to drop into a
 *  GroceryList document. Quantities and prices reflect size +
 *  budget + cadence.
 *
 *  `currency` is the family's display currency (HiveConfig) — it
 *  drives the real exchange-rate conversion in pricing.ts so the
 *  generated estimates land in the family's actual currency, not a
 *  region guess. Defaults to USD when unknown. */
export function generateList(prefs: SmartStartPrefs, currency: string = 'USD'): GroceryListItem[] {
  const sizeMult     = SIZE_MULT[prefs.size];
  const budgetMult   = BUDGET_MULT[prefs.budget];
  const cadenceMult  = CADENCE_MULT[prefs.cadence] || 1;

  const labels = pickLabels(prefs).filter((l) => passesDietFilter(l, prefs.lifestyle));

  const rows: GroceryListItem[] = [];
  for (const label of labels) {
    const staple: DirectoryStaple | undefined = DIRECTORY_STAPLES.find((s) => s.label === label);
    if (!staple) continue;

    // Final qty: catalog default × size × cadence, rounded up so
    // 1 → 1 (never zero), capped to keep things sensible.
    const qty = Math.max(1, Math.ceil(staple.defaultQty * sizeMult * cadenceMult));
    const lineCents = Math.round(estimateLineCents(staple, qty, currency) * budgetMult);

    rows.push({
      id: crypto.randomUUID(),
      name: staple.label,
      category: staple.category,
      qty,
      unit: staple.unit,
      estimatedCents: lineCents,
      done: false,
    });
  }

  // Sort: Food first (produce → dairy → pantry), then Consumables
  // (cleaning → personal → other). Mirrors the on-page Food vs
  // Consumables split so the data already arrives ordered.
  const order: Record<string, number> = {
    produce: 0, dairy: 1, pantry: 2, cleaning: 3, personal: 4, other: 5,
  };
  rows.sort((a, b) => (order[a.category || 'other'] ?? 9) - (order[b.category || 'other'] ?? 9));
  return rows;
}

/** Friendly title used as the list name — picked up by the active
 *  list page header. Format: "Smart-start · 3-4 people · East Africa". */
export function generateListName(prefs: SmartStartPrefs): string {
  const size  = prefs.size === 'solo' ? '1-2 people' : prefs.size === 'family' ? '3-4 people' : '5+ people';
  const region = prefs.region === 'east-africa' ? 'East Africa'
              : prefs.region === 'south-asia'  ? 'South Asia'
              : prefs.region === 'global'      ? 'Global'
              : '';
  const tail = region ? ` · ${region}` : '';
  return `Smart-start · ${size}${tail}`;
}
