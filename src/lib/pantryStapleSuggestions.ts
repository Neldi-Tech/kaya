// Common-staple dictionary used as a typeahead on /pantry/staples and
// /pantry/list/[id]'s add-row. Curated for an East-African family
// context but globally readable. Each entry carries everything we
// need to one-tap fill the staple form.
//
// Keep this list small (~50 entries) and high-signal — the goal is
// "I started typing 'ri' and 'Rice' appeared, ready to save". For
// longer-tail items the parent just types the full name.
//
// All entries are lowercase-keyed for matching; `label` is the
// user-facing name with proper capitalisation.

import type { StapleCategory, Cadence } from './pantry';

export interface StapleSuggestion {
  /** Lowercase tokens for matching. e.g. ['rice', 'mchele']. */
  match: string[];
  /** Display name. */
  label: string;
  category: StapleCategory;
  /** Sensible default qty (1 if no obvious answer). */
  defaultQty: number;
  /** Default unit id (matches STAPLE_UNITS in pantry.ts). */
  unit: string;
  cadence: Cadence;
  /** Single emoji that shows on the chip. */
  emoji: string;
}

export const COMMON_STAPLES: StapleSuggestion[] = [
  // ── Pantry / staples ──
  { match: ['rice', 'mchele'],       label: 'Rice',           category: 'pantry',   defaultQty: 2, unit: 'kg',     cadence: 'weekly',   emoji: '🍚' },
  { match: ['flour', 'unga'],        label: 'Flour',          category: 'pantry',   defaultQty: 2, unit: 'kg',     cadence: 'weekly',   emoji: '🌾' },
  { match: ['maize flour', 'ugali'], label: 'Maize flour',    category: 'pantry',   defaultQty: 2, unit: 'kg',     cadence: 'weekly',   emoji: '🌽' },
  { match: ['sugar', 'sukari'],      label: 'Sugar',          category: 'pantry',   defaultQty: 1, unit: 'kg',     cadence: 'biweekly', emoji: '🍬' },
  { match: ['salt', 'chumvi'],       label: 'Salt',           category: 'pantry',   defaultQty: 1, unit: 'pkt',    cadence: 'monthly',  emoji: '🧂' },
  { match: ['cooking oil', 'oil'],   label: 'Cooking oil',    category: 'pantry',   defaultQty: 1, unit: 'L',      cadence: 'biweekly', emoji: '🫙' },
  { match: ['tea', 'chai'],          label: 'Tea',            category: 'pantry',   defaultQty: 1, unit: 'pkt',    cadence: 'monthly',  emoji: '🍵' },
  { match: ['coffee', 'kahawa'],     label: 'Coffee',         category: 'pantry',   defaultQty: 1, unit: 'pkt',    cadence: 'monthly',  emoji: '☕' },
  { match: ['bread', 'mkate'],       label: 'Bread',          category: 'pantry',   defaultQty: 1, unit: 'x',      cadence: 'daily',    emoji: '🥖' },
  { match: ['pasta', 'spaghetti'],   label: 'Pasta',          category: 'pantry',   defaultQty: 1, unit: 'pack',   cadence: 'biweekly', emoji: '🍝' },
  { match: ['beans', 'maharage'],    label: 'Beans',          category: 'pantry',   defaultQty: 1, unit: 'kg',     cadence: 'biweekly', emoji: '🫘' },
  { match: ['lentils', 'dengu'],     label: 'Lentils',        category: 'pantry',   defaultQty: 1, unit: 'kg',     cadence: 'monthly',  emoji: '🫘' },

  // ── Produce ──
  { match: ['tomatoes', 'tomato'],   label: 'Tomatoes',       category: 'produce',  defaultQty: 1, unit: 'kg',     cadence: 'weekly',   emoji: '🍅' },
  { match: ['onions', 'onion'],      label: 'Onions',         category: 'produce',  defaultQty: 1, unit: 'kg',     cadence: 'weekly',   emoji: '🧅' },
  { match: ['potatoes', 'potato'],   label: 'Potatoes',       category: 'produce',  defaultQty: 2, unit: 'kg',     cadence: 'weekly',   emoji: '🥔' },
  { match: ['spinach', 'mchicha'],   label: 'Spinach',        category: 'produce',  defaultQty: 1, unit: 'bunch',  cadence: 'weekly',   emoji: '🥬' },
  { match: ['cabbage'],              label: 'Cabbage',        category: 'produce',  defaultQty: 1, unit: 'x',      cadence: 'weekly',   emoji: '🥬' },
  { match: ['carrots', 'carrot'],    label: 'Carrots',        category: 'produce',  defaultQty: 1, unit: 'kg',     cadence: 'weekly',   emoji: '🥕' },
  { match: ['cucumber'],             label: 'Cucumber',       category: 'produce',  defaultQty: 2, unit: 'x',      cadence: 'weekly',   emoji: '🥒' },
  { match: ['garlic'],               label: 'Garlic',         category: 'produce',  defaultQty: 1, unit: 'pkt',    cadence: 'biweekly', emoji: '🧄' },
  { match: ['ginger'],               label: 'Ginger',         category: 'produce',  defaultQty: 1, unit: 'pkt',    cadence: 'biweekly', emoji: '🫚' },
  { match: ['lemons', 'lemon'],      label: 'Lemons',         category: 'produce',  defaultQty: 4, unit: 'x',      cadence: 'weekly',   emoji: '🍋' },
  { match: ['bananas', 'ndizi'],     label: 'Bananas',        category: 'produce',  defaultQty: 1, unit: 'bunch',  cadence: 'weekly',   emoji: '🍌' },
  { match: ['mangoes', 'mango'],     label: 'Mangoes',        category: 'produce',  defaultQty: 4, unit: 'x',      cadence: 'weekly',   emoji: '🥭' },
  { match: ['apples', 'apple'],      label: 'Apples',         category: 'produce',  defaultQty: 6, unit: 'x',      cadence: 'weekly',   emoji: '🍎' },
  { match: ['oranges', 'orange'],    label: 'Oranges',        category: 'produce',  defaultQty: 6, unit: 'x',      cadence: 'weekly',   emoji: '🍊' },
  { match: ['avocado', 'parachichi'],label: 'Avocados',       category: 'produce',  defaultQty: 4, unit: 'x',      cadence: 'weekly',   emoji: '🥑' },
  { match: ['pineapple'],            label: 'Pineapple',      category: 'produce',  defaultQty: 1, unit: 'x',      cadence: 'weekly',   emoji: '🍍' },

  // ── Dairy + eggs ──
  { match: ['milk', 'maziwa'],       label: 'Milk',           category: 'dairy',    defaultQty: 4, unit: 'L',      cadence: 'weekly',   emoji: '🥛' },
  { match: ['yogurt', 'yoghurt'],    label: 'Yogurt',         category: 'dairy',    defaultQty: 1, unit: 'pack',   cadence: 'weekly',   emoji: '🥣' },
  { match: ['butter', 'siagi'],      label: 'Butter',         category: 'dairy',    defaultQty: 1, unit: 'pkt',    cadence: 'biweekly', emoji: '🧈' },
  { match: ['cheese', 'jibini'],     label: 'Cheese',         category: 'dairy',    defaultQty: 1, unit: 'pack',   cadence: 'biweekly', emoji: '🧀' },
  { match: ['eggs', 'mayai'],        label: 'Eggs',           category: 'dairy',    defaultQty: 1, unit: 'dozen',  cadence: 'weekly',   emoji: '🥚' },
  { match: ['cream'],                label: 'Cream',          category: 'dairy',    defaultQty: 1, unit: 'pack',   cadence: 'biweekly', emoji: '🥛' },

  // ── Cleaning ──
  { match: ['soap', 'sabuni'],          label: 'Soap (bar)',          category: 'cleaning', defaultQty: 2, unit: 'bar',  cadence: 'monthly',  emoji: '🧼' },
  { match: ['dish soap', 'dishwash'],   label: 'Dish soap',           category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly',  emoji: '🧴' },
  { match: ['detergent', 'omo'],        label: 'Laundry detergent',   category: 'cleaning', defaultQty: 1, unit: 'pack', cadence: 'monthly',  emoji: '🧺' },
  { match: ['bleach'],                  label: 'Bleach',              category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly',  emoji: '🧴' },
  { match: ['toilet paper'],            label: 'Toilet paper',        category: 'cleaning', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🧻' },
  { match: ['paper towels'],            label: 'Paper towels',        category: 'cleaning', defaultQty: 1, unit: 'pack', cadence: 'monthly',  emoji: '🧻' },
  { match: ['sponge', 'spongi'],        label: 'Sponges',             category: 'cleaning', defaultQty: 2, unit: 'x',    cadence: 'monthly',  emoji: '🧽' },

  // ── Personal care ──
  { match: ['shampoo'],              label: 'Shampoo',        category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly',  emoji: '🧴' },
  { match: ['toothpaste'],           label: 'Toothpaste',     category: 'personal', defaultQty: 1, unit: 'tube',   cadence: 'monthly',  emoji: '🪥' },
  { match: ['toothbrush'],           label: 'Toothbrush',     category: 'personal', defaultQty: 1, unit: 'x',      cadence: 'monthly',  emoji: '🪥' },
  { match: ['deodorant'],            label: 'Deodorant',      category: 'personal', defaultQty: 1, unit: 'x',      cadence: 'monthly',  emoji: '🧴' },
  { match: ['lotion'],               label: 'Body lotion',    category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly',  emoji: '🧴' },
  { match: ['razor'],                label: 'Razors',         category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'monthly',  emoji: '🪒' },
  { match: ['pads', 'sanitary'],     label: 'Sanitary pads',  category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'monthly',  emoji: '🩸' },

  // ── Other ──
  { match: ['charcoal', 'mkaa'],     label: 'Charcoal',       category: 'other',    defaultQty: 1, unit: 'bag',    cadence: 'monthly',  emoji: '⚫' },
  { match: ['matches'],              label: 'Matches',        category: 'other',    defaultQty: 1, unit: 'pack',   cadence: 'monthly',  emoji: '🔥' },
  { match: ['candles'],              label: 'Candles',        category: 'other',    defaultQty: 1, unit: 'pack',   cadence: 'monthly',  emoji: '🕯️' },
];

/** Top N suggestions matching the typed query. Empty query → empty
 *  array (we don't want to flood the form on first focus). */
export function suggestStaples(query: string, max = 5): StapleSuggestion[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return COMMON_STAPLES.filter((s) =>
    s.label.toLowerCase().includes(q) || s.match.some((m) => m.includes(q))
  ).slice(0, max);
}
