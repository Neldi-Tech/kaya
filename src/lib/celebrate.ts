// Kaya · Celebrations — a short, joyful (or inspiring) takeover when a kid
// earns points. "Surprising by design": a pool of reward treatments rotates so
// kids never quite know which they'll get. Age-aware + parent-chosen per kid.
//
// This module is pure (no React) — types, the content pools, the per-kid
// settings model (+ age defaults), and `resolveCelebration` which the provider
// calls to turn an event into a concrete on-screen treatment.

import type { Child } from './firestore';

export type CelebrationStyle = 'celebration' | 'inspiring' | 'surprise';
export type CelebrationIntensity = 'calm' | 'normal' | 'big';
export type CelebrationKind = 'stocktake' | 'sale' | 'hp' | 'milestone' | 'streak';
export type CelebrationVariant = 'confetti' | 'bee' | 'sticker' | 'mystery' | 'fireworks' | 'levelup';

export interface CelebrationSettings {
  style: CelebrationStyle;
  intensity: CelebrationIntensity;
  sound: boolean;
}

export interface CelebrationEvent {
  kind: CelebrationKind;
  points?: number;       // HP earned (if any)
  streak?: number;       // current streak days (if relevant)
  title?: string;        // optional headline override
  subtitle?: string;     // optional sub override
}

export interface CelebrationReward { label: string; emoji: string }

export interface ResolvedCelebration {
  mode: 'celebration' | 'inspiring';
  variant: CelebrationVariant;
  emoji: string;
  headline: string;
  message: string;
  reward?: CelebrationReward;     // sticker / mystery unlock
  quote?: string;                 // inspiring mode
  intensity: CelebrationIntensity;
  sound: boolean;
  /** ms the overlay stays up before auto-dismiss (tap dismisses sooner). */
  durationMs: number;
}

// ── Settings: per-kid, with age-based defaults ───────────────────
export function ageFromBirthday(birthday?: string, now: Date = new Date()): number | undefined {
  if (!birthday) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthday);
  if (!m) return undefined;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  let age = now.getFullYear() - y;
  const had = now.getMonth() + 1 > mo || (now.getMonth() + 1 === mo && now.getDate() >= d);
  if (!had) age -= 1;
  return age >= 0 && age < 120 ? age : undefined;
}

/** Sensible default by age band: little kids love the big show; older kids
 *  graduate to a surprise mix, then to inspiring words. Sound off by default. */
export function defaultCelebrationSettings(age?: number): CelebrationSettings {
  if (age !== undefined && age >= 12) return { style: 'inspiring', intensity: 'calm', sound: false };
  if (age !== undefined && age >= 7)  return { style: 'surprise', intensity: 'normal', sound: false };
  return { style: 'celebration', intensity: age === undefined ? 'normal' : 'big', sound: false };
}

/** The effective settings for a child — their saved choice, else the age default. */
export function celebrationSettingsFor(child?: Pick<Child, 'birthday'> & { celebration?: CelebrationSettings } | null): CelebrationSettings {
  const fallback = defaultCelebrationSettings(ageFromBirthday(child?.birthday));
  const saved = child?.celebration;
  if (!saved) return fallback;
  return {
    style: saved.style ?? fallback.style,
    intensity: saved.intensity ?? fallback.intensity,
    sound: saved.sound ?? fallback.sound,
  };
}

// ── Content pools ────────────────────────────────────────────────
export const SURPRISE_POOL: CelebrationVariant[] = ['confetti', 'bee', 'sticker', 'mystery', 'fireworks', 'levelup'];

const STICKERS: CelebrationReward[] = [
  { label: 'Golden Bee', emoji: '🐝' },
  { label: 'Honey Star', emoji: '⭐' },
  { label: 'Busy Bee badge', emoji: '🏅' },
  { label: 'Rainbow Hive', emoji: '🌈' },
  { label: 'Super Saver', emoji: '💪' },
  { label: 'Bright Spark', emoji: '✨' },
];

// Curated, kid-safe, generic affirmations + sparks (no attribution needed).
const SPARKS: string[] = [
  'Small steps every day build big things.',
  'You showed up today — that\'s how winners are made.',
  'Effort is your superpower. Keep going!',
  'Little by little becomes a lot.',
  'Done is better than perfect — and you did it!',
  'Every pro was once a beginner who kept trying.',
  'Your future self says thank you.',
  'Consistency beats talent. Look at you go!',
];

const VARIANT_EMOJI: Record<CelebrationVariant, string> = {
  confetti: '🎉', bee: '🐝', sticker: '🏅', mystery: '🎁', fireworks: '🎆', levelup: '⬆️',
};

const KIND_HEADLINE: Record<CelebrationKind, string> = {
  stocktake: 'Stock-take done!',
  sale: 'Sale logged!',
  hp: 'Points earned!',
  milestone: 'Milestone unlocked!',
  streak: 'Streak going strong!',
};

// Deterministic-ish pick that avoids repeating the last variant.
function pickVariant(avoid?: CelebrationVariant, rng: () => number = Math.random): CelebrationVariant {
  const pool = avoid ? SURPRISE_POOL.filter((v) => v !== avoid) : SURPRISE_POOL;
  return pool[Math.floor(rng() * pool.length)] ?? 'confetti';
}
function pick<T>(arr: T[], rng: () => number = Math.random): T {
  return arr[Math.floor(rng() * arr.length)] ?? arr[0];
}

const DURATION: Record<CelebrationIntensity, number> = { calm: 2200, normal: 3200, big: 4200 };

/** Turn an event + the kid's settings into a concrete on-screen treatment.
 *  `lastVariant` (from the provider) keeps the surprise feeling fresh; `rng`
 *  is injectable for tests. */
export function resolveCelebration(
  event: CelebrationEvent,
  settings: CelebrationSettings,
  opts: { lastVariant?: CelebrationVariant; rng?: () => number } = {},
): ResolvedCelebration {
  const rng = opts.rng ?? Math.random;
  // Surprise = mostly the show, occasionally an inspiring beat (≈1 in 4).
  const mode: 'celebration' | 'inspiring' =
    settings.style === 'inspiring' ? 'inspiring'
    : settings.style === 'celebration' ? 'celebration'
    : (rng() < 0.25 ? 'inspiring' : 'celebration');

  const pts = event.points && event.points > 0 ? event.points : 0;
  const headline = event.title || KIND_HEADLINE[event.kind];
  const streakMsg = event.streak && event.streak > 1 ? ` · ${event.streak}-day streak 🔥` : '';
  const baseMsg = event.subtitle || (pts ? `+${pts} House Point${pts === 1 ? '' : 's'}${streakMsg}` : (streakMsg.trim() || 'Nice work!'));

  if (mode === 'inspiring') {
    return {
      mode: 'inspiring',
      variant: 'levelup',
      emoji: '🌟',
      headline: pts ? `+${pts} HP` : headline,
      message: baseMsg,
      quote: pick(SPARKS, rng),
      intensity: settings.intensity,
      sound: settings.sound,
      durationMs: DURATION[settings.intensity],
    };
  }

  const variant = pickVariant(opts.lastVariant, rng);
  const reward = variant === 'sticker' || variant === 'mystery' ? pick(STICKERS, rng) : undefined;
  return {
    mode: 'celebration',
    variant,
    emoji: VARIANT_EMOJI[variant],
    headline,
    message: baseMsg,
    reward,
    intensity: settings.intensity,
    sound: settings.sound,
    durationMs: DURATION[settings.intensity],
  };
}
