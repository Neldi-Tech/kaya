// Curated, kid-friendly avatar library. URLs come from DiceBear (free, no key,
// SVG-based — see https://www.dicebear.com). Same seed always returns the
// same face, so these URLs are stable.
//
// Phase 2 will add: upload-from-device (Firebase Storage) and search-online.

export type AvatarPreset = {
  url: string;
  label: string;     // accessible name
  group: 'animals' | 'sweet' | 'cosmic';
};

const dicebear = (style: string, seed: string) =>
  `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;

export const AVATAR_PRESETS: AvatarPreset[] = [
  // Adventurer — playful character avatars (animals theme via seed names)
  { url: dicebear('adventurer', 'Lion'),     label: 'Lion',     group: 'animals' },
  { url: dicebear('adventurer', 'Tiger'),    label: 'Tiger',    group: 'animals' },
  { url: dicebear('adventurer', 'Bear'),     label: 'Bear',     group: 'animals' },
  { url: dicebear('adventurer', 'Fox'),      label: 'Fox',      group: 'animals' },
  { url: dicebear('adventurer', 'Owl'),      label: 'Owl',      group: 'animals' },
  { url: dicebear('adventurer', 'Panda'),    label: 'Panda',    group: 'animals' },
  { url: dicebear('adventurer', 'Penguin'),  label: 'Penguin',  group: 'animals' },
  { url: dicebear('adventurer', 'Bunny'),    label: 'Bunny',    group: 'animals' },

  // Fun-emoji — colorful emoji-style faces (sweet-things theme)
  { url: dicebear('fun-emoji', 'Mango'),     label: 'Mango',    group: 'sweet' },
  { url: dicebear('fun-emoji', 'Berry'),     label: 'Berry',    group: 'sweet' },
  { url: dicebear('fun-emoji', 'Plum'),      label: 'Plum',     group: 'sweet' },
  { url: dicebear('fun-emoji', 'Honey'),     label: 'Honey',    group: 'sweet' },
  { url: dicebear('fun-emoji', 'Mint'),      label: 'Mint',     group: 'sweet' },
  { url: dicebear('fun-emoji', 'Peach'),     label: 'Peach',    group: 'sweet' },
  { url: dicebear('fun-emoji', 'Apple'),     label: 'Apple',    group: 'sweet' },
  { url: dicebear('fun-emoji', 'Lemon'),     label: 'Lemon',    group: 'sweet' },

  // Lorelei — cute illustrated faces (cosmic theme)
  { url: dicebear('lorelei', 'Star'),        label: 'Star',     group: 'cosmic' },
  { url: dicebear('lorelei', 'Moon'),        label: 'Moon',     group: 'cosmic' },
  { url: dicebear('lorelei', 'Sun'),         label: 'Sun',      group: 'cosmic' },
  { url: dicebear('lorelei', 'Cloud'),       label: 'Cloud',    group: 'cosmic' },
  { url: dicebear('lorelei', 'Comet'),       label: 'Comet',    group: 'cosmic' },
  { url: dicebear('lorelei', 'Nova'),        label: 'Nova',     group: 'cosmic' },
  { url: dicebear('lorelei', 'Rainbow'),     label: 'Rainbow',  group: 'cosmic' },
  { url: dicebear('lorelei', 'Sparkle'),     label: 'Sparkle',  group: 'cosmic' },
];

export const AVATAR_GROUPS: { key: AvatarPreset['group']; label: string }[] = [
  { key: 'animals', label: 'Animals' },
  { key: 'sweet',   label: 'Sweet things' },
  { key: 'cosmic',  label: 'Cosmic' },
];

// Use a child's name as a DiceBear seed to generate a personalised avatar.
// Returns a stable URL — same name always gives the same face.
export function generateAvatarFromName(name: string, style = 'fun-emoji'): string {
  return dicebear(style, name || 'Kaya');
}
