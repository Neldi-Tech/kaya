// /pantry/directory — "Browse everything" catalog. Powers the
// directory page where parents can browse a curated set of common
// household staples + popular dishes, multi-select, and bulk-add to
// their family's staples list.
//
// Two surfaces:
//   STAPLES (DIRECTORY_STAPLES) — pantry items split into Food and
//     Household (matches the in-app StapleCategory). Each entry
//     carries a region tag so the East-Africa / South-Asia / Global
//     filter can narrow the grid.
//
//   FOODS (DIRECTORY_FOODS) — common dishes. Each food carries a list
//     of ingredient labels that map back into DIRECTORY_STAPLES, so a
//     single tap on "+ Staples" adds every ingredient at once.
//
// The catalog is intentionally hand-curated rather than fetched from
// a backend — these defaults change rarely, and shipping them in the
// bundle keeps the directory instant for users on slow connections.

import type { Cadence, StapleCategory } from './pantry';
import type { StapleSuggestion } from './pantryStapleSuggestions';

export type Region = 'east-africa' | 'south-asia' | 'global';
export type Surface = 'food' | 'household';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'fruit';
export type Diet = 'vegetarian' | 'vegan' | 'halal';

export interface DirectoryStaple extends StapleSuggestion {
  /** Where this item lives in the catalog tabs. Drives Food vs
   *  Household toggle. Derived from `category` in most cases but
   *  stored explicitly so the data is easy to audit. */
  surface: Surface;
  /** Cultural / geographic origin. `global` items are universally
   *  common; region-specific items show under that region's filter
   *  only. */
  region: Region;
  /** Optional one-liner shown under the qty/cadence — usually a
   *  brand hint ("Pishori, basmati, jasmine — all common."). */
  note?: string;
}

export interface DirectoryFood {
  /** Lowercase keys for search. */
  match: string[];
  label: string;
  emoji: string;
  meals: MealType[];
  region: Region;
  diets: Diet[];
  /** Ingredient labels — must match a `label` in DIRECTORY_STAPLES.
   *  When the user taps "+ Staples" we look these up and add the
   *  corresponding staples to the family's master list. */
  ingredients: string[];
}

// ── Region helpers ────────────────────────────────────────────────

export const REGIONS: { id: Region | 'any'; emoji: string; label: string }[] = [
  { id: 'any',          emoji: '🌍', label: 'Any region' },
  { id: 'east-africa',  emoji: '🇹🇿', label: 'East Africa' },
  { id: 'south-asia',   emoji: '🇮🇳', label: 'South Asia' },
  { id: 'global',       emoji: '🌐', label: 'Global' },
];

export const DIETS: { id: Diet | 'any'; emoji: string; label: string }[] = [
  { id: 'any',         emoji: '🥗', label: 'Any diet' },
  { id: 'vegetarian',  emoji: '🥬', label: 'Vegetarian' },
  { id: 'vegan',       emoji: '🌱', label: 'Vegan' },
  { id: 'halal',       emoji: '☪️', label: 'Halal' },
];

export const MEALS: { id: MealType | 'all'; emoji: string; label: string }[] = [
  { id: 'all',        emoji: '🍽️', label: 'All meals' },
  { id: 'breakfast',  emoji: '🥣', label: 'Breakfast' },
  { id: 'lunch',      emoji: '🍱', label: 'Lunch' },
  { id: 'dinner',     emoji: '🍛', label: 'Dinner' },
  { id: 'snack',      emoji: '🍪', label: 'Snacks' },
  { id: 'fruit',      emoji: '🍎', label: 'Fruits' },
];

// ── Sub-category chip sets per surface ───────────────────────────

export const FOOD_CATEGORY_CHIPS: { id: StapleCategory | 'all'; emoji: string; label: string }[] = [
  { id: 'all',     emoji: '✨', label: 'All' },
  { id: 'produce', emoji: '🥬', label: 'Produce' },
  { id: 'dairy',   emoji: '🥛', label: 'Dairy' },
  { id: 'pantry',  emoji: '🍚', label: 'Pantry' },
];

export const HOUSEHOLD_CATEGORY_CHIPS: { id: StapleCategory | 'all'; emoji: string; label: string }[] = [
  { id: 'all',      emoji: '✨', label: 'All' },
  { id: 'cleaning', emoji: '🧴', label: 'Cleaning' },
  { id: 'personal', emoji: '🧴', label: 'Personal' },
  { id: 'other',    emoji: '✨', label: 'Other' },
];

// ── Staples catalog ──────────────────────────────────────────────
// Conventions:
//   - `defaultQty` + `unit` reflect what a typical family of four
//     buys in one cycle of `cadence`.
//   - Brand notes go in `note`; the WhatsApp message can lift these
//     verbatim later.
//   - Region 'global' = ubiquitous; 'east-africa' / 'south-asia' =
//     items the catalog should surface under that region's filter.

const _C = (
  id: StapleCategory,
  surface: Surface,
  region: Region,
  emoji: string,
  cadence: Cadence,
) => ({ category: id, surface, region, emoji, cadence });

// Helper-built rows keep the table readable at ~167 items.
type _Row = Omit<DirectoryStaple, 'category' | 'surface' | 'region' | 'emoji' | 'cadence'> & {
  c: ReturnType<typeof _C>;
};

const _row = (label: string, match: string[], qty: number, unit: string, c: ReturnType<typeof _C>, note?: string): DirectoryStaple => ({
  label, match, defaultQty: qty, unit, note,
  category: c.category, surface: c.surface, region: c.region, emoji: c.emoji, cadence: c.cadence,
});

export const DIRECTORY_STAPLES: DirectoryStaple[] = [
  // ── FOOD · PANTRY · GLOBAL ─────────────────────────────────────
  _row('Rice (white)',         ['rice','mchele','chawal'],         5, 'kg',     _C('pantry','food','global','🍚','biweekly'), 'Pishori, basmati, jasmine — all common.'),
  _row('Rice (brown)',         ['brown rice'],                      2, 'kg',     _C('pantry','food','global','🍚','monthly')),
  _row('Wheat flour',          ['wheat flour','flour','unga'],      2, 'kg',     _C('pantry','food','global','🌾','biweekly')),
  _row('Sugar',                ['sugar','sukari','chini'],          2, 'kg',     _C('pantry','food','global','🍬','biweekly')),
  _row('Brown sugar',          ['brown sugar'],                     1, 'kg',     _C('pantry','food','global','🍬','monthly')),
  _row('Salt',                 ['salt','chumvi','namak'],           1, 'pkt',    _C('pantry','food','global','🧂','monthly')),
  _row('Cooking oil',          ['cooking oil','oil','tel'],         5, 'L',      _C('pantry','food','global','🫙','monthly'), 'Sunflower or vegetable blend.'),
  _row('Olive oil',            ['olive oil'],                       1, 'L',      _C('pantry','food','global','🫒','monthly')),
  _row('Vinegar',              ['vinegar'],                         1, 'bottle', _C('pantry','food','global','🧪','monthly')),
  _row('Soy sauce',            ['soy sauce'],                       1, 'bottle', _C('pantry','food','global','🧴','monthly')),
  _row('Tomato sauce',         ['tomato sauce','ketchup'],          1, 'bottle', _C('pantry','food','global','🥫','monthly')),
  _row('Tomato paste',         ['tomato paste'],                    2, 'tin',    _C('pantry','food','global','🥫','monthly')),
  _row('Honey',                ['honey','asali'],                   1, 'jar',    _C('pantry','food','global','🍯','monthly')),
  _row('Jam',                  ['jam'],                             1, 'jar',    _C('pantry','food','global','🍓','monthly')),
  _row('Peanut butter',        ['peanut butter'],                   1, 'jar',    _C('pantry','food','global','🥜','monthly')),
  _row('Tea',                  ['tea','chai'],                      1, 'pack',   _C('pantry','food','global','🍵','biweekly')),
  _row('Coffee',               ['coffee','kahawa'],                 1, 'pkt',    _C('pantry','food','global','☕','monthly')),
  _row('Pasta',                ['pasta','spaghetti'],               2, 'pack',   _C('pantry','food','global','🍝','biweekly')),
  _row('Noodles',              ['noodles','indomie'],               4, 'pack',   _C('pantry','food','global','🍜','biweekly')),
  _row('Beans (dry)',          ['beans','maharage','rajma'],        2, 'kg',     _C('pantry','food','global','🫘','monthly')),
  _row('Lentils',              ['lentils','dengu','dal','toor'],    1, 'kg',     _C('pantry','food','global','🫘','monthly')),
  _row('Chickpeas',            ['chickpeas','chana'],               1, 'kg',     _C('pantry','food','global','🫛','monthly')),
  _row('Green grams',          ['green grams','ndengu','moong'],    1, 'kg',     _C('pantry','food','global','🫘','monthly')),
  _row('Bread',                ['bread','mkate'],                   3, 'x',      _C('pantry','food','global','🥖','weekly')),
  _row('Cereal',               ['cereal','cornflakes'],             1, 'box',    _C('pantry','food','global','🥣','biweekly')),
  _row('Oats',                 ['oats','oatmeal'],                  1, 'pack',   _C('pantry','food','global','🥣','monthly')),
  _row('Baking powder',        ['baking powder'],                   1, 'tin',    _C('pantry','food','global','🧁','monthly')),
  _row('Baking soda',          ['baking soda'],                     1, 'pkt',    _C('pantry','food','global','🧁','monthly')),
  _row('Yeast',                ['yeast'],                           1, 'pkt',    _C('pantry','food','global','🍞','monthly')),
  _row('Cocoa powder',         ['cocoa'],                           1, 'tin',    _C('pantry','food','global','🍫','monthly')),
  _row('Drinking chocolate',   ['drinking chocolate','milo'],       1, 'tin',    _C('pantry','food','global','🥤','monthly')),
  _row('Spices · black pepper',['black pepper','pepper'],           1, 'pkt',    _C('pantry','food','global','🌶️','monthly')),
  _row('Spices · curry powder',['curry powder'],                    1, 'pkt',    _C('pantry','food','global','🧂','monthly')),
  _row('Spices · cumin',       ['cumin','jeera'],                   1, 'pkt',    _C('pantry','food','global','🌿','monthly')),
  _row('Spices · turmeric',    ['turmeric','haldi'],                1, 'pkt',    _C('pantry','food','global','🌿','monthly')),
  _row('Spices · paprika',     ['paprika'],                         1, 'pkt',    _C('pantry','food','global','🌶️','monthly')),
  _row('Spices · cinnamon',    ['cinnamon'],                        1, 'pkt',    _C('pantry','food','global','🌿','monthly')),
  _row('Spices · cardamom',    ['cardamom','iliki','elaichi'],      1, 'pkt',    _C('pantry','food','global','🌿','monthly')),
  _row('Spices · cloves',      ['cloves','karafuu'],                1, 'pkt',    _C('pantry','food','global','🌿','monthly')),
  _row('Mustard',              ['mustard'],                         1, 'jar',    _C('pantry','food','global','🌭','monthly')),
  _row('Mayonnaise',           ['mayonnaise','mayo'],               1, 'jar',    _C('pantry','food','global','🥚','monthly')),
  _row('Stock cubes',          ['stock cubes','royco','maggi'],     1, 'pack',   _C('pantry','food','global','🧂','monthly')),
  _row('Canned tuna',          ['tuna'],                            2, 'tin',    _C('pantry','food','global','🐟','biweekly')),
  _row('Canned beans',         ['canned beans'],                    2, 'tin',    _C('pantry','food','global','🥫','monthly')),

  // ── FOOD · PANTRY · EAST AFRICA ────────────────────────────────
  _row('Maize flour (ugali)',  ['maize flour','ugali','sembe','dona'], 2, 'kg',  _C('pantry','food','east-africa','🌽','weekly'), 'Sembe / dona for ugali.'),
  _row('Sorghum flour',        ['sorghum','mtama'],                 1, 'kg',     _C('pantry','food','east-africa','🌾','monthly')),
  _row('Cassava flour',        ['cassava flour','muhogo'],          1, 'kg',     _C('pantry','food','east-africa','🌾','monthly')),
  _row('Millet flour',         ['millet','wimbi','ragi'],           1, 'kg',     _C('pantry','food','east-africa','🌾','monthly')),
  _row('Coconut milk',         ['coconut milk','nazi'],             2, 'tin',    _C('pantry','food','east-africa','🥥','monthly')),
  _row('Tamarind',             ['tamarind','ukwaju','imli'],        1, 'pkt',    _C('pantry','food','east-africa','🌿','monthly')),
  _row('Pilau masala',         ['pilau masala','pilau'],            1, 'pkt',    _C('pantry','food','east-africa','🌿','monthly')),
  _row('Royco mchuzi mix',     ['royco','mchuzi mix'],              1, 'pack',   _C('pantry','food','east-africa','🌿','monthly')),
  _row('Mahindi (dry maize)',  ['mahindi','dry maize'],             1, 'kg',     _C('pantry','food','east-africa','🌽','monthly')),

  // ── FOOD · PANTRY · SOUTH ASIA ─────────────────────────────────
  _row('Atta / chapati flour', ['atta','chapati flour'],            2, 'kg',     _C('pantry','food','south-asia','🌾','biweekly')),
  _row('Basmati rice',         ['basmati'],                         5, 'kg',     _C('pantry','food','south-asia','🍚','monthly')),
  _row('Toor dal',             ['toor','arhar dal'],                1, 'kg',     _C('pantry','food','south-asia','🫘','monthly')),
  _row('Chana dal',            ['chana dal'],                       1, 'kg',     _C('pantry','food','south-asia','🫘','monthly')),
  _row('Urad dal',             ['urad','urad dal'],                 1, 'kg',     _C('pantry','food','south-asia','🫘','monthly')),
  _row('Moong dal',            ['moong dal'],                       1, 'kg',     _C('pantry','food','south-asia','🫘','monthly')),
  _row('Semolina',             ['semolina','sooji','rava'],         1, 'pkt',    _C('pantry','food','south-asia','🌾','monthly')),
  _row('Poha (flattened rice)',['poha'],                            1, 'pkt',    _C('pantry','food','south-asia','🍚','monthly')),
  _row('Ghee',                 ['ghee'],                            1, 'jar',    _C('pantry','food','south-asia','🧈','monthly')),
  _row('Mustard seeds',        ['mustard seeds','rai'],             1, 'pkt',    _C('pantry','food','south-asia','🌿','monthly')),
  _row('Curry leaves',         ['curry leaves'],                    1, 'pkt',    _C('pantry','food','south-asia','🌿','biweekly')),
  _row('Hing (asafoetida)',    ['hing','asafoetida'],               1, 'pkt',    _C('pantry','food','south-asia','🌿','monthly')),
  _row('Garam masala',         ['garam masala'],                    1, 'pkt',    _C('pantry','food','south-asia','🌿','monthly')),
  _row('Sambar masala',        ['sambar masala'],                   1, 'pkt',    _C('pantry','food','south-asia','🌿','monthly')),
  _row('Chaat masala',         ['chaat masala'],                    1, 'pkt',    _C('pantry','food','south-asia','🌿','monthly')),
  _row('Idli rava',            ['idli rava'],                       1, 'pkt',    _C('pantry','food','south-asia','🌾','monthly')),
  _row('Papad',                ['papad','papadum'],                 1, 'pack',   _C('pantry','food','south-asia','🥖','monthly')),
  _row('Pickle (achaar)',      ['achaar','pickle'],                 1, 'jar',    _C('pantry','food','south-asia','🥒','monthly')),

  // ── FOOD · PRODUCE · GLOBAL ────────────────────────────────────
  _row('Tomatoes',             ['tomatoes','tomato','nyanya'],      2, 'kg',     _C('produce','food','global','🍅','weekly')),
  _row('Onions',               ['onions','onion','vitunguu','pyaaz'], 2,'kg',    _C('produce','food','global','🧅','weekly')),
  _row('Potatoes',             ['potatoes','potato','viazi','aloo'], 3,'kg',     _C('produce','food','global','🥔','weekly')),
  _row('Sweet potatoes',       ['sweet potato','viazi vitamu'],     2, 'kg',     _C('produce','food','global','🍠','weekly')),
  _row('Carrots',              ['carrots','carrot','karoti','gajar'], 1,'kg',    _C('produce','food','global','🥕','weekly')),
  _row('Cabbage',              ['cabbage','kabichi','patta gobi'],  1, 'x',      _C('produce','food','global','🥬','weekly')),
  _row('Cauliflower',          ['cauliflower','phool gobi'],        1, 'x',      _C('produce','food','global','🥦','weekly')),
  _row('Broccoli',             ['broccoli'],                        1, 'x',      _C('produce','food','global','🥦','weekly')),
  _row('Cucumber',             ['cucumber','tango','khira'],        2, 'x',      _C('produce','food','global','🥒','weekly')),
  _row('Bell peppers',         ['bell pepper','capsicum','pilipili hoho'], 3,'x',_C('produce','food','global','🫑','weekly')),
  _row('Garlic',               ['garlic','kitunguu saumu','lehsun'],1, 'pack',   _C('produce','food','global','🧄','biweekly')),
  _row('Ginger',               ['ginger','tangawizi','adrak'],      1, 'pack',   _C('produce','food','global','🫚','biweekly')),
  _row('Lemons',               ['lemons','lemon','ndimu','nimbu'],  6, 'x',      _C('produce','food','global','🍋','weekly')),
  _row('Limes',                ['limes','lime'],                    6, 'x',      _C('produce','food','global','🍋','weekly')),
  _row('Chillies',             ['chillies','pilipili','mirchi'],    1, 'pack',   _C('produce','food','global','🌶️','weekly')),
  _row('Coriander (dhania)',   ['coriander','dhania','cilantro'],   2, 'bunch',  _C('produce','food','global','🌿','weekly')),
  _row('Mint',                 ['mint','pudina'],                   1, 'bunch',  _C('produce','food','global','🌿','weekly')),
  _row('Spinach',              ['spinach','mchicha','palak'],       2, 'bunch',  _C('produce','food','global','🥬','weekly')),
  _row('Lettuce',              ['lettuce'],                         1, 'x',      _C('produce','food','global','🥬','weekly')),
  _row('Mushrooms',            ['mushrooms','mushroom'],            1, 'pack',   _C('produce','food','global','🍄','biweekly')),
  _row('Aubergine / brinjal',  ['aubergine','eggplant','brinjal','baingan'], 1,'kg', _C('produce','food','global','🍆','weekly')),
  _row('Pumpkin',              ['pumpkin','malenge','kaddu'],       1, 'kg',     _C('produce','food','global','🎃','biweekly')),
  _row('Okra (ladies finger)', ['okra','bamia','bhindi'],           1, 'kg',     _C('produce','food','global','🌶️','weekly')),
  _row('Green beans',          ['green beans'],                     1, 'kg',     _C('produce','food','global','🫛','weekly')),

  // ── FOOD · PRODUCE · EAST AFRICA ───────────────────────────────
  _row('Kale (sukuma wiki)',   ['sukuma wiki','sukuma','kale'],     2, 'bunch',  _C('produce','food','east-africa','🥬','weekly')),
  _row('Managu / African nightshade', ['managu','nightshade'],      1, 'bunch',  _C('produce','food','east-africa','🥬','weekly')),
  _row('Terere / amaranth',    ['terere','amaranth'],               1, 'bunch',  _C('produce','food','east-africa','🥬','weekly')),
  _row('Green maize (mahindi)',['green maize','corn'],              4, 'x',      _C('produce','food','east-africa','🌽','weekly')),
  _row('Plantain (matoke)',    ['matoke','plantain','green banana'],1, 'bunch',  _C('produce','food','east-africa','🍌','weekly')),
  _row('Cassava (muhogo)',     ['cassava','muhogo'],                2, 'kg',     _C('produce','food','east-africa','🥔','biweekly')),
  _row('Arrowroot (nduma)',    ['arrowroot','nduma','taro'],        1, 'kg',     _C('produce','food','east-africa','🥔','biweekly')),

  // ── FOOD · PRODUCE · SOUTH ASIA ────────────────────────────────
  _row('Bottle gourd (lauki)', ['lauki','bottle gourd'],            1, 'x',      _C('produce','food','south-asia','🥒','weekly')),
  _row('Bitter gourd (karela)',['karela','bitter gourd'],           1, 'kg',     _C('produce','food','south-asia','🥒','weekly')),
  _row('Drumsticks',           ['drumsticks','sahjan'],             1, 'pack',   _C('produce','food','south-asia','🌿','biweekly')),
  _row('Methi (fenugreek)',    ['methi','fenugreek leaves'],        1, 'bunch',  _C('produce','food','south-asia','🌿','weekly')),

  // ── FOOD · DAIRY ───────────────────────────────────────────────
  _row('Milk',                 ['milk','maziwa','doodh'],           7, 'L',      _C('dairy','food','global','🥛','weekly')),
  _row('UHT milk',             ['uht','long-life milk'],            6, 'L',      _C('dairy','food','global','🥛','biweekly')),
  _row('Yogurt',               ['yogurt','yoghurt','dahi','mtindi'],2, 'pack',   _C('dairy','food','global','🥣','weekly')),
  _row('Butter',               ['butter','siagi','makhan'],         1, 'pkt',    _C('dairy','food','global','🧈','biweekly')),
  _row('Cheese',               ['cheese','jibini','paneer'],        1, 'pack',   _C('dairy','food','global','🧀','biweekly')),
  _row('Paneer',               ['paneer'],                          1, 'pack',   _C('dairy','food','south-asia','🧀','weekly')),
  _row('Cream',                ['cream'],                           1, 'pack',   _C('dairy','food','global','🥛','biweekly')),
  _row('Eggs',                 ['eggs','mayai','anda'],             2, 'dozen',  _C('dairy','food','global','🥚','weekly')),
  _row('Chicken',              ['chicken','kuku','murgh'],          2, 'kg',     _C('dairy','food','global','🍗','weekly'), 'Halal cuts on request.'),
  _row('Beef',                 ['beef','nyama','gosht'],            1, 'kg',     _C('dairy','food','global','🥩','weekly')),
  _row('Goat meat',            ['goat','mbuzi','mutton'],           1, 'kg',     _C('dairy','food','global','🥩','biweekly')),
  _row('Fish (tilapia)',       ['fish','samaki','tilapia'],         1, 'kg',     _C('dairy','food','east-africa','🐟','weekly')),
  _row('Prawns',               ['prawns','shrimp'],                 1, 'pack',   _C('dairy','food','global','🦐','biweekly')),
  _row('Sausages',             ['sausages','soseji'],               1, 'pack',   _C('dairy','food','global','🌭','biweekly')),

  // ── FOOD · PRODUCE · FRUITS (also surface as Fruits in Foods tab) ─
  _row('Bananas',              ['bananas','ndizi','kela'],          2, 'bunch',  _C('produce','food','global','🍌','weekly')),
  _row('Mangoes',              ['mangoes','mango','aam','embe'],    6, 'x',      _C('produce','food','global','🥭','weekly')),
  _row('Apples',               ['apples','apple','seb'],            8, 'x',      _C('produce','food','global','🍎','weekly')),
  _row('Oranges',              ['oranges','orange','machungwa'],    8, 'x',      _C('produce','food','global','🍊','weekly')),
  _row('Pineapple',            ['pineapple','nanasi','ananas'],     1, 'x',      _C('produce','food','global','🍍','weekly')),
  _row('Watermelon',           ['watermelon','tikitimaji','tarbuz'],1, 'x',      _C('produce','food','global','🍉','weekly')),
  _row('Papaya',               ['papaya','papai','papita'],         1, 'x',      _C('produce','food','global','🥭','weekly')),
  _row('Avocados',             ['avocado','parachichi'],            4, 'x',      _C('produce','food','global','🥑','weekly')),
  _row('Grapes',               ['grapes','angur'],                  1, 'kg',     _C('produce','food','global','🍇','biweekly')),
  _row('Strawberries',         ['strawberries'],                    1, 'pack',   _C('produce','food','global','🍓','weekly')),
  _row('Passion fruit',        ['passion','passion fruit'],         8, 'x',      _C('produce','food','east-africa','🍇','weekly')),
  _row('Guava',                ['guava','mapera','amrood'],         4, 'x',      _C('produce','food','global','🍐','biweekly')),
  _row('Pomegranate',          ['pomegranate','anar'],              2, 'x',      _C('produce','food','south-asia','🍎','biweekly')),

  // ── HOUSEHOLD · CLEANING ───────────────────────────────────────
  _row('Dish soap',            ['dish soap','dishwash'],            1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Laundry detergent',    ['detergent','omo','surf'],          1, 'pack',   _C('cleaning','household','global','🧺','monthly')),
  _row('Fabric softener',      ['fabric softener','comfort'],       1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Bleach',               ['bleach','jik'],                    1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Toilet cleaner',       ['toilet cleaner','harpic'],         1, 'bottle', _C('cleaning','household','global','🚽','monthly')),
  _row('Floor cleaner',        ['floor cleaner','dettol'],          1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Glass cleaner',        ['glass cleaner','windex'],          1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Multi-surface spray',  ['multi-surface','disinfectant'],    1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Toilet paper',         ['toilet paper'],                    2, 'pack',   _C('cleaning','household','global','🧻','biweekly')),
  _row('Paper towels',         ['paper towels','kitchen roll'],     1, 'pack',   _C('cleaning','household','global','🧻','monthly')),
  _row('Sponges',              ['sponge','spongi'],                 2, 'x',      _C('cleaning','household','global','🧽','monthly')),
  _row('Scouring pad',         ['scourer','steel wool'],            1, 'pack',   _C('cleaning','household','global','🧽','monthly')),
  _row('Dishwasher tablets',   ['dishwasher','finish'],             1, 'pack',   _C('cleaning','household','global','🧴','monthly')),
  _row('Bin liners',           ['bin liners','garbage bags'],       1, 'pack',   _C('cleaning','household','global','🗑️','monthly')),
  _row('Mop refill',           ['mop'],                             1, 'x',      _C('cleaning','household','global','🧹','monthly')),
  _row('Broom',                ['broom','ufagio'],                  1, 'x',      _C('cleaning','household','global','🧹','monthly')),
  _row('Air freshener',        ['air freshener'],                   1, 'can',    _C('cleaning','household','global','🌸','monthly')),
  _row('Hand wash',            ['hand wash','handwash'],            1, 'bottle', _C('cleaning','household','global','🧴','monthly')),
  _row('Insecticide',          ['insecticide','doom','baygon'],     1, 'can',    _C('cleaning','household','global','🦟','monthly')),

  // ── HOUSEHOLD · PERSONAL ───────────────────────────────────────
  _row('Bar soap',             ['soap','sabuni'],                   4, 'bar',    _C('personal','household','global','🧼','monthly')),
  _row('Body wash',            ['body wash'],                       1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Shampoo',              ['shampoo'],                         1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Conditioner',          ['conditioner'],                     1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Hair oil',             ['hair oil','coconut oil'],          1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Toothpaste',           ['toothpaste'],                      2, 'tube',   _C('personal','household','global','🪥','monthly')),
  _row('Toothbrush',           ['toothbrush'],                      2, 'x',      _C('personal','household','global','🪥','monthly')),
  _row('Mouthwash',            ['mouthwash'],                       1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Deodorant',            ['deodorant'],                       1, 'x',      _C('personal','household','global','🧴','monthly')),
  _row('Body lotion',          ['lotion','body lotion'],            1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Sunscreen',            ['sunscreen','spf'],                 1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Razors',               ['razor','razors'],                  1, 'pack',   _C('personal','household','global','🪒','monthly')),
  _row('Shaving cream',        ['shaving cream'],                   1, 'tube',   _C('personal','household','global','🧴','monthly')),
  _row('Sanitary pads',        ['pads','sanitary'],                 1, 'pack',   _C('personal','household','global','🩸','monthly')),
  _row('Tampons',              ['tampons'],                         1, 'pack',   _C('personal','household','global','🩸','monthly')),
  _row('Cotton wool',          ['cotton wool'],                     1, 'pack',   _C('personal','household','global','🪶','monthly')),
  _row('Cotton buds',          ['cotton buds','q-tips'],            1, 'pack',   _C('personal','household','global','🪶','monthly')),
  _row('Diapers',              ['diapers','nappies','pampers'],     1, 'pack',   _C('personal','household','global','👶','biweekly')),
  _row('Baby wipes',           ['baby wipes','wipes'],              1, 'pack',   _C('personal','household','global','👶','biweekly')),
  _row('Baby formula',         ['baby formula','formula'],          1, 'pack',   _C('personal','household','global','🍼','biweekly')),
  _row('Baby lotion',          ['baby lotion'],                     1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('Tissues',              ['tissues','facial tissues'],        2, 'box',    _C('personal','household','global','🧻','monthly')),
  _row('Hand sanitiser',       ['sanitiser','sanitizer'],           1, 'bottle', _C('personal','household','global','🧴','monthly')),
  _row('First-aid plasters',   ['plasters','band-aid'],             1, 'pack',   _C('personal','household','global','🩹','monthly')),
  _row('Painkillers',          ['painkillers','panadol','paracetamol'], 1,'pack',_C('personal','household','global','💊','monthly')),

  // ── HOUSEHOLD · OTHER ──────────────────────────────────────────
  _row('Cooking gas refill',   ['gas','lpg','cooking gas'],         1, 'x',      _C('other','household','global','🔥','monthly')),
  _row('Charcoal',             ['charcoal','mkaa'],                 1, 'bag',    _C('other','household','east-africa','⚫','monthly')),
  _row('Firewood',             ['firewood','kuni'],                 1, 'bundle', _C('other','household','east-africa','🪵','monthly')),
  _row('Matches',              ['matches','vibiriti'],              1, 'pack',   _C('other','household','global','🔥','monthly')),
  _row('Candles',              ['candles','mishumaa'],              1, 'pack',   _C('other','household','global','🕯️','monthly')),
  _row('Light bulbs',          ['bulbs','light bulb'],              2, 'x',      _C('other','household','global','💡','monthly')),
  _row('Batteries (AA)',       ['batteries','aa battery'],          1, 'pack',   _C('other','household','global','🔋','monthly')),
  _row('Foil / cling film',    ['foil','cling film'],               1, 'roll',   _C('other','household','global','🧻','monthly')),
  _row('Ziploc bags',          ['ziploc'],                          1, 'box',    _C('other','household','global','🧊','monthly')),
  _row('Pet food',             ['pet food','dog food','cat food'],  1, 'bag',    _C('other','household','global','🐾','monthly')),
  _row('Plant pots',           ['plant pots'],                      1, 'x',      _C('other','household','global','🪴','monthly')),
  _row('Mosquito coils',       ['coils','mosquito coil'],           1, 'pack',   _C('other','household','east-africa','🦟','monthly')),
  _row('Newspapers',           ['newspaper'],                       7, 'x',      _C('other','household','global','📰','weekly')),
  _row('Pens',                 ['pen','biro'],                      1, 'pack',   _C('other','household','global','🖊️','monthly')),
  _row('Notebooks',            ['notebook','exercise book'],        2, 'x',      _C('other','household','global','📓','monthly')),
];

// ── Foods catalog ────────────────────────────────────────────────
// Ingredients listed by exact `label` from DIRECTORY_STAPLES so the
// "+ Staples" action can do a direct lookup.

const _F = (
  region: Region,
  diets: Diet[],
  emoji: string,
) => ({ region, diets, emoji });

const _food = (
  label: string,
  match: string[],
  meals: MealType[],
  ingredients: string[],
  meta: ReturnType<typeof _F>,
): DirectoryFood => ({
  label, match, meals, ingredients,
  region: meta.region, diets: meta.diets, emoji: meta.emoji,
});

export const DIRECTORY_FOODS: DirectoryFood[] = [
  // ── EAST AFRICAN ───────────────────────────────────────────────
  _food('Ugali',                 ['ugali'],                   ['lunch','dinner'],         ['Maize flour (ugali)','Salt'],                                       _F('east-africa', ['vegetarian','vegan','halal'], '🍯')),
  _food('Sukuma wiki',           ['sukuma'],                  ['lunch','dinner'],         ['Kale (sukuma wiki)','Onions','Tomatoes','Cooking oil','Salt'],     _F('east-africa', ['vegetarian','vegan','halal'], '🥬')),
  _food('Pilau',                 ['pilau'],                   ['lunch','dinner'],         ['Rice (white)','Beef','Onions','Pilau masala','Cooking oil','Salt'], _F('east-africa', ['halal'], '🍚')),
  _food('Biryani',               ['biryani'],                 ['lunch','dinner'],         ['Basmati rice','Chicken','Onions','Tomatoes','Garam masala','Cooking oil','Salt'], _F('east-africa', ['halal'], '🍛')),
  _food('Nyama choma',           ['nyama choma'],             ['lunch','dinner'],         ['Goat meat','Salt','Lemons'],                                        _F('east-africa', ['halal'], '🍖')),
  _food('Samaki wa kupaka',      ['samaki','fish curry'],     ['lunch','dinner'],         ['Fish (tilapia)','Coconut milk','Tomatoes','Onions','Salt'],         _F('east-africa', ['halal'], '🐟')),
  _food('Githeri',               ['githeri'],                 ['lunch','dinner'],         ['Beans (dry)','Mahindi (dry maize)','Onions','Tomatoes','Salt'],    _F('east-africa', ['vegetarian','vegan','halal'], '🌽')),
  _food('Mukimo',                ['mukimo'],                  ['lunch','dinner'],         ['Potatoes','Green maize (mahindi)','Beans (dry)','Spinach','Salt'], _F('east-africa', ['vegetarian','vegan','halal'], '🥔')),
  _food('Matoke',                ['matoke'],                  ['lunch','dinner'],         ['Plantain (matoke)','Onions','Tomatoes','Cooking oil','Salt'],      _F('east-africa', ['vegetarian','vegan','halal'], '🍌')),
  _food('Chapati',               ['chapati'],                 ['breakfast','lunch','dinner'], ['Atta / chapati flour','Cooking oil','Salt'],                    _F('east-africa', ['vegetarian','vegan','halal'], '🫓')),
  _food('Mandazi',               ['mandazi'],                 ['breakfast','snack'],      ['Wheat flour','Sugar','Yeast','Cooking oil','Cardamom'],            _F('east-africa', ['vegetarian','halal'], '🍩')),
  _food('Mahamri',               ['mahamri'],                 ['breakfast','snack'],      ['Wheat flour','Coconut milk','Sugar','Cardamom','Yeast'],           _F('east-africa', ['vegetarian','halal'], '🍩')),
  _food('Bhajia',                ['bhajia'],                  ['snack'],                  ['Potatoes','Atta / chapati flour','Cooking oil','Salt','Spices · cumin'], _F('east-africa', ['vegetarian','vegan','halal'], '🥔')),
  _food('Samosas',               ['samosa'],                  ['snack'],                  ['Wheat flour','Beef','Onions','Cooking oil','Spices · cumin','Salt'], _F('east-africa', ['halal'], '🥟')),
  _food('Kachumbari',            ['kachumbari'],              ['lunch','dinner'],         ['Tomatoes','Onions','Coriander (dhania)','Lemons','Salt'],          _F('east-africa', ['vegetarian','vegan','halal'], '🥗')),
  _food('Wali wa nazi',          ['wali nazi','coconut rice'],['lunch','dinner'],         ['Rice (white)','Coconut milk','Salt'],                               _F('east-africa', ['vegetarian','vegan','halal'], '🥥')),
  _food('Mukate wa sinia',       ['mukate wa sinia'],         ['breakfast','snack'],      ['Wheat flour','Sugar','Eggs','Cardamom'],                            _F('east-africa', ['vegetarian','halal'], '🍰')),
  _food('Uji',                   ['uji','porridge'],          ['breakfast'],              ['Millet flour','Milk','Sugar'],                                      _F('east-africa', ['vegetarian','halal'], '🥣')),

  // ── SOUTH ASIAN ────────────────────────────────────────────────
  _food('Idli',                  ['idli'],                    ['breakfast'],              ['Rice (white)','Urad dal','Salt'],                                   _F('south-asia', ['vegetarian','vegan','halal'], '⚪')),
  _food('Dosa',                  ['dosa'],                    ['breakfast','dinner'],     ['Rice (white)','Urad dal','Salt'],                                   _F('south-asia', ['vegetarian','vegan','halal'], '🥞')),
  _food('Masala dosa',           ['masala dosa'],             ['breakfast','lunch'],      ['Rice (white)','Urad dal','Potatoes','Onions','Mustard seeds','Salt'], _F('south-asia', ['vegetarian','vegan','halal'], '🥞')),
  _food('Upma',                  ['upma'],                    ['breakfast'],              ['Semolina','Onions','Mustard seeds','Curry leaves','Cooking oil'],   _F('south-asia', ['vegetarian','vegan','halal'], '🥣')),
  _food('Paratha',               ['paratha'],                 ['breakfast'],              ['Atta / chapati flour','Ghee','Salt'],                               _F('south-asia', ['vegetarian','halal'], '🫓')),
  _food('Aloo paratha',          ['aloo paratha'],            ['breakfast','lunch'],      ['Atta / chapati flour','Potatoes','Spices · cumin','Ghee','Salt'],   _F('south-asia', ['vegetarian','halal'], '🫓')),
  _food('Poha',                  ['poha'],                    ['breakfast'],              ['Poha (flattened rice)','Onions','Mustard seeds','Curry leaves','Cooking oil'], _F('south-asia', ['vegetarian','vegan','halal'], '🍚')),
  _food('Dal tadka',             ['dal','tadka'],             ['lunch','dinner'],         ['Toor dal','Onions','Tomatoes','Spices · cumin','Turmeric','Cooking oil','Salt'], _F('south-asia', ['vegetarian','vegan','halal'], '🥣')),
  _food('Sambar',                ['sambar'],                  ['breakfast','lunch','dinner'], ['Toor dal','Sambar masala','Tamarind','Drumsticks','Salt'],       _F('south-asia', ['vegetarian','vegan','halal'], '🥣')),
  _food('Rajma',                 ['rajma'],                   ['lunch','dinner'],         ['Beans (dry)','Onions','Tomatoes','Garam masala','Cooking oil','Salt'], _F('south-asia', ['vegetarian','vegan','halal'], '🫘')),
  _food('Chana masala',          ['chana masala','chole'],    ['lunch','dinner'],         ['Chickpeas','Onions','Tomatoes','Garam masala','Cooking oil','Salt'],_F('south-asia', ['vegetarian','vegan','halal'], '🫛')),
  _food('Palak paneer',          ['palak paneer'],            ['lunch','dinner'],         ['Spinach','Paneer','Onions','Garlic','Spices · cumin','Cooking oil','Salt'], _F('south-asia', ['vegetarian','halal'], '🥬')),
  _food('Paneer tikka',          ['paneer tikka'],            ['dinner','snack'],         ['Paneer','Yogurt','Garam masala','Bell peppers','Cooking oil'],      _F('south-asia', ['vegetarian','halal'], '🧀')),
  _food('Chicken curry',         ['chicken curry','murg'],    ['lunch','dinner'],         ['Chicken','Onions','Tomatoes','Garam masala','Yogurt','Cooking oil','Salt'], _F('south-asia', ['halal'], '🍛')),
  _food('Butter chicken',        ['butter chicken'],          ['dinner'],                 ['Chicken','Tomatoes','Cream','Butter','Garam masala','Salt'],        _F('south-asia', ['halal'], '🍛')),
  _food('Mutton curry',          ['mutton curry'],            ['lunch','dinner'],         ['Goat meat','Onions','Tomatoes','Garam masala','Cooking oil','Salt'],_F('south-asia', ['halal'], '🍛')),
  _food('Vegetable biryani',     ['veg biryani'],             ['lunch','dinner'],         ['Basmati rice','Onions','Tomatoes','Garam masala','Yogurt','Cooking oil','Salt'], _F('south-asia', ['vegetarian','halal'], '🍛')),
  _food('Aloo gobi',             ['aloo gobi'],               ['lunch','dinner'],         ['Potatoes','Cauliflower','Spices · cumin','Turmeric','Cooking oil','Salt'], _F('south-asia', ['vegetarian','vegan','halal'], '🥦')),
  _food('Bhindi masala',         ['bhindi'],                  ['lunch','dinner'],         ['Okra (ladies finger)','Onions','Tomatoes','Spices · cumin','Cooking oil','Salt'], _F('south-asia', ['vegetarian','vegan','halal'], '🥒')),
  _food('Baingan bharta',        ['baingan'],                 ['lunch','dinner'],         ['Aubergine / brinjal','Onions','Tomatoes','Garlic','Cooking oil','Salt'], _F('south-asia', ['vegetarian','vegan','halal'], '🍆')),
  _food('Pakora',                ['pakora'],                  ['snack'],                  ['Chickpeas','Onions','Spices · cumin','Cooking oil','Salt'],        _F('south-asia', ['vegetarian','vegan','halal'], '🥟')),
  _food('Chai (masala tea)',     ['chai','masala chai'],      ['breakfast','snack'],      ['Tea','Milk','Sugar','Cardamom','Ginger'],                           _F('south-asia', ['vegetarian','halal'], '🍵')),
  _food('Lassi',                 ['lassi'],                   ['breakfast','snack'],      ['Yogurt','Sugar','Cardamom'],                                        _F('south-asia', ['vegetarian','halal'], '🥛')),
  _food('Naan',                  ['naan'],                    ['lunch','dinner'],         ['Wheat flour','Yogurt','Yeast','Salt'],                              _F('south-asia', ['vegetarian','halal'], '🫓')),
  _food('Roti',                  ['roti'],                    ['lunch','dinner'],         ['Atta / chapati flour','Salt'],                                      _F('south-asia', ['vegetarian','vegan','halal'], '🫓')),
  _food('Khichdi',               ['khichdi'],                 ['lunch','dinner'],         ['Rice (white)','Moong dal','Spices · cumin','Turmeric','Ghee','Salt'], _F('south-asia', ['vegetarian','halal'], '🍚')),

  // ── GLOBAL · BREAKFAST ─────────────────────────────────────────
  _food('Boiled eggs',           ['boiled eggs'],             ['breakfast'],              ['Eggs','Salt'],                                                      _F('global', ['vegetarian','halal'], '🥚')),
  _food('Scrambled eggs',        ['scrambled eggs'],          ['breakfast'],              ['Eggs','Butter','Salt'],                                             _F('global', ['vegetarian','halal'], '🍳')),
  _food('Omelette',              ['omelette','omelet'],       ['breakfast'],              ['Eggs','Onions','Tomatoes','Salt','Cooking oil'],                    _F('global', ['vegetarian','halal'], '🍳')),
  _food('Pancakes',              ['pancakes'],                ['breakfast'],              ['Wheat flour','Milk','Eggs','Sugar','Baking powder'],                _F('global', ['vegetarian','halal'], '🥞')),
  _food('French toast',          ['french toast'],            ['breakfast'],              ['Bread','Eggs','Milk','Sugar'],                                      _F('global', ['vegetarian','halal'], '🍞')),
  _food('Toast & butter',        ['toast'],                   ['breakfast'],              ['Bread','Butter','Jam'],                                             _F('global', ['vegetarian','halal'], '🍞')),
  _food('Cereal & milk',         ['cereal'],                  ['breakfast'],              ['Cereal','Milk'],                                                    _F('global', ['vegetarian','halal'], '🥣')),
  _food('Oatmeal',               ['oatmeal','porridge'],      ['breakfast'],              ['Oats','Milk','Sugar','Honey'],                                      _F('global', ['vegetarian','halal'], '🥣')),
  _food('Avocado toast',         ['avocado toast'],           ['breakfast','snack'],      ['Bread','Avocados','Lemons','Salt'],                                 _F('global', ['vegetarian','vegan','halal'], '🥑')),
  _food('Yogurt & fruit',        ['yogurt bowl'],             ['breakfast','snack'],      ['Yogurt','Bananas','Honey'],                                         _F('global', ['vegetarian','halal'], '🥣')),
  _food('Fruit salad',           ['fruit salad'],             ['breakfast','snack'],      ['Bananas','Apples','Mangoes','Pineapple'],                           _F('global', ['vegetarian','vegan','halal'], '🍎')),

  // ── GLOBAL · LUNCH / DINNER ────────────────────────────────────
  _food('Spaghetti bolognese',   ['spaghetti','bolognese'],   ['lunch','dinner'],         ['Pasta','Beef','Tomatoes','Onions','Garlic','Cooking oil','Salt'],   _F('global', ['halal'], '🍝')),
  _food('Pasta arrabbiata',      ['pasta arrabbiata'],        ['lunch','dinner'],         ['Pasta','Tomatoes','Garlic','Chillies','Cooking oil','Salt'],        _F('global', ['vegetarian','vegan','halal'], '🍝')),
  _food('Mac & cheese',          ['mac and cheese'],          ['lunch','dinner'],         ['Pasta','Cheese','Milk','Butter','Salt'],                            _F('global', ['vegetarian','halal'], '🧀')),
  _food('Chicken stew',          ['chicken stew'],            ['lunch','dinner'],         ['Chicken','Potatoes','Carrots','Onions','Tomatoes','Salt'],          _F('global', ['halal'], '🍲')),
  _food('Beef stew',             ['beef stew'],               ['lunch','dinner'],         ['Beef','Potatoes','Carrots','Onions','Tomatoes','Salt'],             _F('global', ['halal'], '🍲')),
  _food('Vegetable stir-fry',    ['stir fry'],                ['lunch','dinner'],         ['Carrots','Bell peppers','Cabbage','Soy sauce','Cooking oil','Garlic'], _F('global', ['vegetarian','vegan','halal'], '🥦')),
  _food('Fried rice',            ['fried rice'],              ['lunch','dinner'],         ['Rice (white)','Eggs','Carrots','Onions','Soy sauce','Cooking oil'], _F('global', ['vegetarian','halal'], '🍚')),
  _food('Grilled chicken',       ['grilled chicken'],         ['lunch','dinner'],         ['Chicken','Salt','Lemons','Cooking oil'],                            _F('global', ['halal'], '🍗')),
  _food('Roast vegetables',      ['roast vegetables'],        ['lunch','dinner'],         ['Potatoes','Carrots','Bell peppers','Olive oil','Salt'],             _F('global', ['vegetarian','vegan','halal'], '🥕')),
  _food('Garden salad',          ['salad'],                   ['lunch','dinner','snack'], ['Lettuce','Tomatoes','Cucumber','Onions','Olive oil','Lemons'],      _F('global', ['vegetarian','vegan','halal'], '🥗')),
  _food('Caesar salad',          ['caesar'],                  ['lunch','dinner'],         ['Lettuce','Bread','Cheese','Eggs','Olive oil'],                      _F('global', ['vegetarian','halal'], '🥗')),
  _food('Tomato soup',           ['tomato soup'],             ['lunch','dinner'],         ['Tomatoes','Onions','Garlic','Cream','Salt','Olive oil'],            _F('global', ['vegetarian','halal'], '🍅')),
  _food('Lentil soup',           ['lentil soup'],             ['lunch','dinner'],         ['Lentils','Onions','Carrots','Garlic','Spices · cumin','Salt'],      _F('global', ['vegetarian','vegan','halal'], '🥣')),
  _food('Sandwich',              ['sandwich'],                ['lunch','snack'],          ['Bread','Cheese','Tomatoes','Lettuce','Mayonnaise'],                 _F('global', ['vegetarian','halal'], '🥪')),
  _food('Burger',                ['burger'],                  ['lunch','dinner'],         ['Bread','Beef','Cheese','Onions','Tomatoes','Lettuce'],              _F('global', ['halal'], '🍔')),
  _food('Pizza',                 ['pizza'],                   ['lunch','dinner'],         ['Wheat flour','Cheese','Tomato paste','Yeast','Olive oil','Salt'],   _F('global', ['vegetarian','halal'], '🍕')),
  _food('Tuna pasta',            ['tuna pasta'],              ['lunch','dinner'],         ['Pasta','Canned tuna','Olive oil','Garlic','Salt'],                  _F('global', ['halal'], '🍝')),
  _food('Fish & chips',          ['fish and chips'],          ['lunch','dinner'],         ['Fish (tilapia)','Potatoes','Cooking oil','Salt'],                   _F('global', ['halal'], '🐟')),
  _food('Tacos',                 ['tacos'],                   ['dinner'],                 ['Beef','Tomatoes','Onions','Lettuce','Cheese','Wheat flour'],        _F('global', ['halal'], '🌮')),
  _food('Stir-fry noodles',      ['stir fry noodles'],        ['lunch','dinner'],         ['Noodles','Bell peppers','Carrots','Soy sauce','Cooking oil'],       _F('global', ['vegetarian','vegan','halal'], '🍜')),
  _food('Mashed potatoes',       ['mashed potatoes'],         ['lunch','dinner'],         ['Potatoes','Butter','Milk','Salt'],                                  _F('global', ['vegetarian','halal'], '🥔')),

  // ── SNACKS ─────────────────────────────────────────────────────
  _food('Popcorn',               ['popcorn'],                 ['snack'],                  ['Mahindi (dry maize)','Salt','Cooking oil'],                         _F('global', ['vegetarian','vegan','halal'], '🍿')),
  _food('Roast peanuts',         ['peanuts','karanga'],       ['snack'],                  ['Peanut butter','Salt'],                                             _F('global', ['vegetarian','vegan','halal'], '🥜')),
  _food('Banana bread',          ['banana bread'],            ['snack','breakfast'],      ['Bananas','Wheat flour','Sugar','Eggs','Butter','Baking powder'],    _F('global', ['vegetarian','halal'], '🍞')),
  _food('Pancake (snack)',       ['pancake snack'],           ['snack'],                  ['Wheat flour','Milk','Eggs','Sugar'],                                _F('global', ['vegetarian','halal'], '🥞')),
  _food('Smoothie',              ['smoothie'],                ['snack','breakfast'],      ['Bananas','Yogurt','Honey','Milk'],                                  _F('global', ['vegetarian','halal'], '🥤')),

  // ── FRUITS (eaten fresh) ───────────────────────────────────────
  _food('Banana',                ['banana fresh'],            ['fruit','snack'],          ['Bananas'],                                                          _F('global', ['vegetarian','vegan','halal'], '🍌')),
  _food('Mango',                 ['mango fresh'],             ['fruit','snack'],          ['Mangoes'],                                                          _F('global', ['vegetarian','vegan','halal'], '🥭')),
  _food('Apple',                 ['apple fresh'],             ['fruit','snack'],          ['Apples'],                                                           _F('global', ['vegetarian','vegan','halal'], '🍎')),
  _food('Orange',                ['orange fresh'],            ['fruit','snack'],          ['Oranges'],                                                          _F('global', ['vegetarian','vegan','halal'], '🍊')),
  _food('Pineapple slices',      ['pineapple slices'],        ['fruit','snack'],          ['Pineapple'],                                                        _F('global', ['vegetarian','vegan','halal'], '🍍')),
  _food('Watermelon',            ['watermelon fresh'],        ['fruit','snack'],          ['Watermelon'],                                                       _F('global', ['vegetarian','vegan','halal'], '🍉')),
  _food('Papaya',                ['papaya fresh'],            ['fruit','snack'],          ['Papaya'],                                                           _F('global', ['vegetarian','vegan','halal'], '🥭')),
  _food('Avocado',               ['avocado fresh'],           ['fruit','snack'],          ['Avocados'],                                                         _F('global', ['vegetarian','vegan','halal'], '🥑')),
  _food('Grapes',                ['grapes fresh'],            ['fruit','snack'],          ['Grapes'],                                                           _F('global', ['vegetarian','vegan','halal'], '🍇')),
  _food('Strawberries',          ['strawberries fresh'],      ['fruit','snack'],          ['Strawberries'],                                                     _F('global', ['vegetarian','vegan','halal'], '🍓')),
  _food('Passion fruit',         ['passion fresh'],           ['fruit','snack'],          ['Passion fruit'],                                                    _F('east-africa', ['vegetarian','vegan','halal'], '🍇')),
  _food('Guava',                 ['guava fresh'],             ['fruit','snack'],          ['Guava'],                                                            _F('global', ['vegetarian','vegan','halal'], '🍐')),
  _food('Pomegranate',           ['pomegranate fresh'],       ['fruit','snack'],          ['Pomegranate'],                                                      _F('south-asia', ['vegetarian','vegan','halal'], '🍎')),
];

// Suppress the unused-row helper TS warning; kept for future
// builders who may want to compose rows differently.
export type __DirectoryRowShape = _Row;

// ── Starter packs ────────────────────────────────────────────────
// Curated bundles a parent can one-tap to seed their staples list
// without entering items one-by-one. Each pack lists DIRECTORY_STAPLES
// labels (must match exactly); quantities scale from the row's own
// `defaultQty` by the pack's qtyMultiplier so a 5-person household
// pulls bigger bags than a 1-2 person one.

export type StarterPackId = 'solo' | 'family' | 'big';

export interface StarterPack {
  id: StarterPackId;
  emoji: string;
  label: string;
  sizeRange: string;
  description: string;
  /** Multiplier applied to each item's defaultQty when bulk-adding.
   *  1 = use catalog default. 1.5/2 = scaled up for bigger households. */
  qtyMultiplier: number;
  /** Item labels — must match a `label` in DIRECTORY_STAPLES exactly. */
  items: string[];
}

// Common essentials every pack includes (food + household). The bigger
// packs layer on top of this base.
const _ESSENTIALS = [
  // food · daily/weekly
  'Rice (white)', 'Wheat flour', 'Cooking oil', 'Sugar', 'Salt',
  'Onions', 'Tomatoes', 'Potatoes', 'Garlic', 'Lemons',
  'Milk', 'Eggs', 'Bread', 'Tea', 'Coffee',
  // household · monthly
  'Dish soap', 'Laundry detergent', 'Toilet paper',
  'Bar soap', 'Toothpaste', 'Shampoo',
  'Bin liners', 'Cooking gas refill',
];

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'solo',
    emoji: '👤',
    label: 'Small household',
    sizeRange: '1–2 people',
    description: 'Single, couple, or small flat. Lighter quantities, just the essentials.',
    qtyMultiplier: 0.6,
    items: _ESSENTIALS,
  },
  {
    id: 'family',
    emoji: '👨‍👩‍👧',
    label: 'Family',
    sizeRange: '3–4 people',
    description: 'Two adults plus 1–2 kids. Catalog default quantities, broader variety.',
    qtyMultiplier: 1,
    items: [
      ..._ESSENTIALS,
      // produce + protein
      'Carrots', 'Cabbage', 'Spinach', 'Bananas', 'Apples', 'Avocados',
      'Chicken', 'Beef',
      // pantry
      'Pasta', 'Beans (dry)', 'Lentils', 'Tomato paste', 'Stock cubes',
      // dairy
      'Butter', 'Yogurt', 'Cheese',
      // household extras
      'Toothbrush', 'Body lotion', 'Deodorant', 'Sanitary pads',
      'Sponges', 'Paper towels',
    ],
  },
  {
    id: 'big',
    emoji: '👨‍👩‍👧‍👦',
    label: 'Big household',
    sizeRange: '5+ people',
    description: 'Larger family or extended household. Bigger pack sizes, more variety, baby + cleaning extras.',
    qtyMultiplier: 1.5,
    items: [
      ..._ESSENTIALS,
      'Carrots', 'Cabbage', 'Spinach', 'Cucumber', 'Bell peppers',
      'Bananas', 'Apples', 'Mangoes', 'Oranges', 'Avocados', 'Watermelon',
      'Chicken', 'Beef', 'Fish (tilapia)',
      'Pasta', 'Noodles', 'Beans (dry)', 'Lentils', 'Maize flour (ugali)',
      'Tomato paste', 'Stock cubes', 'Spices · curry powder', 'Spices · black pepper',
      'Butter', 'Yogurt', 'Cheese',
      'Toothbrush', 'Body lotion', 'Deodorant', 'Sanitary pads',
      'Diapers', 'Baby wipes', 'Baby formula',
      'Sponges', 'Paper towels', 'Fabric softener', 'Toilet cleaner',
      'Light bulbs', 'Batteries (AA)',
    ],
  },
];

/** Resolve a starter pack into concrete (staple, qty) pairs ready to
 *  hand to `addStaple`. Filters out any items whose label doesn't
 *  resolve, and rounds the scaled qty up to keep "1 → 1" intact. */
export function resolveStarterPack(pack: StarterPack): Array<{ staple: DirectoryStaple; qty: number }> {
  const out: Array<{ staple: DirectoryStaple; qty: number }> = [];
  for (const label of pack.items) {
    const staple = DIRECTORY_STAPLES.find((s) => s.label === label);
    if (!staple) continue;
    const qty = Math.max(1, Math.ceil(staple.defaultQty * pack.qtyMultiplier));
    out.push({ staple, qty });
  }
  return out;
}
