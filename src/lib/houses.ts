// Houses library (2026-05-29) — ~130 curated identity options across 7
// themes plus a Custom builder. Replaces the old 6-preset list.
// Backwards-compatible: every existing `houseName` (Golden House, White
// House, Silver House, Ruby House, Emerald House, Sapphire House) is still
// present, so kids already created stay valid without migration.
//
// No trademarked names (Stark / Lannister / Hogwarts / etc.) — original
// names that carry the same noble-fantasy feel.

export type HouseTheme =
  | 'gems'
  | 'elements'
  | 'beasts'
  | 'virtues'
  | 'constellations'
  | 'pantheon'
  | 'nature';

export type HousePreset = {
  /** Short label shown in chips and tiles (e.g. "Golden"). */
  name: string;
  /** Full storage value written to Firestore (e.g. "Golden House"). */
  houseName: string;
  /** Hex color for the house disc, badges, progress bars, etc. */
  color: string;
  /** Single-emoji avatar. */
  emoji: string;
  /** One-line character tag shown under the name. */
  tag: string;
  /** Which gallery tab this house lives under. */
  theme: HouseTheme;
};

export const HOUSE_THEMES: {
  id: HouseTheme;
  label: string;
  icon: string;
  blurb: string;
}[] = [
  { id: 'gems',           label: 'Gems & Stones',    icon: '💎', blurb: 'Crystals · luster · light' },
  { id: 'elements',       label: 'Elements & Skies', icon: '🌬️', blurb: 'Earth · water · sky · fire' },
  { id: 'beasts',         label: 'Mythical Beasts',  icon: '🐉', blurb: 'Noble creatures of legend' },
  { id: 'virtues',        label: 'Virtues',          icon: '✨', blurb: 'Character on a banner' },
  { id: 'constellations', label: 'Constellations',   icon: '🌌', blurb: 'Stories written in the sky' },
  { id: 'pantheon',       label: 'Greek Pantheon',   icon: '⚡', blurb: 'Gods, goddesses, archetypes' },
  { id: 'nature',         label: 'Trees & Nature',   icon: '🌳', blurb: 'Rooted · steady · alive' },
];

// Build a preset with the standard naming convention.
const h = (
  name: string,
  color: string,
  emoji: string,
  tag: string,
  theme: HouseTheme,
): HousePreset => ({ name, houseName: `${name} House`, color, emoji, tag, theme });

export const HOUSES: HousePreset[] = [
  // ── 💎 Gems & Stones (25) ────────────────────────────────────────────
  h('Golden',    '#D4A017', '🥇', 'Bold · brave',           'gems'),
  h('Silver',    '#9B8EC4', '🥈', 'Curious · creative',     'gems'),
  h('White',     '#7B9DB7', '🤍', 'Calm · clear',           'gems'),
  h('Ruby',      '#C0392B', '❤️', 'Warm · loyal',           'gems'),
  h('Emerald',   '#27AE60', '💚', 'Patient · steady',       'gems'),
  h('Sapphire',  '#2980B9', '💙', 'Bright · honest',        'gems'),
  h('Pearl',     '#E5E1D2', '🐚', 'Pure · poised',          'gems'),
  h('Amber',     '#E78F2F', '🍯', 'Steady · sunlit',        'gems'),
  h('Onyx',      '#1F2A38', '🌑', 'Quiet · deep',           'gems'),
  h('Jade',      '#5BA88C', '🌿', 'Kind · grounded',        'gems'),
  h('Topaz',     '#E6B82E', '🌟', 'Cheerful · open',        'gems'),
  h('Coral',     '#E97A5A', '🪸', 'Playful · gentle',       'gems'),
  h('Amethyst',  '#8E5DBA', '🔮', 'Thoughtful · wise',      'gems'),
  h('Diamond',   '#B7D3DE', '💎', 'Brilliant · strong',     'gems'),
  h('Obsidian',  '#23252B', '🔱', 'Fierce · still',         'gems'),
  h('Ivory',     '#C9B6A2', '🦴', 'Gentle · noble',         'gems'),
  h('Bronze',    '#A1733B', '🛡️', 'Hardworking · solid',    'gems'),
  h('Copper',    '#B87333', '🪙', 'Warm · welcoming',       'gems'),
  h('Opal',      '#A37CC9', '🌈', 'Iridescent · spirited',  'gems'),
  h('Garnet',    '#7C2436', '🍷', 'Fiery · sincere',        'gems'),
  h('Citrine',   '#E6B82E', '🌞', 'Sunny · joyful',         'gems'),
  h('Lapis',     '#23457B', '🌌', 'Cosmic · curious',       'gems'),
  h('Moonstone', '#D9E0E8', '🌙', 'Dreamy · soft',          'gems'),
  h('Quartz',    '#BDBFC1', '🔍', 'Sharp · clear',          'gems'),
  h('Crystal',   '#A8C9E5', '❄️', 'Light · careful',        'gems'),

  // ── 🌬️ Elements & Skies (20) ──────────────────────────────────────────
  h('Ember',     '#E25822', '🔥', 'Quietly fierce',         'elements'),
  h('Frost',     '#BFE2EE', '❄️', 'Calm under pressure',    'elements'),
  h('Storm',     '#4A5C73', '⛈️', 'Big-feeling · brave',    'elements'),
  h('Tide',      '#2F8FB3', '🌊', 'Steady · flowing',       'elements'),
  h('Stone',     '#6B6E70', '🪨', 'Loyal · enduring',       'elements'),
  h('Wind',      '#A4D4E7', '💨', 'Free · curious',         'elements'),
  h('Flame',     '#FF6B35', '🔥', 'Bold · spirited',        'elements'),
  h('River',     '#3F8AAB', '🏞️', 'Patient · always-moving', 'elements'),
  h('Sky',       '#5BC0EB', '☁️', 'Open · honest',          'elements'),
  h('Sun',       '#F4B927', '☀️', 'Warm · radiant',         'elements'),
  h('Moon',      '#B8C4D6', '🌙', 'Gentle · watchful',      'elements'),
  h('Dawn',      '#FF9E80', '🌅', 'Hopeful · fresh',        'elements'),
  h('Dusk',      '#B16B8C', '🌆', 'Reflective · calm',      'elements'),
  h('Ash',       '#6E7475', '🪶', 'Resilient · wise',       'elements'),
  h('Mist',      '#B8CDD7', '🌫️', 'Soft · mysterious',      'elements'),
  h('Thunder',   '#4A5060', '⚡', 'Powerful · honest',      'elements'),
  h('Star',      '#FFD93D', '⭐', 'Bright · guiding',       'elements'),
  h('Aurora',    '#6BCB77', '🌌', 'Magical · rare',         'elements'),
  h('Comet',     '#5A6FD8', '☄️', 'Adventurous · daring',   'elements'),
  h('Eclipse',   '#2D2D3E', '🌑', 'Mystical · still',       'elements'),

  // ── 🐉 Mythical Beasts (22) ───────────────────────────────────────────
  h('Phoenix',   '#E85C5C', '🔥', 'Reborn · bright',        'beasts'),
  h('Dragon',    '#6B1B36', '🐉', 'Mighty · wise',          'beasts'),
  h('Griffin',   '#B8896F', '🦅', 'Noble · brave',          'beasts'),
  h('Pegasus',   '#D9E0E8', '🦄', 'Free · graceful',        'beasts'),
  h('Falcon',    '#5B4E47', '🪶', 'Sharp · focused',        'beasts'),
  h('Hawk',      '#8B5E3C', '🦅', 'Watchful · loyal',       'beasts'),
  h('Wolf',      '#5C6975', '🐺', 'Loyal · steady',         'beasts'),
  h('Lion',      '#C48A4A', '🦁', 'Brave · proud',          'beasts'),
  h('Bear',      '#6B4C2F', '🐻', 'Protective · warm',      'beasts'),
  h('Eagle',     '#4A3F35', '🦅', 'Far-sighted · bold',     'beasts'),
  h('Stag',      '#8E6B4A', '🦌', 'Gentle · noble',         'beasts'),
  h('Tiger',     '#D87B3A', '🐯', 'Fierce · graceful',      'beasts'),
  h('Owl',       '#6B5B45', '🦉', 'Wise · quiet',           'beasts'),
  h('Raven',     '#1F2230', '🐦', 'Clever · loyal',         'beasts'),
  h('Fox',       '#C7572D', '🦊', 'Witty · quick',          'beasts'),
  h('Unicorn',   '#B388C9', '🦄', 'Magical · kind',         'beasts'),
  h('Kraken',    '#2A4A6B', '🐙', 'Deep · powerful',        'beasts'),
  h('Hydra',     '#3A8E70', '🐍', 'Resilient · brave',      'beasts'),
  h('Sphinx',    '#C9A66B', '🐱', 'Wise · mysterious',      'beasts'),
  h('Wyvern',    '#8B3A5C', '🐲', 'Bold · fierce',          'beasts'),
  h('Cerberus',  '#2D2538', '🐕', 'Watchful · loyal',       'beasts'),
  h('Manticore', '#A9412A', '🦂', 'Strong · proud',         'beasts'),

  // ── ✨ Virtues (18) ───────────────────────────────────────────────────
  h('Honor',      '#C9B26B', '🛡️', 'True · steady',          'virtues'),
  h('Truth',      '#5C7280', '💧', 'Clear · honest',         'virtues'),
  h('Courage',    '#C04638', '🦁', 'Brave · kind',           'virtues'),
  h('Wisdom',     '#6B5BA9', '📚', 'Thoughtful · deep',      'virtues'),
  h('Grace',      '#DCC0CF', '🕊️', 'Gentle · poised',        'virtues'),
  h('Peace',      '#8AB89D', '🌿', 'Calm · steady',          'virtues'),
  h('Hope',       '#6BC6D6', '🌅', 'Bright · forward',       'virtues'),
  h('Joy',        '#FFD05C', '☀️', 'Sunny · open',           'virtues'),
  h('Loyalty',    '#5C7A8E', '🤝', 'Faithful · strong',      'virtues'),
  h('Valor',      '#913827', '⚔️', 'Brave · noble',          'virtues'),
  h('Mercy',      '#BFD1C5', '🪶', 'Soft · forgiving',       'virtues'),
  h('Patience',   '#8E9F8B', '🌱', 'Steady · slow',          'virtues'),
  h('Kindness',   '#E8A097', '💞', 'Warm · giving',          'virtues'),
  h('Justice',    '#4A5060', '⚖️', 'Fair · clear',           'virtues'),
  h('Humility',   '#9B9385', '🌾', 'Quiet · strong',         'virtues'),
  h('Faith',      '#B488D9', '✨', 'Steady · believing',     'virtues'),
  h('Compassion', '#DD8F8F', '💝', 'Soft · understanding',   'virtues'),
  h('Resolve',    '#6B4F36', '🗻', 'Steady · firm',          'virtues'),

  // ── 🌌 Constellations (15) ────────────────────────────────────────────
  h('Orion',      '#3A4F6E', '⭐', 'Bold · explorer',        'constellations'),
  h('Lyra',       '#B98ECC', '🎵', 'Musical · gentle',       'constellations'),
  h('Vega',       '#C9D3E8', '✨', 'Bright · steady',        'constellations'),
  h('Polaris',    '#DCE6F0', '🌟', 'Steady · guiding',       'constellations'),
  h('Cassiopeia', '#C7A78F', '👑', 'Proud · regal',          'constellations'),
  h('Andromeda',  '#B57BB0', '🌌', 'Hopeful · resilient',    'constellations'),
  h('Draco',      '#4A6336', '🐲', 'Powerful · wise',        'constellations'),
  h('Cygnus',     '#E8E5DC', '🦢', 'Graceful · loyal',       'constellations'),
  h('Aquila',     '#6F4A2B', '🪶', 'Sharp · brave',          'constellations'),
  h('Corvus',     '#2D2E33', '🐦', 'Clever · sharp',         'constellations'),
  h('Ursa',       '#4F3D29', '🐻', 'Watchful · protective',  'constellations'),
  h('Leo',        '#C48A4A', '🌟', 'Royal · brave',          'constellations'),
  h('Centaurus',  '#7A5A3C', '🏹', 'Strong · curious',       'constellations'),
  h('Hercules',   '#8E3823', '💪', 'Mighty · noble',         'constellations'),
  h('Perseus',    '#C2876F', '⚔️', 'Brave · honest',         'constellations'),

  // ── ⚡ Greek Pantheon (14) ────────────────────────────────────────────
  h('Athena',     '#C9B26B', '🦉', 'Wise · strategist',      'pantheon'),
  h('Apollo',     '#F4B927', '🎼', 'Bright · artistic',      'pantheon'),
  h('Artemis',    '#5C7A8E', '🏹', 'Independent · brave',    'pantheon'),
  h('Hermes',     '#BFA378', '🪽', 'Quick · curious',        'pantheon'),
  h('Hera',       '#B48EBC', '👑', 'Regal · loyal',          'pantheon'),
  h('Zeus',       '#4A5060', '⚡', 'Mighty · just',          'pantheon'),
  h('Hestia',     '#C7A078', '🔥', 'Warm · steady',          'pantheon'),
  h('Demeter',    '#8AAB7E', '🌾', 'Nurturing · steady',     'pantheon'),
  h('Poseidon',   '#2F6FA1', '🔱', 'Powerful · deep',        'pantheon'),
  h('Hades',      '#2D2538', '⚱️', 'Quiet · honest',         'pantheon'),
  h('Dionysus',   '#6B358E', '🍇', 'Joyful · creative',      'pantheon'),
  h('Hephaestus', '#993B2A', '🔨', 'Crafty · steady',        'pantheon'),
  h('Persephone', '#B85A8B', '🌷', 'Gentle · resilient',     'pantheon'),
  h('Iris',       '#6B8CC4', '🌈', 'Bright · messenger',     'pantheon'),

  // ── 🌳 Trees & Nature (14) ────────────────────────────────────────────
  h('Oak',        '#6E5028', '🌳', 'Strong · steady',        'nature'),
  h('Cedar',      '#5A4A36', '🌲', 'Tall · loyal',           'nature'),
  h('Maple',      '#B85A2E', '🍁', 'Warm · giving',          'nature'),
  h('Willow',     '#8AAB7E', '🌿', 'Flexible · soft',        'nature'),
  h('Birch',      '#C9B89A', '🌳', 'Light · honest',         'nature'),
  h('Aspen',      '#C9C2A8', '🌲', 'Whispering · gentle',    'nature'),
  h('Redwood',    '#8B4030', '🌲', 'Ancient · brave',        'nature'),
  h('Olive',      '#6B7A48', '🫒', 'Peaceful · steady',      'nature'),
  h('Cypress',    '#4A6B5A', '🌲', 'Tall · graceful',        'nature'),
  h('Pine',       '#4A6B45', '🌲', 'Steady · honest',        'nature'),
  h('Juniper',    '#5C7460', '🌿', 'Sharp · resilient',      'nature'),
  h('Hawthorn',   '#7C4A4A', '🌳', 'Brave · loyal',          'nature'),
  h('Rowan',      '#B85A4A', '🍂', 'Magical · steady',       'nature'),
  h('Holly',      '#2E5C3F', '🎄', 'Brave · loyal',          'nature'),
];

/** Quick lookup by full storage name (e.g. "Golden House"). */
export const HOUSE_BY_NAME: Record<string, HousePreset> = Object.fromEntries(
  HOUSES.map((p) => [p.houseName, p]),
);

/**
 * Starter chips on onboarding Step 3 — 10 picks that span the themes.
 * "Browse the gallery (130+)" reveals the full library modal.
 */
export const STARTER_NAMES = [
  'Golden',
  'Silver',
  'Pearl',
  'Ruby',
  'Emerald',
  'Sapphire',
  'Phoenix',
  'Athena',
  'Oak',
  'Wolf',
];

export const STARTERS: HousePreset[] = STARTER_NAMES.map((n) => {
  const found = HOUSES.find((p) => p.name === n);
  if (!found) throw new Error(`STARTER ${n} missing from HOUSES`);
  return found;
});

/** Houses that belong to a given theme tab. */
export function housesInTheme(theme: HouseTheme): HousePreset[] {
  return HOUSES.filter((p) => p.theme === theme);
}

/** Substring search across name + tag (case-insensitive). */
export function searchHouses(query: string): HousePreset[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return HOUSES.filter(
    (p) => p.name.toLowerCase().includes(q) || p.tag.toLowerCase().includes(q),
  );
}
