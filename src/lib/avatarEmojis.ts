// Avatar emoji library (approved design, 2026-07-20).
//
// Replaces the old fixed 6-emoji list (🏅 🤍 🥈 ❤️ 💚 💙) with 8 curated,
// kid-friendly categories — 144 choices — used by the shared
// AvatarEmojiPicker everywhere an avatar is chosen. The picker also accepts
// ANY typed emoji, so this list is a starting point, not a limit.
// `avatarEmoji` is stored as a plain string; every surface (meetings, prep
// cards, notes, emails, ratings) already renders whatever is stored.

export interface AvatarEmojiCategory {
  key: string;
  label: string;
  emojis: string[];
}

export const AVATAR_EMOJI_CATEGORIES: AvatarEmojiCategory[] = [
  {
    key: 'champions', label: '🏅 Champions',
    emojis: ['🏅', '🥇', '🥈', '🥉', '🏆', '👑', '💎', '⭐', '🎖️', '🌟', '🔱', '🛡️', '⚜️', '🎯', '🧿', '🪙', '🏵️', '💫'],
  },
  {
    key: 'faces', label: '😀 Faces',
    emojis: ['😀', '😄', '😎', '🤩', '😇', '🥳', '🤠', '🧐', '🙂', '😊', '😜', '🤗', '😺', '🤓', '🦸', '🦹', '🧑‍🚀', '🥷'],
  },
  {
    key: 'animals', label: '🦁 Animals',
    emojis: ['🦁', '🐯', '🐻', '🐼', '🦊', '🦉', '🐧', '🐰', '🦄', '🐬', '🐘', '🦒', '🐢', '🦅', '🐝', '🐕', '🐙', '🦋'],
  },
  {
    key: 'sports', label: '⚽ Sports',
    emojis: ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏓', '🏸', '🥋', '🥊', '🏊', '🚴', '⛹️', '🤸', '🏹', '🛹', '⛸️', '🏇'],
  },
  {
    key: 'food', label: '🍦 Food',
    emojis: ['🍦', '🍕', '🍩', '🍪', '🍓', '🥭', '🍉', '🍌', '🍫', '🧁', '🍿', '🥤', '🍯', '🥑', '🍇', '🍒', '🥨', '🍰'],
  },
  {
    key: 'nature', label: '🌈 Nature',
    emojis: ['🌈', '🌻', '🌊', '🍀', '🌵', '🦋', '🌸', '🔥', '🌴', '🍁', '🌺', '🌳', '⛰️', '🌼', '🍄', '🌷', '❄️', '💧'],
  },
  {
    key: 'space', label: '🚀 Space',
    emojis: ['🚀', '🌙', '☀️', '⭐', '🪐', '🛸', '🌟', '⚡', '🌍', '☄️', '🌠', '🔭', '👽', '🛰️', '🌌', '🌞', '🌛', '✨'],
  },
  {
    key: 'hearts', label: '💛 Hearts',
    emojis: ['💛', '❤️', '💚', '💙', '💜', '🧡', '🤍', '🖤', '💖', '💝', '💗', '💕', '❣️', '💘', '✨', '💟', '♥️', '🫶'],
  },
];

/** A sensible rotating default for quick-add flows (no picker shown). */
export function defaultAvatarEmoji(index: number): string {
  const pool = AVATAR_EMOJI_CATEGORIES[0].emojis;
  return pool[index % pool.length];
}
