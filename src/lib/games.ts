// Kaya Games — runtime config + scoring helpers (pure, no Firestore import
// so it's safe to use from both the client and the Admin-SDK award route).
//
// Parental controls live on the Family doc (`Family.gamesConfig`) — readable
// by the family, writable by parents (no extra rule needed). Per-play records
// live in `families/{fid}/gamePlays` and are written ONLY by the server award
// route, so a kid can never forge points or bypass the daily cap.

import type { GameWorld } from './gamesCatalog';

export interface GamesPlayWindow {
  start: string; // 'HH:MM' 24h, local
  end: string;   // 'HH:MM' 24h, local
}

export interface GamesConfig {
  /** Allowed play window on weekdays. null = no window (any time). */
  weekdayWindow: GamesPlayWindow | null;
  /** Allowed play window on weekends. null = no window (any time). */
  weekendWindow: GamesPlayWindow | null;
  /** Minutes of play allowed per kid per day across all worlds. 0 = no cap. */
  dailyMinutesCap: number;
  /** House Points a kid can earn from games per day. 0 = no cap. */
  dailyPointsCap: number;
  /** House Points a kid can earn from games per week. 0 = no cap. */
  weeklyPointsCap: number;
  /** Calm Corner is exempt from the daily caps (small, steady rewards). */
  calmUncapped: boolean;
  /** Require the day's homework done before non-calm games unlock (UI gate). */
  homeworkGate: boolean;
  /** Multiplier applied to Quick Plays points for young kids. */
  youngMultiplier: number;
  /** "Young" = age at or below this (years). */
  youngMaxAge: number;
  /** Per-game House-Points the parent assigns. Keyed by game id. A game NOT
   *  present here is worth 0 (the new default — HP carries real value, so
   *  games mint nothing until a parent opts a game in). Completing a game
   *  worth > 0 creates a PENDING approval; a parent approves before any HP
   *  is credited (see /api/games/award + lib/gamesApprovals). */
  gamePoints?: Record<string, number>;
  /** Days a saved Story Builder keepsake stays readable in the gallery.
   *  0 = keep forever. Stories past this age are hidden (and later pruned). */
  storyRetentionDays: number;
}

// Defaults are deliberately permissive: Games is being switched ON for
// existing families, so we do NOT impose a hard play-window by default
// (that would silently lock kids out). Parents opt into windows in the
// controls UI, which pre-fills the brief's 4–6 PM / 9–12 suggestions.
export const DEFAULT_GAMES_CONFIG: GamesConfig = {
  weekdayWindow: null,
  weekendWindow: null,
  dailyMinutesCap: 30,
  dailyPointsCap: 175,
  weeklyPointsCap: 0,
  calmUncapped: true,
  homeworkGate: false,
  youngMultiplier: 1.5,
  youngMaxAge: 6,
  gamePoints: {},
  storyRetentionDays: 30,
};

/** Min/max/step for the per-game points editor + the caps. Points carry
 *  real value, so the ceiling is deliberately modest; parents can type an
 *  exact value too (the UI offers a manual field). */
export const POINTS_PER_GAME_MIN = 0;
export const POINTS_PER_GAME_MAX = 100;
export const POINTS_PER_GAME_STEP = 5;

/** Brain-builders — auto-tagged "Mind +" in the editor to guide parents
 *  toward paying mind-activating games more. Tag is advisory only. */
export const MIND_GAME_IDS = new Set<string>([
  'memory-match', 'word-sprint', 'math-dash', '2048', 'sliding-puzzle',
  'sudoku-lite', 'family-trivia', 'story-builder',
]);
export const isMindGame = (gameId: string): boolean => MIND_GAME_IDS.has(gameId);

/** The parent-assigned House-Points value for a game. Default 0 — a game
 *  mints nothing until a parent opts it in via Games Controls. */
export function gamePointsValue(cfg: GamesConfig, gameId: string): number {
  // House Points are reserved for mind-strengthening games. Every other game
  // earns Fun-Points only, so it can never carry an HP value (even legacy ones).
  if (!isMindGame(gameId)) return 0;
  const v = cfg.gamePoints?.[gameId];
  return typeof v === 'number' && v > 0 ? Math.round(v) : 0;
}

/** Suggested window presets the parent UI offers when enabling windows
 *  (straight from the build brief §8). */
export const SUGGESTED_WINDOWS = {
  weekday: { start: '16:00', end: '18:00' },
  weekend: { start: '09:00', end: '12:00' },
} as const;

/** Merge a (possibly partial / legacy) stored config onto the defaults. */
export function resolveGamesConfig(stored: Partial<GamesConfig> | undefined | null): GamesConfig {
  return { ...DEFAULT_GAMES_CONFIG, ...(stored ?? {}) };
}

/** Whole-year age from a YYYY-MM-DD birthday, or null if absent/unparseable. */
export function ageFromBirthday(birthday?: string | null): number | null {
  if (!birthday) return null;
  const b = new Date(birthday + 'T00:00:00');
  if (Number.isNaN(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

/** Points multiplier for a play — young kids get a boost on Quick Plays. */
export function pointsMultiplier(cfg: GamesConfig, world: GameWorld, age: number | null): number {
  if (world === 'quick' && age != null && age > 0 && age <= cfg.youngMaxAge) {
    return cfg.youngMultiplier;
  }
  return 1;
}

/** The kid's LOCAL day key (YYYY-MM-DD) given their device tz offset (the
 *  value of `-new Date().getTimezoneOffset()`, i.e. minutes to ADD to UTC).
 *  Clamped to ±14h so a spoofed offset can't shift the day more than a
 *  real timezone could. Used for the daily-cap accounting window. */
export function localDateKey(nowMs: number, tzOffsetMinutes: number): string {
  const clamped = Math.max(-14 * 60, Math.min(14 * 60, Math.round(tzOffsetMinutes || 0)));
  return new Date(nowMs + clamped * 60_000).toISOString().slice(0, 10);
}

/** Monday-of-this-week key (YYYY-MM-DD, kid-local) — the lower bound for the
 *  weekly-cap accounting window. Plays with dateKey >= this belong to the
 *  current week. Uses the same clamped tz handling as localDateKey. */
export function localWeekStartKey(nowMs: number, tzOffsetMinutes: number): string {
  const clamped = Math.max(-14 * 60, Math.min(14 * 60, Math.round(tzOffsetMinutes || 0)));
  const local = new Date(nowMs + clamped * 60_000);
  const dow = local.getUTCDay();              // 0=Sun … 6=Sat (on the shifted clock)
  const backToMon = (dow + 6) % 7;            // days since Monday
  local.setUTCDate(local.getUTCDate() - backToMon);
  return local.toISOString().slice(0, 10);
}

/** Lifecycle of a finished game:
 *  - 'logged'   — game is worth 0 HP (parent hasn't opted it in). Recorded
 *                 for history/streaks, but credits nothing and needs no
 *                 approval.
 *  - 'pending'  — game is worth > 0 HP. Awaits a parent's approval; NO HP is
 *                 credited yet (pointsPending holds the proposed amount).
 *  - 'approved' — a parent approved it; HP credited (pointsAwarded, after any
 *                 daily/weekly cap clipping applied AT approval time).
 *  - 'rejected' — a parent declined it; credits nothing. */
export type GamePlayStatus = 'logged' | 'pending' | 'approved' | 'rejected';

export interface GamePlay {
  id: string;
  kidId: string;
  kidName?: string;     // denormalised for the parent approval queue
  gameId: string;
  gameName?: string;    // denormalised for the parent approval queue
  world: GameWorld;
  score: number | null;
  durationSec: number;
  status: GamePlayStatus;
  pointsAwarded: number;  // HP actually credited (0 until approved)
  pointsPending: number;  // HP proposed, awaiting approval (0 once resolved)
  basePoints: number;     // the parent-set per-game value at completion time
  multiplier: number;
  dateKey: string;      // kid-local YYYY-MM-DD
  capped: boolean;      // true when a cap clipped the award at approval time
  createdAt?: number;   // ms epoch, set server-side
  resolvedAt?: number;  // ms epoch, set when approved/rejected
  resolvedBy?: string;  // parent uid who approved/rejected
  parentNote?: string;  // optional note shown to the kid (approve or reject)
  proofUrl?: string;    // Real-World: the photo the kid uploaded as proof (shown in the approval card)
}
