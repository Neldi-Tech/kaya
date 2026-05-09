// The Pantry · Directory of Items.
//
// Two large, hand-curated catalogs the Browse + AI-onboarding surfaces
// read from. Phase 1B: rule-based seeding from family-description text;
// Phase 2 will swap the parser for an LLM call gated behind an env var
// (the schema below already carries the diet/region tags an LLM prompt
// would need to ground its picks).
//
// Authoring rules:
//   • Each item has `match[]` — lowercase tokens (incl. Swahili) we
//     look for in the free-text intake. Keep the tokens short + unique.
//   • `tags[]` is an open string set: 'east-africa', 'south-asia',
//     'baby', 'vegetarian', 'halal', 'breakfast-staple', etc. Filter
//     UIs and the parser both read these.
//   • `weight` (1-5) is the directory's "essential-ness". 5 = bread/
//     milk/sugar (every household). 1 = niche.  Used to rank the AI
//     onboarding output and the Directory's default sort.
//   • Foods don't carry qty/unit — they live on the meal planner and
//     simply mark "this dish is a thing". When tapped from the Directory
//     they offer to add their typical staples to the staple list.

import type { StapleCategory, Cadence } from './pantry';

// ────────────────────────────────────────────────────────────────────
//  Staples Directory — household items
// ────────────────────────────────────────────────────────────────────

export interface StapleDirectoryItem {
  /** Lowercase tokens for matching free-text & directory search. */
  match: string[];
  /** Display name. */
  label: string;
  category: StapleCategory;
  defaultQty: number;
  unit: string;
  cadence: Cadence;
  emoji: string;
  /** 1-5; 5 = essential to nearly every household. */
  weight: number;
  /** Open tag set — region, diet, lifestyle, household type. */
  tags: string[];
  /** Optional one-line hint shown in the Directory card. */
  hint?: string;
}

export const STAPLES_DIRECTORY: StapleDirectoryItem[] = [
  // ── Pantry · grains, flours, starches ──────────────────────────
  { match: ['rice', 'mchele', 'wali'],            label: 'Rice (white)',         category: 'pantry', defaultQty: 5, unit: 'kg',  cadence: 'biweekly', emoji: '🍚', weight: 5, tags: ['east-africa','south-asia','global','staple-grain'], hint: 'Pishori, basmati, jasmine — all common.' },
  { match: ['brown rice'],                        label: 'Rice (brown)',         category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'monthly',  emoji: '🍚', weight: 3, tags: ['health-conscious','global','staple-grain'] },
  { match: ['basmati'],                           label: 'Basmati rice',         category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'monthly',  emoji: '🍚', weight: 3, tags: ['south-asia','indian','staple-grain'] },
  { match: ['ugali', 'maize flour', 'sembe'],     label: 'Maize flour (ugali)',  category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'weekly',   emoji: '🌽', weight: 5, tags: ['east-africa','staple-grain'], hint: 'Sembe / dona for ugali.' },
  { match: ['flour', 'unga', 'wheat flour'],      label: 'Wheat flour',          category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'biweekly', emoji: '🌾', weight: 5, tags: ['global','staple-grain','baking'] },
  { match: ['atta', 'chapati flour'],             label: 'Atta / chapati flour', category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'biweekly', emoji: '🌾', weight: 4, tags: ['south-asia','east-africa','indian'] },
  { match: ['oats', 'oatmeal'],                   label: 'Oats',                 category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🥣', weight: 3, tags: ['breakfast-staple','health-conscious'] },
  { match: ['cornflakes', 'cereal'],              label: 'Cereal',               category: 'pantry', defaultQty: 1, unit: 'box', cadence: 'biweekly', emoji: '🥣', weight: 3, tags: ['kids','breakfast-staple'] },
  { match: ['pasta', 'spaghetti', 'macaroni'],    label: 'Pasta',                category: 'pantry', defaultQty: 2, unit: 'pack', cadence: 'biweekly', emoji: '🍝', weight: 4, tags: ['global','kids'] },
  { match: ['noodles', 'mihogo', 'instant'],      label: 'Instant noodles',      category: 'pantry', defaultQty: 4, unit: 'pkt', cadence: 'biweekly', emoji: '🍜', weight: 2, tags: ['kids','quick'] },
  { match: ['couscous'],                          label: 'Couscous',             category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🍚', weight: 2, tags: ['global'] },
  { match: ['quinoa'],                            label: 'Quinoa',               category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🌾', weight: 1, tags: ['health-conscious'] },
  { match: ['semolina', 'sooji'],                 label: 'Semolina',             category: 'pantry', defaultQty: 1, unit: 'kg',  cadence: 'monthly',  emoji: '🌾', weight: 2, tags: ['south-asia','indian','baking'] },
  { match: ['bread crumbs'],                      label: 'Bread crumbs',         category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🍞', weight: 1, tags: ['baking'] },

  // ── Pantry · legumes, pulses ─────────────────────────────────────
  { match: ['beans', 'maharage'],                 label: 'Dry beans',            category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'biweekly', emoji: '🫘', weight: 4, tags: ['east-africa','global','protein','vegetarian'] },
  { match: ['lentils', 'dengu', 'dal'],           label: 'Lentils',              category: 'pantry', defaultQty: 1, unit: 'kg',  cadence: 'monthly',  emoji: '🫘', weight: 4, tags: ['south-asia','indian','protein','vegetarian'] },
  { match: ['chickpeas', 'chana', 'mbaazi'],      label: 'Chickpeas',            category: 'pantry', defaultQty: 1, unit: 'kg',  cadence: 'monthly',  emoji: '🫛', weight: 3, tags: ['south-asia','indian','protein','vegetarian'] },
  { match: ['green gram', 'mung', 'ndengu'],      label: 'Green gram (ndengu)',  category: 'pantry', defaultQty: 1, unit: 'kg',  cadence: 'monthly',  emoji: '🫛', weight: 3, tags: ['east-africa','protein','vegetarian'] },
  { match: ['pigeon peas', 'toor'],               label: 'Pigeon peas',          category: 'pantry', defaultQty: 1, unit: 'kg',  cadence: 'monthly',  emoji: '🫛', weight: 2, tags: ['south-asia','indian','protein'] },

  // ── Pantry · oils, fats, condiments ──────────────────────────────
  { match: ['cooking oil', 'oil', 'mafuta'],      label: 'Cooking oil',          category: 'pantry', defaultQty: 5, unit: 'L',   cadence: 'monthly',  emoji: '🫙', weight: 5, tags: ['global','staple'] },
  { match: ['olive oil'],                         label: 'Olive oil',            category: 'pantry', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🫒', weight: 3, tags: ['global','health-conscious'] },
  { match: ['ghee', 'samli'],                     label: 'Ghee',                 category: 'pantry', defaultQty: 1, unit: 'jar', cadence: 'monthly', emoji: '🫙', weight: 3, tags: ['south-asia','east-africa','indian'] },
  { match: ['vinegar'],                           label: 'Vinegar',              category: 'pantry', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🫙', weight: 2, tags: ['global'] },
  { match: ['soy sauce'],                         label: 'Soy sauce',            category: 'pantry', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🫙', weight: 2, tags: ['asian','global'] },
  { match: ['tomato sauce', 'ketchup'],           label: 'Ketchup',              category: 'pantry', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🥫', weight: 3, tags: ['kids','global'] },
  { match: ['mayo', 'mayonnaise'],                label: 'Mayonnaise',           category: 'pantry', defaultQty: 1, unit: 'jar', cadence: 'monthly', emoji: '🥫', weight: 2, tags: ['global'] },
  { match: ['hot sauce', 'pilipili'],             label: 'Hot sauce',            category: 'pantry', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🌶️', weight: 2, tags: ['east-africa','global','spicy'] },
  { match: ['peanut butter'],                     label: 'Peanut butter',        category: 'pantry', defaultQty: 1, unit: 'jar', cadence: 'monthly', emoji: '🥜', weight: 3, tags: ['kids','breakfast-staple'] },
  { match: ['jam', 'marmalade'],                  label: 'Jam',                  category: 'pantry', defaultQty: 1, unit: 'jar', cadence: 'monthly', emoji: '🍓', weight: 3, tags: ['kids','breakfast-staple'] },
  { match: ['honey', 'asali'],                    label: 'Honey',                category: 'pantry', defaultQty: 1, unit: 'jar', cadence: 'monthly', emoji: '🍯', weight: 3, tags: ['global','breakfast-staple'] },

  // ── Pantry · spices, baking, sweeteners ──────────────────────────
  { match: ['sugar', 'sukari'],                   label: 'Sugar',                category: 'pantry', defaultQty: 2, unit: 'kg',  cadence: 'biweekly', emoji: '🍬', weight: 5, tags: ['global','staple'] },
  { match: ['salt', 'chumvi'],                    label: 'Salt',                 category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🧂', weight: 5, tags: ['global','staple'] },
  { match: ['black pepper', 'pilipili manga'],    label: 'Black pepper',         category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌶️', weight: 3, tags: ['global','spice'] },
  { match: ['paprika'],                           label: 'Paprika',              category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌶️', weight: 2, tags: ['global','spice'] },
  { match: ['cumin', 'jira'],                     label: 'Cumin',                category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌰', weight: 3, tags: ['south-asia','east-africa','indian','spice'] },
  { match: ['turmeric', 'manjano', 'haldi'],      label: 'Turmeric',             category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌶️', weight: 3, tags: ['south-asia','east-africa','indian','spice'] },
  { match: ['coriander', 'dhania'],               label: 'Coriander powder',    category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌿', weight: 3, tags: ['south-asia','east-africa','indian','spice'] },
  { match: ['masala', 'curry powder'],            label: 'Masala / curry powder',category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌶️', weight: 4, tags: ['south-asia','east-africa','indian','spice'] },
  { match: ['cardamom', 'iliki'],                 label: 'Cardamom',             category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌿', weight: 2, tags: ['south-asia','east-africa','indian','spice'] },
  { match: ['cinnamon'],                          label: 'Cinnamon',             category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌿', weight: 2, tags: ['global','spice'] },
  { match: ['cloves'],                            label: 'Cloves',               category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌿', weight: 2, tags: ['global','spice'] },
  { match: ['bay leaves'],                        label: 'Bay leaves',           category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🌿', weight: 1, tags: ['global','spice'] },
  { match: ['stock cubes', 'maggi', 'royco'],     label: 'Stock cubes',          category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🧂', weight: 4, tags: ['east-africa','global'] },
  { match: ['baking powder'],                     label: 'Baking powder',        category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🧁', weight: 2, tags: ['global','baking'] },
  { match: ['baking soda'],                       label: 'Baking soda',          category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🧁', weight: 2, tags: ['global','baking'] },
  { match: ['yeast'],                             label: 'Yeast',                category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🍞', weight: 2, tags: ['global','baking'] },
  { match: ['cocoa', 'chocolate powder'],         label: 'Cocoa powder',         category: 'pantry', defaultQty: 1, unit: 'pkt', cadence: 'monthly', emoji: '🍫', weight: 2, tags: ['kids','baking'] },

  // ── Pantry · drinks ──────────────────────────────────────────────
  { match: ['tea', 'chai', 'tea bags'],           label: 'Tea',                  category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🍵', weight: 5, tags: ['east-africa','south-asia','global','breakfast-staple'] },
  { match: ['coffee', 'kahawa'],                  label: 'Coffee',               category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '☕', weight: 4, tags: ['global','breakfast-staple'] },
  { match: ['juice', 'fruit juice'],              label: 'Fruit juice',          category: 'pantry', defaultQty: 2, unit: 'L',   cadence: 'weekly',  emoji: '🧃', weight: 3, tags: ['kids','global'] },
  { match: ['soda', 'pop', 'cola'],               label: 'Soda',                 category: 'pantry', defaultQty: 6, unit: 'x',   cadence: 'biweekly', emoji: '🥤', weight: 2, tags: ['global','treat'] },
  { match: ['water', 'bottled water'],            label: 'Bottled water',        category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'weekly',  emoji: '💧', weight: 3, tags: ['global'] },
  { match: ['squash', 'ribena'],                  label: 'Fruit squash',         category: 'pantry', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧃', weight: 2, tags: ['kids','east-africa'] },
  { match: ['drinking chocolate', 'milo'],        label: 'Drinking chocolate',   category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🍫', weight: 3, tags: ['kids','east-africa'] },

  // ── Pantry · canned, packaged ────────────────────────────────────
  { match: ['canned tomatoes', 'tinned tomatoes'],label: 'Canned tomatoes',      category: 'pantry', defaultQty: 2, unit: 'can', cadence: 'biweekly', emoji: '🥫', weight: 3, tags: ['global'] },
  { match: ['baked beans'],                       label: 'Baked beans',          category: 'pantry', defaultQty: 2, unit: 'can', cadence: 'biweekly', emoji: '🥫', weight: 3, tags: ['kids','global','breakfast-staple'] },
  { match: ['tuna', 'canned tuna'],               label: 'Canned tuna',          category: 'pantry', defaultQty: 2, unit: 'can', cadence: 'monthly', emoji: '🐟', weight: 3, tags: ['global','protein'] },
  { match: ['sardines'],                          label: 'Sardines',             category: 'pantry', defaultQty: 2, unit: 'can', cadence: 'monthly', emoji: '🐟', weight: 2, tags: ['east-africa','global','protein'] },
  { match: ['corned beef'],                       label: 'Corned beef',          category: 'pantry', defaultQty: 2, unit: 'can', cadence: 'monthly', emoji: '🥫', weight: 2, tags: ['east-africa','global','protein'] },
  { match: ['coconut milk', 'tui'],               label: 'Coconut milk',         category: 'pantry', defaultQty: 2, unit: 'can', cadence: 'monthly', emoji: '🥥', weight: 3, tags: ['east-africa','south-asia','asian'] },

  // ── Produce · vegetables ─────────────────────────────────────────
  { match: ['tomatoes', 'tomato', 'nyanya'],      label: 'Tomatoes',             category: 'produce', defaultQty: 2, unit: 'kg', cadence: 'weekly', emoji: '🍅', weight: 5, tags: ['global','staple'] },
  { match: ['onions', 'onion', 'kitunguu'],       label: 'Onions',               category: 'produce', defaultQty: 2, unit: 'kg', cadence: 'weekly', emoji: '🧅', weight: 5, tags: ['global','staple'] },
  { match: ['potatoes', 'potato', 'viazi'],       label: 'Potatoes',             category: 'produce', defaultQty: 3, unit: 'kg', cadence: 'weekly', emoji: '🥔', weight: 5, tags: ['global','staple'] },
  { match: ['sweet potato', 'viazi vitamu'],      label: 'Sweet potatoes',       category: 'produce', defaultQty: 1, unit: 'kg', cadence: 'biweekly', emoji: '🍠', weight: 3, tags: ['east-africa','global'] },
  { match: ['cassava', 'mihogo'],                 label: 'Cassava',              category: 'produce', defaultQty: 1, unit: 'kg', cadence: 'biweekly', emoji: '🥔', weight: 3, tags: ['east-africa','staple'] },
  { match: ['yam', 'viazi vikuu'],                label: 'Yam',                  category: 'produce', defaultQty: 1, unit: 'kg', cadence: 'monthly',  emoji: '🍠', weight: 2, tags: ['west-africa','east-africa'] },
  { match: ['plantains', 'matoke', 'green banana'],label: 'Plantains / matoke',  category: 'produce', defaultQty: 1, unit: 'bunch', cadence: 'weekly', emoji: '🍌', weight: 4, tags: ['east-africa','staple'] },
  { match: ['spinach', 'mchicha'],                label: 'Spinach',              category: 'produce', defaultQty: 2, unit: 'bunch', cadence: 'weekly', emoji: '🥬', weight: 4, tags: ['east-africa','global','greens'] },
  { match: ['kale', 'sukuma wiki'],               label: 'Kale (sukuma wiki)',   category: 'produce', defaultQty: 2, unit: 'bunch', cadence: 'weekly', emoji: '🥬', weight: 5, tags: ['east-africa','staple','greens'] },
  { match: ['cabbage', 'kabichi'],                label: 'Cabbage',              category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'weekly', emoji: '🥬', weight: 4, tags: ['east-africa','global'] },
  { match: ['carrots', 'carrot', 'karoti'],       label: 'Carrots',              category: 'produce', defaultQty: 1, unit: 'kg',    cadence: 'weekly', emoji: '🥕', weight: 4, tags: ['global','kids'] },
  { match: ['cucumber', 'tango'],                 label: 'Cucumber',             category: 'produce', defaultQty: 3, unit: 'x',     cadence: 'weekly', emoji: '🥒', weight: 3, tags: ['global'] },
  { match: ['bell pepper', 'capsicum', 'pilipili hoho'], label: 'Bell pepper',   category: 'produce', defaultQty: 4, unit: 'x',     cadence: 'weekly', emoji: '🫑', weight: 3, tags: ['global'] },
  { match: ['chilli', 'pilipili kichaa'],         label: 'Chilli peppers',       category: 'produce', defaultQty: 1, unit: 'pkt',   cadence: 'weekly', emoji: '🌶️', weight: 3, tags: ['east-africa','south-asia','spicy'] },
  { match: ['garlic', 'kitunguu saumu'],          label: 'Garlic',               category: 'produce', defaultQty: 1, unit: 'pkt',   cadence: 'biweekly', emoji: '🧄', weight: 4, tags: ['global','staple'] },
  { match: ['ginger', 'tangawizi'],               label: 'Ginger',               category: 'produce', defaultQty: 1, unit: 'pkt',   cadence: 'biweekly', emoji: '🫚', weight: 4, tags: ['east-africa','south-asia','staple'] },
  { match: ['lemons', 'lemon', 'ndimu'],          label: 'Lemons',               category: 'produce', defaultQty: 6, unit: 'x',     cadence: 'weekly', emoji: '🍋', weight: 3, tags: ['global'] },
  { match: ['lime'],                              label: 'Limes',                category: 'produce', defaultQty: 6, unit: 'x',     cadence: 'biweekly', emoji: '🍋', weight: 2, tags: ['global'] },
  { match: ['coriander leaf', 'dhania leaf'],     label: 'Coriander leaves',     category: 'produce', defaultQty: 1, unit: 'bunch', cadence: 'weekly', emoji: '🌿', weight: 3, tags: ['south-asia','east-africa','indian'] },
  { match: ['parsley'],                           label: 'Parsley',              category: 'produce', defaultQty: 1, unit: 'bunch', cadence: 'biweekly', emoji: '🌿', weight: 2, tags: ['global'] },
  { match: ['mint'],                              label: 'Mint',                 category: 'produce', defaultQty: 1, unit: 'bunch', cadence: 'biweekly', emoji: '🌿', weight: 2, tags: ['global'] },
  { match: ['lettuce'],                           label: 'Lettuce',              category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'weekly', emoji: '🥗', weight: 3, tags: ['global'] },
  { match: ['broccoli'],                          label: 'Broccoli',             category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'weekly', emoji: '🥦', weight: 3, tags: ['global','health-conscious'] },
  { match: ['cauliflower'],                       label: 'Cauliflower',          category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'biweekly', emoji: '🥦', weight: 2, tags: ['global'] },
  { match: ['mushrooms'],                         label: 'Mushrooms',            category: 'produce', defaultQty: 1, unit: 'pack',  cadence: 'biweekly', emoji: '🍄', weight: 2, tags: ['global'] },
  { match: ['eggplant', 'biringanya'],            label: 'Eggplant',             category: 'produce', defaultQty: 2, unit: 'x',     cadence: 'biweekly', emoji: '🍆', weight: 3, tags: ['south-asia','east-africa','global'] },
  { match: ['okra', 'bamia'],                     label: 'Okra',                 category: 'produce', defaultQty: 1, unit: 'kg',    cadence: 'biweekly', emoji: '🥬', weight: 3, tags: ['south-asia','east-africa'] },
  { match: ['pumpkin', 'malenge'],                label: 'Pumpkin',              category: 'produce', defaultQty: 1, unit: 'kg',    cadence: 'monthly',  emoji: '🎃', weight: 2, tags: ['east-africa','global'] },
  { match: ['squash', 'butternut'],               label: 'Butternut squash',     category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'biweekly', emoji: '🎃', weight: 2, tags: ['global'] },
  { match: ['avocado', 'parachichi'],             label: 'Avocados',             category: 'produce', defaultQty: 6, unit: 'x',     cadence: 'weekly', emoji: '🥑', weight: 4, tags: ['east-africa','global','breakfast-staple'] },

  // ── Produce · fruits ─────────────────────────────────────────────
  { match: ['bananas', 'banana', 'ndizi'],        label: 'Bananas',              category: 'produce', defaultQty: 2, unit: 'bunch', cadence: 'weekly', emoji: '🍌', weight: 5, tags: ['global','kids','breakfast-staple'] },
  { match: ['apples', 'apple', 'tofaa'],          label: 'Apples',               category: 'produce', defaultQty: 8, unit: 'x',     cadence: 'weekly', emoji: '🍎', weight: 4, tags: ['global','kids'] },
  { match: ['oranges', 'orange', 'machungwa'],    label: 'Oranges',              category: 'produce', defaultQty: 8, unit: 'x',     cadence: 'weekly', emoji: '🍊', weight: 4, tags: ['global','kids'] },
  { match: ['mangoes', 'mango', 'embe'],          label: 'Mangoes',              category: 'produce', defaultQty: 6, unit: 'x',     cadence: 'weekly', emoji: '🥭', weight: 4, tags: ['east-africa','south-asia','kids'] },
  { match: ['pineapple', 'nanasi'],               label: 'Pineapple',            category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'weekly', emoji: '🍍', weight: 3, tags: ['east-africa','global'] },
  { match: ['pawpaw', 'papaya', 'papai'],         label: 'Papaya',               category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'weekly', emoji: '🥭', weight: 3, tags: ['east-africa','global'] },
  { match: ['watermelon', 'tikiti'],              label: 'Watermelon',           category: 'produce', defaultQty: 1, unit: 'x',     cadence: 'biweekly', emoji: '🍉', weight: 3, tags: ['east-africa','global','kids'] },
  { match: ['grapes', 'zabibu'],                  label: 'Grapes',               category: 'produce', defaultQty: 1, unit: 'kg',    cadence: 'biweekly', emoji: '🍇', weight: 3, tags: ['global','kids'] },
  { match: ['strawberries'],                      label: 'Strawberries',         category: 'produce', defaultQty: 1, unit: 'pack',  cadence: 'biweekly', emoji: '🍓', weight: 2, tags: ['kids','treat'] },
  { match: ['blueberries'],                       label: 'Blueberries',          category: 'produce', defaultQty: 1, unit: 'pack',  cadence: 'biweekly', emoji: '🫐', weight: 1, tags: ['kids','treat','health-conscious'] },
  { match: ['passion fruit'],                     label: 'Passion fruit',        category: 'produce', defaultQty: 1, unit: 'kg',    cadence: 'biweekly', emoji: '🍈', weight: 2, tags: ['east-africa'] },
  { match: ['pomegranate'],                       label: 'Pomegranate',          category: 'produce', defaultQty: 2, unit: 'x',     cadence: 'monthly',  emoji: '🍎', weight: 1, tags: ['south-asia','global'] },

  // ── Dairy + eggs ─────────────────────────────────────────────────
  { match: ['milk', 'maziwa'],                    label: 'Milk',                 category: 'dairy', defaultQty: 7, unit: 'L',   cadence: 'weekly', emoji: '🥛', weight: 5, tags: ['global','staple','kids'] },
  { match: ['long-life milk', 'uht'],             label: 'UHT milk',             category: 'dairy', defaultQty: 6, unit: 'L',   cadence: 'biweekly', emoji: '🥛', weight: 4, tags: ['east-africa','global'] },
  { match: ['yogurt', 'yoghurt', 'mtindi'],       label: 'Yogurt',               category: 'dairy', defaultQty: 2, unit: 'pack', cadence: 'weekly', emoji: '🥣', weight: 4, tags: ['global','kids'] },
  { match: ['butter', 'siagi'],                   label: 'Butter',               category: 'dairy', defaultQty: 1, unit: 'pkt', cadence: 'biweekly', emoji: '🧈', weight: 4, tags: ['global','baking'] },
  { match: ['cheese', 'jibini'],                  label: 'Cheese',               category: 'dairy', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🧀', weight: 3, tags: ['global','kids'] },
  { match: ['eggs', 'mayai'],                     label: 'Eggs',                 category: 'dairy', defaultQty: 2, unit: 'dozen', cadence: 'weekly', emoji: '🥚', weight: 5, tags: ['global','staple','breakfast-staple','protein'] },
  { match: ['cream'],                             label: 'Cream',                category: 'dairy', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🥛', weight: 2, tags: ['global','baking'] },
  { match: ['paneer'],                            label: 'Paneer',               category: 'dairy', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🧀', weight: 2, tags: ['south-asia','indian','vegetarian'] },
  { match: ['margarine', 'blue band'],            label: 'Margarine',            category: 'dairy', defaultQty: 1, unit: 'pkt', cadence: 'biweekly', emoji: '🧈', weight: 4, tags: ['east-africa','global','breakfast-staple'] },

  // ── Meat / fish (still 'pantry' bucket since we keep cats short) ──
  { match: ['chicken', 'kuku'],                   label: 'Chicken',              category: 'pantry', defaultQty: 2, unit: 'kg', cadence: 'weekly', emoji: '🍗', weight: 5, tags: ['global','protein','halal-ok'] },
  { match: ['beef', 'nyama ngombe'],              label: 'Beef',                 category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'weekly', emoji: '🥩', weight: 4, tags: ['global','protein','halal-ok'] },
  { match: ['goat', 'mbuzi'],                     label: 'Goat meat',            category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'biweekly', emoji: '🥩', weight: 3, tags: ['east-africa','south-asia','protein','halal-ok'] },
  { match: ['lamb'],                              label: 'Lamb',                 category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'biweekly', emoji: '🥩', weight: 2, tags: ['global','protein','halal-ok'] },
  { match: ['mutton'],                            label: 'Mutton',               category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'biweekly', emoji: '🥩', weight: 2, tags: ['south-asia','protein','halal-ok'] },
  { match: ['pork', 'nguruwe'],                   label: 'Pork',                 category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'biweekly', emoji: '🥓', weight: 2, tags: ['global','protein','non-halal'] },
  { match: ['bacon'],                             label: 'Bacon',                category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🥓', weight: 2, tags: ['global','breakfast-staple','non-halal'] },
  { match: ['sausages', 'soseji'],                label: 'Sausages',             category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🌭', weight: 3, tags: ['global','kids','breakfast-staple'] },
  { match: ['fish', 'samaki', 'tilapia'],         label: 'Fish',                 category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'weekly', emoji: '🐟', weight: 4, tags: ['east-africa','global','protein'] },
  { match: ['prawns', 'shrimp'],                  label: 'Prawns',               category: 'pantry', defaultQty: 1, unit: 'kg', cadence: 'monthly', emoji: '🍤', weight: 2, tags: ['global','protein'] },

  // ── Cleaning ─────────────────────────────────────────────────────
  { match: ['bar soap', 'sabuni mche'],           label: 'Bar soap',             category: 'cleaning', defaultQty: 4, unit: 'bar',    cadence: 'monthly', emoji: '🧼', weight: 4, tags: ['east-africa','global'] },
  { match: ['dish soap', 'dishwash'],             label: 'Dish soap',            category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 5, tags: ['global','staple'] },
  { match: ['detergent', 'omo', 'laundry soap'],  label: 'Laundry detergent',    category: 'cleaning', defaultQty: 1, unit: 'pack',   cadence: 'monthly', emoji: '🧺', weight: 5, tags: ['global','staple'] },
  { match: ['fabric softener'],                   label: 'Fabric softener',      category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧺', weight: 2, tags: ['global'] },
  { match: ['bleach'],                            label: 'Bleach',               category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 3, tags: ['global'] },
  { match: ['toilet paper', 'tissue'],            label: 'Toilet paper',         category: 'cleaning', defaultQty: 2, unit: 'pack',   cadence: 'biweekly', emoji: '🧻', weight: 5, tags: ['global','staple'] },
  { match: ['paper towels', 'kitchen towels'],    label: 'Paper towels',         category: 'cleaning', defaultQty: 1, unit: 'pack',   cadence: 'monthly', emoji: '🧻', weight: 3, tags: ['global'] },
  { match: ['sponges'],                           label: 'Sponges',              category: 'cleaning', defaultQty: 4, unit: 'x',      cadence: 'monthly', emoji: '🧽', weight: 3, tags: ['global'] },
  { match: ['surface cleaner', 'multipurpose'],   label: 'Surface cleaner',      category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 3, tags: ['global'] },
  { match: ['toilet cleaner'],                    label: 'Toilet cleaner',       category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 3, tags: ['global'] },
  { match: ['floor cleaner'],                     label: 'Floor cleaner',        category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🪣', weight: 3, tags: ['global'] },
  { match: ['glass cleaner'],                     label: 'Glass cleaner',        category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 2, tags: ['global'] },
  { match: ['air freshener'],                     label: 'Air freshener',        category: 'cleaning', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '💨', weight: 2, tags: ['global'] },
  { match: ['bin liners', 'garbage bags'],        label: 'Bin liners',           category: 'cleaning', defaultQty: 1, unit: 'pack',   cadence: 'monthly', emoji: '🗑️', weight: 4, tags: ['global','staple'] },
  { match: ['cling film'],                        label: 'Cling film',           category: 'cleaning', defaultQty: 1, unit: 'roll',   cadence: 'monthly', emoji: '📦', weight: 2, tags: ['global'] },
  { match: ['foil', 'aluminium foil'],            label: 'Aluminium foil',       category: 'cleaning', defaultQty: 1, unit: 'roll',   cadence: 'monthly', emoji: '📦', weight: 2, tags: ['global'] },

  // ── Personal care ────────────────────────────────────────────────
  { match: ['shampoo'],                           label: 'Shampoo',              category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 4, tags: ['global'] },
  { match: ['conditioner'],                       label: 'Conditioner',          category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 3, tags: ['global'] },
  { match: ['toothpaste'],                        label: 'Toothpaste',           category: 'personal', defaultQty: 2, unit: 'tube',   cadence: 'monthly', emoji: '🪥', weight: 5, tags: ['global','staple'] },
  { match: ['toothbrush'],                        label: 'Toothbrush',           category: 'personal', defaultQty: 4, unit: 'x',      cadence: 'monthly', emoji: '🪥', weight: 3, tags: ['global'] },
  { match: ['mouthwash'],                         label: 'Mouthwash',            category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 2, tags: ['global'] },
  { match: ['deodorant'],                         label: 'Deodorant',            category: 'personal', defaultQty: 1, unit: 'x',      cadence: 'monthly', emoji: '🧴', weight: 4, tags: ['global'] },
  { match: ['body lotion'],                       label: 'Body lotion',          category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 4, tags: ['global'] },
  { match: ['petroleum jelly', 'vaseline'],       label: 'Petroleum jelly',      category: 'personal', defaultQty: 1, unit: 'jar',    cadence: 'monthly', emoji: '🧴', weight: 3, tags: ['east-africa','global','kids'] },
  { match: ['razor', 'shaver'],                   label: 'Razors',               category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'monthly', emoji: '🪒', weight: 2, tags: ['global'] },
  { match: ['sanitary pads', 'pads'],             label: 'Sanitary pads',        category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'monthly', emoji: '🩸', weight: 4, tags: ['global'] },
  { match: ['diapers', 'nappies', 'pampers'],     label: 'Diapers',              category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'biweekly', emoji: '🍼', weight: 5, tags: ['baby'] },
  { match: ['baby wipes'],                        label: 'Baby wipes',           category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'biweekly', emoji: '🍼', weight: 4, tags: ['baby'] },
  { match: ['baby formula', 'milk powder'],       label: 'Baby formula',         category: 'personal', defaultQty: 1, unit: 'pack',   cadence: 'biweekly', emoji: '🍼', weight: 5, tags: ['baby'] },
  { match: ['baby food'],                         label: 'Baby food',            category: 'personal', defaultQty: 4, unit: 'jar',    cadence: 'biweekly', emoji: '🍼', weight: 3, tags: ['baby'] },
  { match: ['handwash', 'liquid soap'],           label: 'Handwash',             category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 4, tags: ['global'] },
  { match: ['sunscreen'],                         label: 'Sunscreen',            category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '☀️', weight: 2, tags: ['global'] },
  { match: ['hand sanitiser', 'sanitizer'],       label: 'Hand sanitiser',       category: 'personal', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🧴', weight: 2, tags: ['global'] },

  // ── Other / household ────────────────────────────────────────────
  { match: ['charcoal', 'mkaa'],                  label: 'Charcoal',             category: 'other', defaultQty: 1, unit: 'bag',  cadence: 'monthly', emoji: '⚫', weight: 4, tags: ['east-africa'] },
  { match: ['gas cylinder', 'lpg'],               label: 'Cooking gas refill',   category: 'other', defaultQty: 1, unit: 'x',    cadence: 'monthly', emoji: '🔥', weight: 5, tags: ['east-africa','global','staple'] },
  { match: ['matches', 'kibiriti'],               label: 'Matches',              category: 'other', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🔥', weight: 3, tags: ['east-africa','global'] },
  { match: ['candles', 'mishumaa'],               label: 'Candles',              category: 'other', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🕯️', weight: 2, tags: ['east-africa','global'] },
  { match: ['light bulbs'],                       label: 'Light bulbs',          category: 'other', defaultQty: 2, unit: 'x',    cadence: 'as-needed', emoji: '💡', weight: 2, tags: ['global'] },
  { match: ['batteries'],                         label: 'Batteries',            category: 'other', defaultQty: 1, unit: 'pack', cadence: 'as-needed', emoji: '🔋', weight: 2, tags: ['global'] },
  { match: ['mosquito coils', 'doom'],            label: 'Mosquito coils',       category: 'other', defaultQty: 1, unit: 'pack', cadence: 'monthly', emoji: '🦟', weight: 3, tags: ['east-africa','south-asia'] },
  { match: ['insect spray', 'doom spray'],        label: 'Insect spray',         category: 'other', defaultQty: 1, unit: 'bottle', cadence: 'monthly', emoji: '🪰', weight: 2, tags: ['east-africa','global'] },
  { match: ['pet food', 'dog food', 'cat food'],  label: 'Pet food',             category: 'other', defaultQty: 1, unit: 'bag',  cadence: 'monthly', emoji: '🐾', weight: 3, tags: ['pet'] },

  // ── Treats / snacks (kids family) ────────────────────────────────
  { match: ['biscuits', 'cookies'],               label: 'Biscuits',             category: 'pantry', defaultQty: 2, unit: 'pack', cadence: 'biweekly', emoji: '🍪', weight: 3, tags: ['kids','treat'] },
  { match: ['crisps', 'chips', 'crunches'],       label: 'Crisps / chips',       category: 'pantry', defaultQty: 2, unit: 'pack', cadence: 'biweekly', emoji: '🥔', weight: 2, tags: ['kids','treat'] },
  { match: ['chocolate'],                         label: 'Chocolate',            category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'biweekly', emoji: '🍫', weight: 2, tags: ['kids','treat'] },
  { match: ['popcorn', 'bisi'],                   label: 'Popcorn',              category: 'pantry', defaultQty: 1, unit: 'pack', cadence: 'monthly',  emoji: '🍿', weight: 2, tags: ['kids','treat'] },
];

export function suggestStaplesFromDirectory(query: string, max = 8): StapleDirectoryItem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return STAPLES_DIRECTORY
    .filter((s) =>
      s.label.toLowerCase().includes(q) || s.match.some((m) => m.includes(q)),
    )
    .sort((a, b) => b.weight - a.weight)
    .slice(0, max);
}

// ────────────────────────────────────────────────────────────────────
//  Foods Directory — meal-planner inspiration
// ────────────────────────────────────────────────────────────────────

export type FoodMealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'fruit';

export const FOOD_MEAL_TYPES: { id: FoodMealType; label: string; emoji: string }[] = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🥣' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🍱' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🍝' },
  { id: 'snack',     label: 'Snacks',    emoji: '🍪' },
  { id: 'fruit',     label: 'Fruits',    emoji: '🍎' },
];

export interface FoodDirectoryItem {
  match: string[];
  label: string;
  mealTypes: FoodMealType[];
  emoji: string;
  /** Optional matching staple labels in STAPLES_DIRECTORY — when the
   *  user taps "add this to staples" we look these up by label. */
  staples?: string[];
  tags: string[];
  /** Optional one-line description used as a sub-heading. */
  hint?: string;
  /** Future: imageUrl?: string; — Phase 2 will fill these in. */
  imageUrl?: string;
}

export const FOODS_DIRECTORY: FoodDirectoryItem[] = [
  // ── Breakfast ───────────────────────────────────────────────────
  { match: ['mandazi'],          label: 'Mandazi',                 mealTypes: ['breakfast','snack'], emoji: '🍩', staples: ['Wheat flour','Sugar','Milk','Cooking oil'], tags: ['east-africa','vegetarian'], hint: 'East-African fried dough.' },
  { match: ['chapati'],           label: 'Chapati',                 mealTypes: ['breakfast','lunch','dinner'], emoji: '🫓', staples: ['Atta / chapati flour','Cooking oil','Salt'], tags: ['east-africa','south-asia','indian','vegan','vegetarian','halal'] },
  { match: ['uji', 'porridge'],   label: 'Uji (porridge)',          mealTypes: ['breakfast'], emoji: '🥣', staples: ['Maize flour (ugali)','Sugar','Milk'], tags: ['east-africa','kids','vegetarian'] },
  { match: ['oatmeal porridge'],  label: 'Oatmeal',                 mealTypes: ['breakfast'], emoji: '🥣', staples: ['Oats','Milk','Honey','Bananas'], tags: ['global','kids','health-conscious','vegetarian'] },
  { match: ['pancakes'],          label: 'Pancakes',                mealTypes: ['breakfast'], emoji: '🥞', staples: ['Wheat flour','Sugar','Eggs','Milk'], tags: ['global','kids','vegetarian'] },
  { match: ['french toast'],      label: 'French toast',            mealTypes: ['breakfast'], emoji: '🍞', staples: ['Bread','Eggs','Milk','Sugar'], tags: ['global','kids','vegetarian'] },
  { match: ['scrambled eggs'],    label: 'Scrambled eggs',          mealTypes: ['breakfast'], emoji: '🍳', staples: ['Eggs','Milk','Salt','Butter'], tags: ['global','breakfast-staple','protein','vegetarian','halal'] },
  { match: ['boiled eggs'],       label: 'Boiled eggs',             mealTypes: ['breakfast','snack'], emoji: '🥚', staples: ['Eggs','Salt'], tags: ['global','breakfast-staple','protein','vegetarian','halal'] },
  { match: ['toast jam'],         label: 'Toast & jam',             mealTypes: ['breakfast'], emoji: '🍞', staples: ['Bread','Margarine','Jam'], tags: ['global','kids','breakfast-staple','vegetarian'] },
  { match: ['cereal milk'],       label: 'Cereal & milk',           mealTypes: ['breakfast'], emoji: '🥣', staples: ['Cereal','Milk'], tags: ['global','kids','breakfast-staple','vegetarian'] },
  { match: ['yogurt fruit'],      label: 'Yogurt & fruit',          mealTypes: ['breakfast','snack'], emoji: '🥣', staples: ['Yogurt','Bananas','Honey'], tags: ['global','kids','health-conscious','vegetarian'] },
  { match: ['smoothie bowl'],     label: 'Smoothie bowl',           mealTypes: ['breakfast','snack'], emoji: '🥣', staples: ['Bananas','Strawberries','Yogurt','Honey'], tags: ['global','health-conscious','vegetarian'] },
  { match: ['fruit smoothie'],    label: 'Fruit smoothie',          mealTypes: ['breakfast','snack'], emoji: '🥤', staples: ['Bananas','Mangoes','Milk'], tags: ['global','kids','health-conscious','vegetarian'] },
  { match: ['idli'],              label: 'Idli',                    mealTypes: ['breakfast'], emoji: '🍘', staples: ['Rice (white)','Lentils'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['dosa'],              label: 'Dosa',                    mealTypes: ['breakfast','dinner'], emoji: '🫓', staples: ['Rice (white)','Lentils'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['masala dosa'],       label: 'Masala dosa',             mealTypes: ['breakfast','lunch'], emoji: '🫓', staples: ['Rice (white)','Lentils','Potatoes','Onions'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['upma'],              label: 'Upma',                    mealTypes: ['breakfast'], emoji: '🥣', staples: ['Semolina','Onions','Cooking oil'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['paratha'],           label: 'Paratha',                 mealTypes: ['breakfast'], emoji: '🫓', staples: ['Atta / chapati flour','Ghee','Salt'], tags: ['south-asia','indian','vegetarian','halal'] },
  { match: ['aloo paratha'],      label: 'Aloo paratha',            mealTypes: ['breakfast'], emoji: '🫓', staples: ['Atta / chapati flour','Potatoes','Onions','Cumin'], tags: ['south-asia','indian','vegetarian','halal'] },
  { match: ['poha'],              label: 'Poha',                    mealTypes: ['breakfast'], emoji: '🍚', tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['vitumbua'],          label: 'Vitumbua',                mealTypes: ['breakfast','snack'], emoji: '🍩', staples: ['Rice (white)','Coconut milk','Sugar'], tags: ['east-africa','vegetarian','vegan'] },
  { match: ['sausage breakfast'], label: 'Sausages & eggs',         mealTypes: ['breakfast'], emoji: '🌭', staples: ['Sausages','Eggs'], tags: ['global','kids','breakfast-staple'] },
  { match: ['avocado toast'],     label: 'Avocado toast',           mealTypes: ['breakfast'], emoji: '🥑', staples: ['Bread','Avocados','Salt'], tags: ['global','health-conscious','vegetarian','vegan'] },
  { match: ['breakfast burrito'], label: 'Breakfast burrito',       mealTypes: ['breakfast'], emoji: '🌯', staples: ['Atta / chapati flour','Eggs','Cheese','Beans'], tags: ['global','kids','vegetarian'] },
  { match: ['mahamri'],           label: 'Mahamri',                 mealTypes: ['breakfast','snack'], emoji: '🍩', staples: ['Wheat flour','Coconut milk','Cardamom','Sugar'], tags: ['east-africa','vegetarian'] },
  { match: ['katogo'],            label: 'Katogo',                  mealTypes: ['breakfast','lunch'], emoji: '🍌', staples: ['Plantains / matoke','Dry beans','Onions'], tags: ['east-africa','vegetarian'], hint: 'Ugandan plantain-bean stew.' },

  // ── Lunch ───────────────────────────────────────────────────────
  { match: ['ugali sukuma'],      label: 'Ugali & sukuma wiki',     mealTypes: ['lunch','dinner'], emoji: '🥬', staples: ['Maize flour (ugali)','Kale (sukuma wiki)','Cooking oil','Onions','Tomatoes'], tags: ['east-africa','staple','vegetarian','vegan','halal'] },
  { match: ['ugali fish'],        label: 'Ugali & fish',            mealTypes: ['lunch','dinner'], emoji: '🐟', staples: ['Maize flour (ugali)','Fish','Tomatoes','Onions'], tags: ['east-africa','halal'] },
  { match: ['rice beans'],        label: 'Rice & beans',            mealTypes: ['lunch','dinner'], emoji: '🍚', staples: ['Rice (white)','Dry beans','Onions','Tomatoes','Cooking oil'], tags: ['east-africa','global','vegetarian','vegan','halal'] },
  { match: ['pilau'],             label: 'Pilau',                   mealTypes: ['lunch','dinner'], emoji: '🍚', staples: ['Rice (basmati)','Beef','Onions','Cumin','Cardamom'], tags: ['east-africa','south-asia','halal'] },
  { match: ['biryani'],           label: 'Biryani',                 mealTypes: ['lunch','dinner'], emoji: '🍛', staples: ['Basmati rice','Chicken','Onions','Yogurt','Masala / curry powder'], tags: ['south-asia','east-africa','indian','halal'] },
  { match: ['veg biryani'],       label: 'Vegetable biryani',       mealTypes: ['lunch','dinner'], emoji: '🍛', staples: ['Basmati rice','Carrots','Onions','Cauliflower','Masala / curry powder'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['chapati beans'],     label: 'Chapati & beans',         mealTypes: ['lunch','dinner'], emoji: '🫓', staples: ['Atta / chapati flour','Dry beans','Onions'], tags: ['east-africa','vegetarian','vegan','halal'] },
  { match: ['rice stew'],         label: 'Rice & stew',             mealTypes: ['lunch','dinner'], emoji: '🍲', staples: ['Rice (white)','Beef','Tomatoes','Onions'], tags: ['east-africa','global','halal'] },
  { match: ['chicken stew'],      label: 'Chicken stew',            mealTypes: ['lunch','dinner'], emoji: '🍗', staples: ['Chicken','Tomatoes','Onions','Garlic','Ginger'], tags: ['east-africa','global','protein','halal'] },
  { match: ['fish stew'],         label: 'Fish stew',               mealTypes: ['lunch','dinner'], emoji: '🐟', staples: ['Fish','Tomatoes','Onions','Coconut milk','Lemons'], tags: ['east-africa','global','halal'] },
  { match: ['matoke'],            label: 'Matoke',                  mealTypes: ['lunch','dinner'], emoji: '🍌', staples: ['Plantains / matoke','Beef','Onions','Tomatoes'], tags: ['east-africa','halal'] },
  { match: ['sandwich'],          label: 'Sandwich',                mealTypes: ['lunch','snack'], emoji: '🥪', staples: ['Bread','Cheese','Tomatoes','Cucumber'], tags: ['global','kids','vegetarian'] },
  { match: ['veg wrap'],          label: 'Veggie wrap',             mealTypes: ['lunch','snack'], emoji: '🌯', staples: ['Atta / chapati flour','Lettuce','Tomatoes','Cucumber','Avocados'], tags: ['global','vegetarian','vegan','health-conscious'] },
  { match: ['salad'],             label: 'Garden salad',            mealTypes: ['lunch','dinner'], emoji: '🥗', staples: ['Lettuce','Tomatoes','Cucumber','Onions','Olive oil'], tags: ['global','health-conscious','vegetarian','vegan','halal'] },
  { match: ['quinoa salad'],      label: 'Quinoa salad',            mealTypes: ['lunch'], emoji: '🥗', staples: ['Quinoa','Cucumber','Tomatoes','Lemons','Olive oil'], tags: ['global','health-conscious','vegetarian','vegan'] },
  { match: ['lentil soup'],       label: 'Lentil soup',             mealTypes: ['lunch','dinner'], emoji: '🍲', staples: ['Lentils','Onions','Carrots','Garlic','Cumin'], tags: ['global','south-asia','vegetarian','vegan','health-conscious','halal'] },
  { match: ['fried rice'],        label: 'Fried rice',              mealTypes: ['lunch','dinner'], emoji: '🍚', staples: ['Rice (white)','Eggs','Carrots','Soy sauce'], tags: ['global','kids','asian','vegetarian'] },
  { match: ['burgers'],           label: 'Burgers',                 mealTypes: ['lunch','dinner'], emoji: '🍔', staples: ['Beef','Bread','Lettuce','Tomatoes','Cheese'], tags: ['global','kids','treat','halal'] },
  { match: ['veg burger'],        label: 'Veggie burger',           mealTypes: ['lunch','dinner'], emoji: '🍔', staples: ['Bread','Chickpeas','Lettuce','Tomatoes'], tags: ['global','kids','vegetarian','vegan'] },
  { match: ['samosas'],           label: 'Samosas',                 mealTypes: ['lunch','snack'], emoji: '🥟', staples: ['Wheat flour','Beef','Onions','Cumin'], tags: ['east-africa','south-asia','indian','halal'] },
  { match: ['rolex'],             label: 'Rolex',                   mealTypes: ['lunch','snack'], emoji: '🌯', staples: ['Atta / chapati flour','Eggs','Onions','Tomatoes'], tags: ['east-africa','vegetarian'], hint: 'Ugandan chapati-egg roll.' },
  { match: ['dal rice'],          label: 'Dal & rice',              mealTypes: ['lunch','dinner'], emoji: '🍛', staples: ['Lentils','Rice (white)','Turmeric','Cumin'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['chana masala'],      label: 'Chana masala',            mealTypes: ['lunch','dinner'], emoji: '🍛', staples: ['Chickpeas','Tomatoes','Onions','Masala / curry powder'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['rajma'],             label: 'Rajma',                   mealTypes: ['lunch','dinner'], emoji: '🍛', staples: ['Dry beans','Tomatoes','Onions','Masala / curry powder'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['palak paneer'],      label: 'Palak paneer',            mealTypes: ['lunch','dinner'], emoji: '🥬', staples: ['Paneer','Spinach','Onions','Garlic'], tags: ['south-asia','indian','vegetarian','halal'] },
  { match: ['aloo gobi'],         label: 'Aloo gobi',               mealTypes: ['lunch','dinner'], emoji: '🥔', staples: ['Potatoes','Cauliflower','Turmeric','Cumin'], tags: ['south-asia','indian','vegetarian','vegan','halal'] },
  { match: ['saag'],              label: 'Saag',                    mealTypes: ['lunch','dinner'], emoji: '🥬', staples: ['Spinach','Onions','Garlic','Cumin'], tags: ['south-asia','indian','vegetarian','vegan','health-conscious','halal'] },

  // ── Dinner ──────────────────────────────────────────────────────
  { match: ['nyama choma'],       label: 'Nyama choma',             mealTypes: ['dinner'], emoji: '🍖', staples: ['Goat meat','Salt','Onions'], tags: ['east-africa','protein','halal'] },
  { match: ['mishkaki'],          label: 'Mishkaki',                mealTypes: ['dinner','snack'], emoji: '🍢', staples: ['Beef','Onions','Cumin','Salt'], tags: ['east-africa','protein','halal'] },
  { match: ['spaghetti bolognese'], label: 'Spaghetti bolognese',   mealTypes: ['dinner'], emoji: '🍝', staples: ['Pasta','Beef','Tomatoes','Onions','Garlic'], tags: ['global','kids','halal'] },
  { match: ['pasta tomato'],      label: 'Pasta & tomato sauce',    mealTypes: ['dinner'], emoji: '🍝', staples: ['Pasta','Canned tomatoes','Garlic','Olive oil'], tags: ['global','kids','vegetarian','vegan','halal'] },
  { match: ['pasta pesto'],       label: 'Pasta pesto',             mealTypes: ['dinner'], emoji: '🍝', staples: ['Pasta','Olive oil','Garlic','Cheese'], tags: ['global','vegetarian'] },
  { match: ['mac cheese'],        label: 'Mac & cheese',            mealTypes: ['dinner'], emoji: '🧀', staples: ['Pasta','Cheese','Milk','Butter'], tags: ['global','kids','treat','vegetarian'] },
  { match: ['fried chicken chips'], label: 'Fried chicken & chips', mealTypes: ['dinner'], emoji: '🍗', staples: ['Chicken','Potatoes','Cooking oil'], tags: ['east-africa','global','kids','halal'] },
  { match: ['grilled chicken'],   label: 'Grilled chicken & veg',   mealTypes: ['dinner'], emoji: '🍗', staples: ['Chicken','Bell pepper','Onions','Olive oil'], tags: ['global','health-conscious','protein','halal'] },
  { match: ['pizza'],             label: 'Pizza',                   mealTypes: ['dinner'], emoji: '🍕', staples: ['Wheat flour','Cheese','Canned tomatoes','Yeast'], tags: ['global','kids','treat','vegetarian'] },
  { match: ['curry'],             label: 'Beef curry',              mealTypes: ['dinner'], emoji: '🍛', staples: ['Beef','Tomatoes','Onions','Masala / curry powder','Coconut milk'], tags: ['south-asia','east-africa','indian','halal'] },
  { match: ['butter chicken'],    label: 'Butter chicken',          mealTypes: ['dinner'], emoji: '🍛', staples: ['Chicken','Tomatoes','Cream','Masala / curry powder'], tags: ['south-asia','indian','halal'] },
  { match: ['paneer butter'],     label: 'Paneer butter masala',    mealTypes: ['dinner'], emoji: '🍛', staples: ['Paneer','Tomatoes','Cream','Masala / curry powder'], tags: ['south-asia','indian','vegetarian','halal'] },
  { match: ['tofu stir fry'],     label: 'Tofu stir-fry',           mealTypes: ['dinner'], emoji: '🥦', staples: ['Broccoli','Bell pepper','Garlic','Soy sauce','Rice (white)'], tags: ['global','asian','vegetarian','vegan','health-conscious'] },
  { match: ['vegetable stir fry'],label: 'Vegetable stir-fry',      mealTypes: ['dinner'], emoji: '🥦', staples: ['Broccoli','Carrots','Bell pepper','Garlic','Soy sauce'], tags: ['global','asian','vegetarian','vegan','health-conscious'] },
  { match: ['fish chips'],        label: 'Fish & chips',            mealTypes: ['dinner'], emoji: '🐟', staples: ['Fish','Potatoes','Cooking oil'], tags: ['global','kids','halal'] },
  { match: ['stew rice'],         label: 'Stew & rice',             mealTypes: ['dinner'], emoji: '🍲', staples: ['Beef','Rice (white)','Onions','Tomatoes'], tags: ['east-africa','global','halal'] },
  { match: ['veg stew rice'],     label: 'Vegetable stew & rice',   mealTypes: ['dinner'], emoji: '🍲', staples: ['Rice (white)','Carrots','Potatoes','Onions','Tomatoes'], tags: ['global','vegetarian','vegan','halal'] },
  { match: ['roast vegetables'],  label: 'Roast veggies & rice',    mealTypes: ['dinner'], emoji: '🥕', staples: ['Carrots','Potatoes','Bell pepper','Olive oil','Rice (white)'], tags: ['global','vegetarian','vegan','health-conscious','halal'] },

  // ── Snacks ──────────────────────────────────────────────────────
  { match: ['popcorn snack'],     label: 'Popcorn',                 mealTypes: ['snack'], emoji: '🍿', staples: ['Popcorn','Salt','Butter'], tags: ['kids','treat'] },
  { match: ['biscuit snack'],     label: 'Biscuits',                mealTypes: ['snack'], emoji: '🍪', staples: ['Biscuits'], tags: ['kids','treat'] },
  { match: ['crisp snack'],       label: 'Crisps',                  mealTypes: ['snack'], emoji: '🥔', staples: ['Crisps / chips'], tags: ['kids','treat'] },
  { match: ['fruit snack'],       label: 'Fruit plate',             mealTypes: ['snack','fruit'], emoji: '🍇', staples: ['Apples','Bananas','Grapes'], tags: ['kids','health-conscious'] },
  { match: ['nuts snack'],        label: 'Mixed nuts',              mealTypes: ['snack'], emoji: '🥜', tags: ['global','health-conscious'] },
  { match: ['samosas snack'],     label: 'Samosas',                 mealTypes: ['snack'], emoji: '🥟', staples: ['Wheat flour','Onions'], tags: ['east-africa','south-asia'] },
  { match: ['kachori'],           label: 'Kachori',                 mealTypes: ['snack'], emoji: '🥟', staples: ['Wheat flour','Lentils'], tags: ['south-asia','indian'] },

  // ── Fruits ──────────────────────────────────────────────────────
  { match: ['mango fruit'],       label: 'Mango',                   mealTypes: ['fruit','snack'], emoji: '🥭', staples: ['Mangoes'], tags: ['east-africa','south-asia','kids'] },
  { match: ['banana fruit'],      label: 'Banana',                  mealTypes: ['fruit','snack'], emoji: '🍌', staples: ['Bananas'], tags: ['global','kids'] },
  { match: ['apple fruit'],       label: 'Apple',                   mealTypes: ['fruit','snack'], emoji: '🍎', staples: ['Apples'], tags: ['global','kids'] },
  { match: ['orange fruit'],      label: 'Orange',                  mealTypes: ['fruit','snack'], emoji: '🍊', staples: ['Oranges'], tags: ['global','kids'] },
  { match: ['pineapple fruit'],   label: 'Pineapple',               mealTypes: ['fruit','snack'], emoji: '🍍', staples: ['Pineapple'], tags: ['east-africa','global'] },
  { match: ['watermelon fruit'],  label: 'Watermelon',              mealTypes: ['fruit','snack'], emoji: '🍉', staples: ['Watermelon'], tags: ['east-africa','global','kids'] },
  { match: ['papaya fruit'],      label: 'Papaya',                  mealTypes: ['fruit','snack'], emoji: '🥭', staples: ['Papaya'], tags: ['east-africa'] },
  { match: ['passion fruit fruit'], label: 'Passion fruit',         mealTypes: ['fruit','snack'], emoji: '🍈', staples: ['Passion fruit'], tags: ['east-africa'] },
  { match: ['grape fruit'],       label: 'Grapes',                  mealTypes: ['fruit','snack'], emoji: '🍇', staples: ['Grapes'], tags: ['global','kids'] },
  { match: ['avocado fruit'],     label: 'Avocado',                 mealTypes: ['fruit','snack'], emoji: '🥑', staples: ['Avocados'], tags: ['east-africa','global'] },
  { match: ['strawberry fruit'],  label: 'Strawberries',            mealTypes: ['fruit','snack'], emoji: '🍓', staples: ['Strawberries'], tags: ['global','kids','treat'] },
  { match: ['mixed fruit'],       label: 'Mixed fruit bowl',        mealTypes: ['fruit','snack'], emoji: '🍇', staples: ['Bananas','Apples','Mangoes','Grapes'], tags: ['global','kids','health-conscious','vegan','vegetarian'] },
  { match: ['fruit yogurt'],      label: 'Fruit & yogurt parfait',  mealTypes: ['fruit','snack'], emoji: '🥣', staples: ['Yogurt','Bananas','Strawberries','Honey'], tags: ['global','kids','health-conscious','vegetarian'] },
];

export function searchFoods(query: string, mealType?: FoodMealType, max = 24): FoodDirectoryItem[] {
  const q = query.trim().toLowerCase();
  let pool = FOODS_DIRECTORY;
  if (mealType) pool = pool.filter((f) => f.mealTypes.includes(mealType));
  if (q.length >= 2) {
    pool = pool.filter((f) => f.label.toLowerCase().includes(q) || f.match.some((m) => m.includes(q)));
  }
  return pool.slice(0, max);
}

// ────────────────────────────────────────────────────────────────────
//  Weekly meal-plan suggester
// ────────────────────────────────────────────────────────────────────

export interface MealPlanFilters {
  /** Region tag — 'east-africa', 'south-asia', 'global', or 'all'. */
  region?: 'east-africa' | 'south-asia' | 'global' | 'all';
  /** Diet — 'vegetarian', 'vegan', 'halal', or undefined (no diet filter). */
  diet?: 'vegetarian' | 'vegan' | 'halal';
  /** When true, prefers items tagged 'kids'. */
  kidFriendly?: boolean;
}

/** Pool of foods matching the filters, ranked-ish by tag-overlap. */
export function foodsMatching(filters: MealPlanFilters, mealType: FoodMealType): FoodDirectoryItem[] {
  return FOODS_DIRECTORY
    .filter((f) => f.mealTypes.includes(mealType))
    .filter((f) => {
      if (filters.diet && !f.tags.includes(filters.diet)) return false;
      if (filters.region && filters.region !== 'all') {
        // 'global' matches anything tagged 'global' OR untagged regions.
        if (filters.region === 'global') return f.tags.includes('global');
        return f.tags.includes(filters.region);
      }
      return true;
    })
    .sort((a, b) => {
      const score = (item: FoodDirectoryItem) => {
        let s = 0;
        if (filters.kidFriendly && item.tags.includes('kids')) s += 2;
        if (filters.region && filters.region !== 'all' && item.tags.includes(filters.region)) s += 1;
        return s;
      };
      return score(b) - score(a);
    });
}

/** Build a 7-day plan from the directory. Picks a deterministic-ish
 *  but varied set so the same filters produce different output on
 *  refresh (we shuffle the candidate pool). The output map matches
 *  MealPlan.days shape so the meals page can patch directly. */
export function suggestWeeklyMealPlan(filters: MealPlanFilters): Record<string, { breakfast?: string; lunch?: string; dinner?: string }> {
  const days = ['mon','tue','wed','thu','fri','sat','sun'] as const;
  const breakfasts = shuffle(foodsMatching(filters, 'breakfast'));
  const lunches    = shuffle(foodsMatching(filters, 'lunch'));
  const dinners    = shuffle(foodsMatching(filters, 'dinner'));

  // Round-robin pick. If the pool is shorter than 7 we cycle.
  const pick = (pool: FoodDirectoryItem[], i: number) => pool.length > 0 ? pool[i % pool.length].label : undefined;

  const plan: Record<string, { breakfast?: string; lunch?: string; dinner?: string }> = {};
  days.forEach((d, i) => {
    plan[d] = {
      breakfast: pick(breakfasts, i),
      lunch:     pick(lunches, i),
      dinner:    pick(dinners, i),
    };
  });
  return plan;
}

function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────
//  AI Onboarding · rule-based parser
// ────────────────────────────────────────────────────────────────────

export interface OnboardingProfile {
  /** Total household size — drives qty scaling. Defaults to 4. */
  size: number;
  /** Number of kids (subset of size). */
  kids: number;
  /** Number of babies/infants — adds diapers/formula etc. */
  babies: number;
  /** Tags inferred from the description: 'vegetarian', 'halal',
   *  'kids', 'health-conscious', 'south-asia', 'east-africa', 'pet'… */
  tags: Set<string>;
  /** Lowercase name fragments the parent typed verbatim — e.g.
   *  ['pishori', 'omo']. Used for brand-preference attachment. */
  brands: string[];
  /** Lowercase tokens the parent explicitly *excluded* — driven by
   *  "no", "without", "don't eat" phrases. */
  excludes: string[];
}

const DIET_TAGS: Record<string, string> = {
  'vegetarian': 'vegetarian',
  'veggie': 'vegetarian',
  'vegan': 'vegan',
  'halal': 'halal',
  'kosher': 'kosher',
  'no pork': 'halal',
  'no beef': 'no-beef',
  'no meat': 'vegetarian',
  'gluten free': 'gluten-free',
};

const REGION_TAGS: Record<string, string> = {
  'tanzania': 'east-africa',
  'tanzanian': 'east-africa',
  'kenya': 'east-africa',
  'kenyan': 'east-africa',
  'uganda': 'east-africa',
  'ugandan': 'east-africa',
  'east africa': 'east-africa',
  'east african': 'east-africa',
  'india': 'south-asia',
  'indian': 'south-asia',
  'pakistani': 'south-asia',
  'south asian': 'south-asia',
};

const LIFESTYLE_TAGS: Record<string, string> = {
  'baby': 'baby',
  'infant': 'baby',
  'toddler': 'baby',
  'newborn': 'baby',
  'pet': 'pet',
  'dog': 'pet',
  'cat': 'pet',
  'health': 'health-conscious',
  'healthy': 'health-conscious',
  'organic': 'health-conscious',
};

/** Pull the family size out of phrases like "family of 5", "5 of us",
 *  "we are 4". Returns undefined if no signal. */
function parseSize(text: string): number | undefined {
  const m = text.match(/family of (\d+)|(\d+) of us|we are (\d+)|household of (\d+)|(\d+)\s*(?:adults?|people)/i);
  if (m) {
    for (let i = 1; i < m.length; i++) {
      if (m[i]) return Math.max(1, Math.min(20, parseInt(m[i], 10)));
    }
  }
  return undefined;
}

function parseKids(text: string): number {
  const m = text.match(/(\d+)\s*(?:kid|kids|child|children)/i);
  return m ? parseInt(m[1], 10) : 0;
}

function parseBabies(text: string): number {
  if (/(baby|infant|toddler|newborn)/i.test(text)) {
    const m = text.match(/(\d+)\s*(?:baby|babies|infants?|toddlers?)/i);
    return m ? parseInt(m[1], 10) : 1;
  }
  return 0;
}

function parseExcludes(text: string): string[] {
  const out: string[] = [];
  const phrases = text.toLowerCase().split(/[.,;\n]/);
  for (const p of phrases) {
    const m = p.match(/(?:no|without|don'?t (?:eat|use|like)|avoid)\s+([\w\s-]+)/);
    if (m) out.push(m[1].trim());
  }
  return out;
}

function parseTags(text: string): Set<string> {
  const t = text.toLowerCase();
  const out = new Set<string>();
  for (const [k, v] of Object.entries({ ...DIET_TAGS, ...REGION_TAGS, ...LIFESTYLE_TAGS })) {
    if (t.includes(k)) out.add(v);
  }
  return out;
}

/** Free-text "I have a family of 4 in Tanzania, with 2 kids, we love
 *  rice and chapati, no pork" → structured profile. */
export function parseFamilyDescription(text: string): OnboardingProfile {
  const tags = parseTags(text);
  const excludes = parseExcludes(text);
  const kids = parseKids(text);
  const babies = parseBabies(text);
  const size = parseSize(text) ?? Math.max(2, kids + babies + 2);
  // Brand fragments: any quoted token, plus a small list of known
  // brand-likes ("pishori", "omo", "blue band", "milo", "royco").
  const brands: string[] = [];
  const brandHints = ['pishori', 'daawat', 'basmati', 'omo', 'persil', 'blue band', 'milo', 'royco', 'maggi', 'ribena', 'pampers', 'nan', 'cerelac'];
  const lower = text.toLowerCase();
  for (const b of brandHints) if (lower.includes(b)) brands.push(b);
  return { size, kids, babies, tags, brands, excludes };
}

export interface SeededStaple {
  item: StapleDirectoryItem;
  /** Scaled qty based on household size. */
  qty: number;
  /** Brand fragments extracted from the parent's text that match this
   *  item, copied to `preferredBrands` on save. */
  brands: string[];
  /** Why we picked this — 'staple', 'tag-match:east-africa', 'kids',
   *  'baby', etc. Surfaces in the review screen so the parent can
   *  trust the AI. */
  reasons: string[];
}

const STAPLE_CORE_TAGS = new Set(['staple', 'global']);

/** Rule-based seeding. Picks ~25-40 directory items based on the
 *  profile, scales qty, attaches brand fragments. The returned list
 *  is what the onboarding review screen renders for one-tap save. */
export function seedStaplesFromProfile(profile: OnboardingProfile, max = 40): SeededStaple[] {
  const out: SeededStaple[] = [];
  const sizeMultiplier = profile.size / 4; // catalog defaults assume family-of-4

  for (const item of STAPLES_DIRECTORY) {
    const reasons: string[] = [];

    // Hard exclusions: skip items whose tags conflict with diet flags.
    if (profile.tags.has('vegetarian') && item.tags.includes('protein') &&
        ['Beef','Goat meat','Lamb','Mutton','Pork','Bacon','Sausages','Chicken','Fish','Prawns'].includes(item.label)) {
      continue;
    }
    if (profile.tags.has('halal') && item.tags.includes('non-halal')) continue;
    if (profile.tags.has('vegan') && (item.category === 'dairy' || item.tags.includes('protein'))) continue;
    if (profile.excludes.some((ex) =>
      ex && (item.label.toLowerCase().includes(ex) || item.match.some((m) => m.includes(ex))),
    )) continue;
    // No babies → skip baby section.
    if (item.tags.includes('baby') && profile.babies === 0 && !profile.tags.has('baby')) continue;
    if (item.tags.includes('pet') && !profile.tags.has('pet')) continue;

    // Pick rules — any one match earns the item.
    let pick = false;
    if (item.weight >= 4 && item.tags.some((t) => STAPLE_CORE_TAGS.has(t))) {
      pick = true; reasons.push('staple');
    }
    profile.tags.forEach((tag) => {
      if (item.tags.includes(tag)) { pick = true; reasons.push(`tag:${tag}`); }
    });
    if (item.tags.includes('kids') && (profile.kids > 0 || profile.babies > 0)) {
      pick = true; reasons.push('kids');
    }
    if (item.tags.includes('baby') && (profile.babies > 0 || profile.tags.has('baby'))) {
      pick = true; reasons.push('baby');
    }
    if (item.tags.includes('breakfast-staple') && item.weight >= 3) {
      pick = true; reasons.push('breakfast');
    }

    if (!pick) continue;

    // Brands the parent mentioned that match this item's match[].
    const brands = profile.brands.filter((b) =>
      item.match.some((m) => m.includes(b)) || item.label.toLowerCase().includes(b),
    );

    const scaledQty = Math.max(1, Math.round(item.defaultQty * Math.max(0.6, Math.min(2.5, sizeMultiplier))));

    out.push({ item, qty: scaledQty, brands, reasons: Array.from(new Set(reasons)) });
  }

  // Rank: weight desc, then number of reasons desc.
  out.sort((a, b) => (b.item.weight - a.item.weight) || (b.reasons.length - a.reasons.length));

  return out.slice(0, max);
}
