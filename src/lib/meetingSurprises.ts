// 🎁 Sunday Surprise registry (SM3.1 · #7) — one shared moment to end the
// meeting, picked from whatever the family has enabled. Built as a REGISTRY
// exactly per the approved design: adding surprise #10 later = one entry
// here + it appears in settings automatically. The pick is SEEDED by the
// meeting date so it doesn't reshuffle on re-render — the leader can still
// swap ("show me another").
//
// Launch defaults (locked decision): Elia's three (photo/video/song) +
// 🎤 shower / 🕰️ time machine / 🧩 flash quiz ON; 🤫 mission / 📞 call /
// 🍬 golden ticket ship default-OFF so surprises stay surprising.

export type SurpriseKind =
  | 'photo' | 'video' | 'song'
  | 'shower' | 'timemachine' | 'flashquiz'
  | 'mission' | 'call' | 'ticket';

export interface SurpriseDef {
  id: SurpriseKind;
  emoji: string;
  name: string;
  blurb: string;              // one-liner shown in settings + on the step
  defaultEnabled: boolean;
}

export const SURPRISE_REGISTRY: SurpriseDef[] = [
  { id: 'photo',       emoji: '📸', name: 'Family Photo',     blurb: 'A pose-prompt photo — straight into Moments.', defaultEnabled: true },
  { id: 'video',       emoji: '🎬', name: 'Together Video',   blurb: 'Say a verse or a line together — 15–30 seconds, into Moments.', defaultEnabled: true },
  { id: 'song',        emoji: '🎶', name: 'Family Song',      blurb: 'A 30-second singalong to end the night.', defaultEnabled: true },
  { id: 'shower',      emoji: '🎤', name: 'Compliment Shower', blurb: 'One person, 30 seconds, everyone rains compliments.', defaultEnabled: true },
  { id: 'timemachine', emoji: '🕰️', name: 'Time Machine',     blurb: 'A random old Moments photo — guess when, then the story.', defaultEnabled: true },
  { id: 'flashquiz',   emoji: '🧩', name: 'Family Flash Quiz', blurb: 'Three rapid questions from your own Kaya week.', defaultEnabled: true },
  { id: 'mission',     emoji: '🤫', name: 'Secret Mission',   blurb: 'Everyone draws a secret kindness mission — checked NEXT Sunday.', defaultEnabled: false },
  { id: 'call',        emoji: '📞', name: 'Surprise Call',    blurb: 'Two minutes on speakerphone to say goodnight to a grandparent.', defaultEnabled: false },
  { id: 'ticket',      emoji: '🍬', name: 'Golden Ticket',    blurb: 'A small real-world treat from the parent-stocked list.', defaultEnabled: false },
];

export const PHOTO_PROMPTS = [
  'Everyone point at tonight’s leader!',
  'Silly faces — the sillier the better 🤪',
  'Squeeeeze into the frame — closer!',
  'Everyone mid-jump 🦘',
  'Make a human pyramid (a safe one!)',
  'Copy the youngest person’s pose',
  'Thumbs up like you just won the week 🏆',
  'Everyone hug someone (or the dog)',
];

export const VIDEO_PROMPTS = [
  'Say tonight’s opening verse together — one voice.',
  'Everyone finishes: “This week I’m thankful for…” — rapid fire!',
  'Shout your family name and cheer 📣',
  'One sentence each: what made you laugh this week?',
  'Say together: “We are one team, one family!”',
];

export const MISSIONS = [
  'Secretly make someone’s bed this week',
  'Leave a kind note where someone will find it',
  'Do one of someone else’s chores without telling',
  'Give three honest compliments on three different days',
  'Prepare a surprise snack for the family',
  'Teach someone something you’re good at',
  'Say thank you to a helper for something specific',
  'Draw or make a small gift for someone in the family',
];

/** Deterministic index from a seed string — stable per meeting date. */
export function seededIndex(seed: string, len: number): number {
  if (len <= 0) return 0;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % len;
}

/** Which surprises are enabled for this family (settings override registry
 *  defaults; absent map = pure defaults). */
export function enabledSurprises(overrides?: Record<string, boolean>): SurpriseDef[] {
  return SURPRISE_REGISTRY.filter((s) =>
    overrides && typeof overrides[s.id] === 'boolean' ? overrides[s.id] : s.defaultEnabled,
  );
}
