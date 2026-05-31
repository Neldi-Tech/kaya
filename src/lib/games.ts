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
  /** Calm Corner is exempt from the daily caps (small, steady rewards). */
  calmUncapped: boolean;
  /** Require the day's homework done before non-calm games unlock (UI gate). */
  homeworkGate: boolean;
  /** Multiplier applied to Quick Plays points for young kids. */
  youngMultiplier: number;
  /** "Young" = age at or below this (years). */
  youngMaxAge: number;
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
  calmUncapped: true,
  homeworkGate: false,
  youngMultiplier: 1.5,
  youngMaxAge: 6,
};

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

export interface GamePlay {
  id: string;
  kidId: string;
  gameId: string;
  world: GameWorld;
  score: number | null;
  durationSec: number;
  pointsAwarded: number;
  basePoints: number;
  multiplier: number;
  dateKey: string;      // kid-local YYYY-MM-DD
  capped: boolean;      // true when the daily points cap clipped the award
}
