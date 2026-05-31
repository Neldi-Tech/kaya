// Kaya Games — the 22-game launch catalog across 4 worlds. Single source
// of truth for the Games hub, each game route, and the server award
// route's base point values. `built: true` games are playable now
// (Sprint 1); the rest render with a "Soon" pill until their sprint
// lands. Point values + ages mirror the approved LaunchDay design.
//
// Currency note: `points` are awarded as House Points (the one Kaya
// economy) via /api/games/award — NOT a separate "Sparks" currency.

export type GameWorld = 'quick' | 'family' | 'calm' | 'realworld';
export type DeviceMode = 'solo' | 'same' | 'multi' | 'both';
export type GameTone = 'violet' | 'coral' | 'teal' | 'gold' | 'sky' | 'pink';

export interface GameDef {
  /** Stable slug — used in the route (/games/[id]) and gamePlays records. */
  id: string;
  name: string;
  world: GameWorld;
  icon: string;            // emoji
  tone: GameTone;          // icon-tile colour family (scoped games-* palette)
  minAge: number;          // 0 = all ages
  minutes: number;         // 0 = open-ended (real-world challenges)
  /** Base House Points on completion (before age multiplier / caps). */
  points: number;
  device: DeviceMode;
  players?: string;        // family games, e.g. "2–8"
  built?: boolean;         // playable now (else shows a Soon pill)
  photoProof?: boolean;    // real-world: parent verifies a photo
  note?: string;           // small meta line, e.g. "Multi in P1.5"
}

export interface WorldDef {
  id: GameWorld;
  label: string;
  emoji: string;
  blurb: string;
  countLabel: string;
  /** Calm Corner is uncapped (small steady rewards, no daily points cap). */
  uncapped?: boolean;
}

export const GAME_WORLDS: WorldDef[] = [
  { id: 'quick',     label: 'Quick Plays', emoji: '⚡', blurb: 'Fast solo games',  countLabel: '8 games · solo' },
  { id: 'family',    label: 'Family Time', emoji: '🎪', blurb: 'Play together',    countLabel: '6 games · 2+ players' },
  { id: 'calm',      label: 'Calm Corner', emoji: '🌿', blurb: 'Mindful moments',  countLabel: 'Always available', uncapped: true },
  { id: 'realworld', label: 'Real-World',  emoji: '🌍', blurb: 'Do it, prove it',  countLabel: '4 rotating this week' },
];

export const GAMES: GameDef[] = [
  // ── ⚡ Quick Plays (8 · solo · offline) ────────────────────────────
  { id: 'memory-match',  name: 'Memory Match',     world: 'quick', icon: '🧠', tone: 'coral',  minAge: 4, minutes: 3,  points: 15, device: 'solo', built: true },
  { id: 'word-sprint',   name: 'Word Sprint',      world: 'quick', icon: '🔤', tone: 'violet', minAge: 6, minutes: 5,  points: 20, device: 'solo', built: true },
  { id: 'math-dash',     name: 'Math Dash',        world: 'quick', icon: '➕', tone: 'gold',   minAge: 5, minutes: 4,  points: 20, device: 'solo', built: true },
  { id: '2048',          name: '2048',             world: 'quick', icon: '🔢', tone: 'sky',    minAge: 8, minutes: 10, points: 25, device: 'solo', built: true },
  { id: 'sliding-puzzle', name: 'Sliding Puzzle',  world: 'quick', icon: '🧩', tone: 'pink',   minAge: 5, minutes: 5,  points: 20, device: 'solo', built: true },
  { id: 'sudoku-lite',   name: 'Sudoku Lite',      world: 'quick', icon: '🔡', tone: 'teal',   minAge: 7, minutes: 8,  points: 25, device: 'solo', built: true },
  { id: 'snake',         name: 'Snake',            world: 'quick', icon: '🐍', tone: 'coral',  minAge: 5, minutes: 5,  points: 15, device: 'solo', built: true },
  { id: 'tic-tac-toe',   name: 'Tic-Tac-Toe',      world: 'quick', icon: '❌', tone: 'violet', minAge: 4, minutes: 2,  points: 10, device: 'same', players: '1–2', built: true, note: 'vs a friend or the computer' },

  // ── 🎪 Family Time (6 · multiplayer) ───────────────────────────────
  { id: 'family-trivia',  name: 'Family Trivia',   world: 'family', icon: '🎯', tone: 'violet', minAge: 0, minutes: 15, points: 50, device: 'multi', players: '2–8', built: true, note: 'Buzz in on your phone' },
  { id: 'charades',       name: 'Charades',        world: 'family', icon: '🎭', tone: 'coral',  minAge: 0, minutes: 10, points: 40, device: 'same',  players: '3+',  built: true, note: 'Pass-and-play' },
  { id: 'pictionary',     name: 'Pictionary',      world: 'family', icon: '✏️', tone: 'gold',   minAge: 0, minutes: 10, points: 40, device: 'same',  players: '3+',  built: true, note: 'Pass-and-play' },
  { id: 'connect-4',      name: 'Connect 4',       world: 'family', icon: '🔵', tone: 'sky',    minAge: 0, minutes: 5,  points: 25, device: 'same',  players: '2',  built: true, note: 'Pass-and-play' },
  { id: 'snakes-ladders', name: 'Snakes & Ladders', world: 'family', icon: '🎲', tone: 'teal',  minAge: 0, minutes: 12, points: 30, device: 'same',  players: '2',  built: true, note: 'Pass-and-play' },
  { id: 'story-builder',  name: 'Story Builder',   world: 'family', icon: '📖', tone: 'pink',   minAge: 0, minutes: 8,  points: 30, device: 'multi', players: '2–6', built: true },

  // ── 🌿 Calm Corner (4 · mindful · uncapped) ────────────────────────
  { id: 'breathing',     name: 'Guided Breathing', world: 'calm', icon: '🫁', tone: 'teal',   minAge: 0, minutes: 3, points: 10, device: 'solo', built: true },
  { id: 'gratitude-jar', name: 'Gratitude Jar',    world: 'calm', icon: '🙏', tone: 'pink',   minAge: 0, minutes: 2, points: 10, device: 'solo', built: true },
  { id: 'five-senses',   name: '5-Senses Grounding', world: 'calm', icon: '👀', tone: 'violet', minAge: 0, minutes: 4, points: 10, device: 'solo', built: true },
  { id: 'mood-checkin',  name: 'Mood Check-in',    world: 'calm', icon: '😊', tone: 'gold',   minAge: 0, minutes: 1, points: 5,  device: 'solo', built: true },

  // ── 🌍 Real-World (4 rotating · parent verifies a photo) ───────────
  { id: 'build-a-fort',   name: 'Build a Fort',    world: 'realworld', icon: '🏰', tone: 'gold',  minAge: 0, minutes: 0, points: 75, device: 'solo', built: true, photoProof: true },
  { id: 'family-workout', name: 'Family Workout',  world: 'realworld', icon: '💪', tone: 'coral', minAge: 0, minutes: 0, points: 60, device: 'solo', built: true, photoProof: true },
  { id: 'plant-something', name: 'Plant Something', world: 'realworld', icon: '🌱', tone: 'teal', minAge: 0, minutes: 0, points: 50, device: 'solo', built: true, photoProof: true },
  { id: 'thank-you-note', name: 'Thank-You Note',  world: 'realworld', icon: '✍️', tone: 'pink',  minAge: 5, minutes: 0, points: 40, device: 'solo', built: true, photoProof: true },
];

/** The game featured in the hub's Daily Pick card. Matches the approved
 *  LaunchDay design (Family Trivia). Rotates to a built game once the
 *  multi-device world ships. */
export const DAILY_PICK_ID = 'family-trivia';

export function gamesByWorld(world: GameWorld): GameDef[] {
  return GAMES.filter((g) => g.world === world);
}

export function getGame(id: string): GameDef | undefined {
  return GAMES.find((g) => g.id === id);
}

/** "All ages" for minAge 0, else "Ages 5+". */
export function ageLabel(minAge: number): string {
  return minAge <= 0 ? 'All ages' : `Ages ${minAge}+`;
}

const DEVICE_LABEL: Record<DeviceMode, string> = {
  solo: 'Solo',
  same: '📱 Same device',
  multi: '📲 Multi-device',
  both: '📱📲 Any device',
};

export function deviceLabel(device: DeviceMode): string {
  return DEVICE_LABEL[device];
}
