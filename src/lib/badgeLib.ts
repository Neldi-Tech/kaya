// 🏅 Badges 2.0 (BDG PR2, approved v3 FINAL 26-Jul-2026) — the badge
// catalog + config helpers. One consistent shape everywhere: id · name ·
// icon · tier · area · how-to-earn · signal.
//
// The ENGINE lives in /api/badges/mint (server-verified — kids can't write
// their own child doc, and we don't trust client-side counts anyway).
// This module is the shared vocabulary: catalog, tiers, areas, and the
// family's Boutique config (released set + threshold overrides + customs)
// stored on the family doc as `badgeConfig`.

export type BadgeTier = 'easy' | 'medium' | 'hard' | 'legendary';
export type BadgeArea =
  | 'points' | 'kindness' | 'sparks' | 'reflections' | 'chores'
  | 'sports' | 'quiz' | 'routines' | 'money' | 'family';

/** Signals the mint route can verify server-side. `parent_confirm` covers
 *  custom badges for things Kaya can't measure — a parent mints manually. */
export type BadgeSignal =
  | { kind: 'lifetime_points'; threshold: number }
  | { kind: 'streak_days'; threshold: number }
  | { kind: 'award_category_count'; category: string; threshold: number }
  | { kind: 'diamond_count'; threshold: number }
  | { kind: 'quiz_correct'; threshold: number }
  | { kind: 'meeting_count'; threshold: number }
  | { kind: 'goal_chipins'; threshold: number }
  | { kind: 'redemption_count'; threshold: number }
  | { kind: 'saver_weeks'; threshold: number }
  /** BDG PR3 — generic per-kid counter on child.badgeCounters (bumped by
   *  each area's flow, verified server-side at mint). */
  | { kind: 'child_counter'; key: string; threshold: number }
  /** BDG PR5 — 💎 Collector: hold every OTHER released badge in this area. */
  | { kind: 'area_complete'; area: BadgeArea }
  | { kind: 'parent_confirm' };

export interface BadgeDef {
  id: string;
  name: string;
  icon: string;
  tier: BadgeTier;
  area: BadgeArea;
  /** Kid-voice one-liner: how it's earned. */
  how: string;
  signal: BadgeSignal;
  /** BDG PR3 — its tracking hook ships in a later PR: shown in the Boutique
   *  as "coming soon", never releasable until the flag is dropped. */
  pending?: boolean;
  /** BDG PR5 — ✨ evolving set membership: same chase, richer shell.
   *  `level` 1/2/3 renders as I → II → III with a bronze/silver/gold ring. */
  set?: { id: string; level: 1 | 2 | 3 };
}

export const BADGE_TIERS: Record<BadgeTier, { label: string; emoji: string }> = {
  easy: { label: 'Easy', emoji: '🟢' },
  medium: { label: 'Medium', emoji: '🟡' },
  hard: { label: 'Hard', emoji: '🔴' },
  legendary: { label: 'Legendary', emoji: '💎' },
};
export const TIER_RANK: Record<BadgeTier, number> = { easy: 0, medium: 1, hard: 2, legendary: 3 };

export const BADGE_AREAS: { id: BadgeArea; label: string; emoji: string }[] = [
  { id: 'points', label: 'Points', emoji: '⭐' },
  { id: 'kindness', label: 'Kindness', emoji: '💗' },
  { id: 'sparks', label: 'Sparks', emoji: '✨' },
  { id: 'reflections', label: 'Reflections', emoji: '📔' },
  { id: 'chores', label: 'Chores', emoji: '🧹' },
  { id: 'sports', label: 'Sports', emoji: '⚽' },
  { id: 'quiz', label: 'Quiz', emoji: '🎯' },
  { id: 'routines', label: 'Routines', emoji: '🌞' },
  { id: 'money', label: 'Money', emoji: '🍯' },
  { id: 'family', label: 'Family', emoji: '👨‍👩‍👧' },
];

/** The built-in catalog. Legacy ids (first-star, saver-4…) keep their ids so
 *  already-earned badges stay earned. PR2 ships the engine for the signals it
 *  can verify today; PR3 wires the remaining area hooks. */
export const BADGE_CATALOG: BadgeDef[] = [
  // ⭐ Points (lifetime — spending never un-earns)
  { id: 'first-star', name: 'First Star', icon: '⭐', tier: 'easy', area: 'points', how: 'Earn your first points', signal: { kind: 'lifetime_points', threshold: 1 } },
  { id: 'rising-star', name: 'Rising Star', icon: '🌟', tier: 'easy', area: 'points', how: 'Earn 50 lifetime points', signal: { kind: 'lifetime_points', threshold: 50 }, set: { id: 'star', level: 1 } },
  { id: 'superstar', name: 'Superstar', icon: '💫', tier: 'medium', area: 'points', how: 'Earn 200 lifetime points', signal: { kind: 'lifetime_points', threshold: 200 }, set: { id: 'star', level: 2 } },
  { id: 'point-chief', name: 'Point Chief', icon: '🏵️', tier: 'hard', area: 'points', how: 'Earn 1,000 lifetime points', signal: { kind: 'lifetime_points', threshold: 1000 }, set: { id: 'star', level: 3 } },
  { id: 'point-legend', name: 'Point Legend', icon: '🌌', tier: 'legendary', area: 'points', how: 'Earn 5,000 lifetime points', signal: { kind: 'lifetime_points', threshold: 5000 } },
  // 🔥 Streaks (existing ids preserved)
  { id: 'streak-3', name: 'On Fire', icon: '🔥', tier: 'easy', area: 'routines', how: '3-day perfect streak', signal: { kind: 'streak_days', threshold: 3 }, set: { id: 'streak', level: 1 } },
  { id: 'streak-7', name: 'Unstoppable', icon: '🚀', tier: 'medium', area: 'routines', how: '7-day perfect streak', signal: { kind: 'streak_days', threshold: 7 }, set: { id: 'streak', level: 2 } },
  { id: 'streak-30', name: 'Legend', icon: '👑', tier: 'hard', area: 'routines', how: '30-day streak', signal: { kind: 'streak_days', threshold: 30 }, set: { id: 'streak', level: 3 } },
  // 💗 Kindness / HP categories
  { id: 'kindness-heart', name: 'Kindness Heart', icon: '💗', tier: 'easy', area: 'kindness', how: '5 kindness awards', signal: { kind: 'award_category_count', category: 'kindness', threshold: 5 }, set: { id: 'kind', level: 1 } },
  { id: 'helping-hand', name: 'Helping Hand', icon: '🤲', tier: 'medium', area: 'kindness', how: '10 helping awards', signal: { kind: 'award_category_count', category: 'helping', threshold: 10 }, set: { id: 'kind', level: 2 } },
  { id: 'diamond-mind', name: 'Diamond Mind', icon: '💎', tier: 'hard', area: 'kindness', how: 'Collect 5 Diamond awards', signal: { kind: 'diamond_count', threshold: 5 } },
  { id: 'golden-soul', name: 'Golden Soul', icon: '🌞', tier: 'legendary', area: 'kindness', how: '25 kindness awards', signal: { kind: 'award_category_count', category: 'kindness', threshold: 25 }, set: { id: 'kind', level: 3 } },
  // 🎯 Quiz
  { id: 'quiz-whiz', name: 'Quiz Whiz', icon: '🎯', tier: 'easy', area: 'quiz', how: '10 correct daily questions', signal: { kind: 'quiz_correct', threshold: 10 }, set: { id: 'quizset', level: 1 } },
  { id: 'brainiac', name: 'Brainiac', icon: '🧠', tier: 'medium', area: 'quiz', how: '50 correct daily questions', signal: { kind: 'quiz_correct', threshold: 50 }, set: { id: 'quizset', level: 2 } },
  // 👨‍👩‍👧 Family
  { id: 'meeting-champ', name: 'Meeting Champion', icon: '🏆', tier: 'medium', area: 'family', how: 'Attend 5 family meetings', signal: { kind: 'meeting_count', threshold: 5 } },
  { id: 'team-player', name: 'Team Player', icon: '🤝', tier: 'easy', area: 'family', how: 'First chip-in to a family goal', signal: { kind: 'goal_chipins', threshold: 1 } },
  // 🍯 Money (Saver ids preserved — already minted by SaverStreakCard)
  { id: 'saver-4', name: 'Bronze Saver', icon: '🥉', tier: 'medium', area: 'money', how: '4-week saver streak (≥50% saved)', signal: { kind: 'saver_weeks', threshold: 4 }, set: { id: 'saver', level: 1 } },
  { id: 'saver-12', name: 'Silver Saver', icon: '🥈', tier: 'hard', area: 'money', how: '12-week saver streak', signal: { kind: 'saver_weeks', threshold: 12 }, set: { id: 'saver', level: 2 } },
  { id: 'saver-26', name: 'Gold Saver', icon: '🥇', tier: 'legendary', area: 'money', how: '26-week saver streak', signal: { kind: 'saver_weeks', threshold: 26 }, set: { id: 'saver', level: 3 } },
  { id: 'smart-spender', name: 'Smart Spender', icon: '🛍️', tier: 'easy', area: 'money', how: 'First reward redeemed (with your 🛡 floor safe)', signal: { kind: 'redemption_count', threshold: 1 } },
  // ── BDG PR3 — the all-Kaya catalog ────────────────────────────────
  // 🍯 Money — conversions + business
  { id: 'honey-maker', name: 'Honey Maker', icon: '🍯', tier: 'easy', area: 'money', how: 'First HP → Coins conversion', signal: { kind: 'child_counter', key: 'conversions', threshold: 1 } },
  { id: 'honey-pro', name: 'Honey Pro', icon: '🐝', tier: 'medium', area: 'money', how: '10 HP → Coins conversions', signal: { kind: 'child_counter', key: 'conversions', threshold: 10 } },
  // 👨‍👩‍👧 Family goals
  { id: 'goal-getter', name: 'Goal Getter', icon: '🎪', tier: 'hard', area: 'family', how: 'Part of a reached family goal', signal: { kind: 'child_counter', key: 'goals_reached', threshold: 1 } },
  { id: 'family-legend', name: 'Family Legend', icon: '👑', tier: 'legendary', area: 'family', how: '3 family goals reached together', signal: { kind: 'child_counter', key: 'goals_reached', threshold: 3 } },
  // 🎯 Quiz (server-bumped on correct answers)
  { id: 'brainiac-plus', name: 'Quiz Master', icon: '🧙', tier: 'hard', area: 'quiz', how: '100 correct daily questions', signal: { kind: 'child_counter', key: 'quiz_correct', threshold: 100 }, set: { id: 'quizset', level: 3 } },
  // 🧹 Chores / Workplan (server-bumped on approved items)
  { id: 'chore-champ', name: 'Chore Champ', icon: '🧹', tier: 'easy', area: 'chores', how: '25 workplan items done', signal: { kind: 'child_counter', key: 'workplan_done', threshold: 25 }, set: { id: 'chores', level: 1 } },
  { id: 'task-master', name: 'Task Master', icon: '📋', tier: 'medium', area: 'chores', how: '100 workplan items done', signal: { kind: 'child_counter', key: 'workplan_done', threshold: 100 }, set: { id: 'chores', level: 2 } },
  { id: 'iron-will', name: 'Iron Will', icon: '🛡️', tier: 'legendary', area: 'chores', how: '500 workplan items done', signal: { kind: 'child_counter', key: 'workplan_done', threshold: 500 }, set: { id: 'chores', level: 3 } },
  // ── Hooks land in BDG PR4 (pending: shown as "coming soon") ───────
  { id: 'spark-starter', name: 'Spark Starter', icon: '✨', tier: 'easy', area: 'sparks', how: 'First Sparks project completed', signal: { kind: 'child_counter', key: 'sparks_done', threshold: 1 }, pending: true, set: { id: 'spark', level: 1 } },
  { id: 'spark-maker', name: 'Spark Maker', icon: '🎨', tier: 'medium', area: 'sparks', how: '5 Sparks projects completed', signal: { kind: 'child_counter', key: 'sparks_done', threshold: 5 }, pending: true, set: { id: 'spark', level: 2 } },
  { id: 'spark-master', name: 'Spark Master', icon: '🌠', tier: 'hard', area: 'sparks', how: '20 Sparks projects completed', signal: { kind: 'child_counter', key: 'sparks_done', threshold: 20 }, pending: true, set: { id: 'spark', level: 3 } },
  { id: 'first-thoughts', name: 'First Thoughts', icon: '📔', tier: 'easy', area: 'reflections', how: 'First daily reflection', signal: { kind: 'child_counter', key: 'reflections_done', threshold: 1 }, pending: true },
  { id: 'honest-heart', name: 'Honest Heart', icon: '💛', tier: 'medium', area: 'reflections', how: '7 reflections in a row', signal: { kind: 'child_counter', key: 'reflection_streak', threshold: 7 }, pending: true },
  { id: 'deep-thinker', name: 'Deep Thinker', icon: '🦉', tier: 'hard', area: 'reflections', how: '30 daily reflections', signal: { kind: 'child_counter', key: 'reflections_done', threshold: 30 }, pending: true },
  { id: 'sport-spark', name: 'Sport Spark', icon: '⚽', tier: 'easy', area: 'sports', how: 'First sports-club session', signal: { kind: 'child_counter', key: 'sports_sessions', threshold: 1 }, pending: true },
  { id: 'team-athlete', name: 'Team Athlete', icon: '🏃', tier: 'medium', area: 'sports', how: '10 sports-club sessions', signal: { kind: 'child_counter', key: 'sports_sessions', threshold: 10 }, pending: true },
  { id: 'early-bird', name: 'Early Bird', icon: '🦉', tier: 'easy', area: 'routines', how: '7 excellent morning routines', signal: { kind: 'child_counter', key: 'morning_excellent', threshold: 7 }, pending: true },
  { id: 'golden-evening', name: 'Golden Evening', icon: '🌙', tier: 'medium', area: 'routines', how: '7 excellent evening routines', signal: { kind: 'child_counter', key: 'evening_excellent', threshold: 7 }, pending: true },
  // ── BDG PR5 — 🎁 pack badges + 💎 area Collectors ──────────────────
  // Pack-only chases. Every one is measured by a counter that already
  // exists, so a seasonal badge is as real as a permanent one.
  { id: 'giving-hands', name: 'Giving Hands', icon: '🫶', tier: 'medium', area: 'kindness', how: '10 giving awards', signal: { kind: 'award_category_count', category: 'giving', threshold: 10 } },
  { id: 'gratitude-glow', name: 'Gratitude Glow', icon: '🌟', tier: 'easy', area: 'family', how: '3 family meetings attended', signal: { kind: 'meeting_count', threshold: 3 } },
  { id: 'homework-hero', name: 'Homework Hero', icon: '📚', tier: 'medium', area: 'chores', how: '50 workplan items done', signal: { kind: 'child_counter', key: 'workplan_done', threshold: 50 } },
  { id: 'break-streaker', name: 'Break Streaker', icon: '🌞', tier: 'medium', area: 'routines', how: '14-day streak over the break', signal: { kind: 'streak_days', threshold: 14 } },
  { id: 'break-helper', name: 'Break Helper', icon: '🧺', tier: 'medium', area: 'kindness', how: '15 helping awards', signal: { kind: 'award_category_count', category: 'helping', threshold: 15 } },
  { id: 'break-scholar', name: 'Break Scholar', icon: '🎓', tier: 'medium', area: 'quiz', how: '25 correct daily questions', signal: { kind: 'quiz_correct', threshold: 25 } },
  // 💎 Collectors — mint when a kid holds EVERY released badge in an area.
  { id: 'collector-points', name: 'Points Collector', icon: '💎', tier: 'legendary', area: 'points', how: 'Every released ⭐ Points badge', signal: { kind: 'area_complete', area: 'points' } },
  { id: 'collector-kindness', name: 'Kindness Collector', icon: '💎', tier: 'legendary', area: 'kindness', how: 'Every released 💗 Kindness badge', signal: { kind: 'area_complete', area: 'kindness' } },
  { id: 'collector-chores', name: 'Chores Collector', icon: '💎', tier: 'legendary', area: 'chores', how: 'Every released 🧹 Chores badge', signal: { kind: 'area_complete', area: 'chores' } },
  { id: 'collector-quiz', name: 'Quiz Collector', icon: '💎', tier: 'legendary', area: 'quiz', how: 'Every released 🎯 Quiz badge', signal: { kind: 'area_complete', area: 'quiz' } },
  { id: 'collector-money', name: 'Money Collector', icon: '💎', tier: 'legendary', area: 'money', how: 'Every released 🍯 Money badge', signal: { kind: 'area_complete', area: 'money' } },
  { id: 'collector-family', name: 'Family Collector', icon: '💎', tier: 'legendary', area: 'family', how: 'Every released 👨‍👩‍👧 Family badge', signal: { kind: 'area_complete', area: 'family' } },
];

// ── BDG PR5 · 🎁 Badge Packs ─────────────────────────────────────────
// Curated bundles a parent releases with ONE tap. A pack with a `window`
// is limited-time: its badges are only earnable between those dates
// (enforced at mint, not just in the UI), which is where the urgency kids
// feel actually comes from. Dates are local YYYY-MM-DD day keys, and the
// window repeats yearly on month-day so a seasonal pack stays seasonal.

export interface BadgePack {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  /** CSS gradient for the rail card. */
  gradient: string;
  /** Ink colour for the card's "Release all" chip. */
  ink: string;
  badgeIds: string[];
  /** Limited-time window as MM-DD..MM-DD, inclusive, repeating yearly. */
  window?: { from: string; to: string };
}

export const BADGE_PACKS: BadgePack[] = [
  {
    id: 'ramadan', name: 'Ramadan Pack', emoji: '🌙',
    blurb: 'kindness + giving',
    gradient: 'linear-gradient(135deg,#1c3a5e,#2d5a8e)', ink: '#1c3a5e',
    badgeIds: ['kindness-heart', 'helping-hand', 'giving-hands', 'golden-soul'],
  },
  {
    id: 'holiday', name: 'Holiday Pack', emoji: '🎄',
    blurb: 'family time',
    gradient: 'linear-gradient(135deg,#5e1c2e,#8e2d49)', ink: '#5e1c2e',
    badgeIds: ['gratitude-glow', 'meeting-champ', 'team-player', 'goal-getter', 'family-legend'],
  },
  {
    id: 'back-to-school', name: 'Back-to-School', emoji: '📚',
    blurb: 'routines + homework',
    gradient: 'linear-gradient(135deg,#1c5e3a,#2d8e5c)', ink: '#1c5e3a',
    badgeIds: ['homework-hero', 'chore-champ', 'quiz-whiz', 'brainiac'],
  },
  {
    id: 'break-challenge', name: 'Holiday-Break Challenge', emoji: '☀️',
    blurb: '⏳ limited time!',
    gradient: 'linear-gradient(135deg,#5e4a1c,#8e712d)', ink: '#5e4a1c',
    badgeIds: ['break-streaker', 'break-helper', 'break-scholar'],
    window: { from: '08-01', to: '08-31' },
  },
];

/** The pack a badge belongs to, if any. */
export function packForBadge(badgeId: string): BadgePack | undefined {
  return BADGE_PACKS.find((p) => p.badgeIds.includes(badgeId));
}

/** Is a limited-time badge inside its window today? Non-pack and unlimited
 *  badges are always in season. `todayKey` is a local YYYY-MM-DD day key —
 *  passed in so the caller owns the timezone (never a silent UTC read). */
export function isBadgeInSeason(badgeId: string, todayKey: string): boolean {
  const pack = packForBadge(badgeId);
  if (!pack?.window) return true;
  const md = todayKey.slice(5); // MM-DD
  const { from, to } = pack.window;
  // A window that wraps the new year (e.g. 12-15..01-05) is still one season.
  return from <= to ? md >= from && md <= to : md >= from || md <= to;
}

// ── BDG PR5 · ✨ evolving sets ───────────────────────────────────────
export const SET_META: Record<string, { label: string; emoji: string }> = {
  star: { label: 'Star', emoji: '⭐' },
  streak: { label: 'Streak', emoji: '🔥' },
  kind: { label: 'Kindness', emoji: '💗' },
  quizset: { label: 'Quiz', emoji: '🎯' },
  chores: { label: 'Chores', emoji: '🧹' },
  saver: { label: 'Saver', emoji: '🍯' },
  spark: { label: 'Sparks', emoji: '✨' },
};
export const ROMAN: Record<1 | 2 | 3, string> = { 1: 'I', 2: 'II', 3: 'III' };
/** Bronze → silver → gold shell for a set level. */
export const SET_RING: Record<1 | 2 | 3, string> = {
  1: '#b08d57',
  2: '#b9c3cc',
  3: '#F0A32A',
};

/** Boutique config on the family doc. Absent released map = the DEFAULT set
 *  (every catalog badge whose tier is easy/medium) so families start alive. */
export interface BadgeConfig {
  /** badgeId → released? Missing id = default (easy+medium released). */
  released?: Record<string, boolean>;
  /** badgeId → threshold override (points/counts). */
  thresholds?: Record<string, number>;
  /** Parent-created customs. A custom can ride any measurable signal the
   *  🪄 Studio picked (counter/points/streak) or `parent_confirm` for the
   *  things Kaya genuinely can't see. */
  customs?: Array<{
    id: string; name: string; icon: string; tier: BadgeTier; area: BadgeArea; how: string;
    pointsThreshold?: number;
    /** BDG PR5 — Studio-picked tracking. `counterKey` + `threshold` maps to a
     *  child_counter signal; absent → points threshold, else parent_confirm. */
    counterKey?: string;
    threshold?: number;
    streakDays?: number;
    /** Where it came from, for the Studio list. */
    source?: 'studio' | 'manual';
  }>;
}

export function isBadgeReleased(cfg: BadgeConfig | undefined, def: BadgeDef): boolean {
  if (def.pending) return false; // hook not shipped yet — never releasable
  const explicit = cfg?.released?.[def.id];
  if (typeof explicit === 'boolean') return explicit;
  return def.tier === 'easy' || def.tier === 'medium';
}

export function badgeThreshold(cfg: BadgeConfig | undefined, def: BadgeDef): number {
  const t = cfg?.thresholds?.[def.id];
  if (Number.isFinite(t) && (t as number) > 0) return Math.floor(t as number);
  return 'threshold' in def.signal ? def.signal.threshold : 0;
}

/** Full working set for a family: catalog + customs mapped to defs. A custom
 *  earns its signal from whatever the 🪄 Studio (or the parent) chose — a
 *  counter, lifetime points, a streak — and falls back to parent_confirm for
 *  the things Kaya honestly can't measure. */
export function familyBadgeSet(cfg: BadgeConfig | undefined): BadgeDef[] {
  const customs: BadgeDef[] = (cfg?.customs ?? []).map((c) => {
    let signal: BadgeSignal = { kind: 'parent_confirm' };
    if (c.counterKey && c.threshold && c.threshold > 0) {
      signal = { kind: 'child_counter', key: c.counterKey, threshold: c.threshold };
    } else if (c.streakDays && c.streakDays > 0) {
      signal = { kind: 'streak_days', threshold: c.streakDays };
    } else if (c.pointsThreshold && c.pointsThreshold > 0) {
      signal = { kind: 'lifetime_points', threshold: c.pointsThreshold };
    }
    return { id: c.id, name: c.name, icon: c.icon, tier: c.tier, area: c.area, how: c.how, signal };
  });
  return [...BADGE_CATALOG, ...customs];
}

export function badgeById(cfg: BadgeConfig | undefined, id: string): BadgeDef | undefined {
  return familyBadgeSet(cfg).find((b) => b.id === id);
}

// ── BDG PR3 · counters ──────────────────────────────────────────────
// Everything Kaya can't read off the child doc directly (quiz answers,
// awards by category, meetings attended, HP→Coins conversions, workplan
// items done…) is tallied into ONE map on the child doc:
//   families/{f}/children/{c}.badgeCounters = { quiz_correct: 12, … }
// Each area's own flow bumps its key as it happens; the mint route reads
// the map back and verifies the threshold server-side. One shape, one
// verification path, no per-area query gymnastics (and no new composite
// indexes, which would mean a destructive index deploy).

/** The counter key a signal is measured against — null = not counter-based. */
export function counterKeyForSignal(signal: BadgeSignal): string | null {
  switch (signal.kind) {
    case 'award_category_count': return `award_${signal.category}`;
    case 'diamond_count': return 'diamonds';
    case 'quiz_correct': return 'quiz_correct';
    case 'meeting_count': return 'meetings';
    case 'child_counter': return signal.key;
    default: return null;
  }
}

/** Kid-facing progress toward one badge, from the family-readable child
 *  fields. Returns null when Kaya can't measure it (custom / parent-minted).
 *  Powers 🧭 Kaya Badge advisory + every progress bar. */
export function badgeProgress(
  cfg: BadgeConfig | undefined,
  def: BadgeDef,
  child: { totalPoints?: number; lifetimePoints?: number; streak?: number; badgeCounters?: Record<string, number> },
): { have: number; need: number; pct: number } | null {
  const need = badgeThreshold(cfg, def);
  if (need <= 0) return null;
  let have: number | null = null;
  if (def.signal.kind === 'lifetime_points') {
    have = Math.max(child.lifetimePoints || 0, child.totalPoints || 0);
  } else if (def.signal.kind === 'streak_days') {
    have = child.streak || 0;
  } else {
    const key = counterKeyForSignal(def.signal);
    if (key) have = child.badgeCounters?.[key] || 0;
  }
  if (have === null) return null;
  return { have, need, pct: Math.max(0, Math.min(100, Math.round((have / need) * 100))) };
}

// ── BDG PR5 · collection meters + 💎 Collector ───────────────────────

/** The released badges of an area, EXCLUDING its own 💎 Collector (a
 *  Collector can't be a prerequisite for itself). */
export function areaChaseSet(cfg: BadgeConfig | undefined, area: BadgeArea): BadgeDef[] {
  return familyBadgeSet(cfg).filter((b) =>
    b.area === area && isBadgeReleased(cfg, b) && b.signal.kind !== 'area_complete');
}

/** "✨ Sparks set: 2/4" — per-area collection meter for one kid. */
export function areaCollection(
  cfg: BadgeConfig | undefined,
  area: BadgeArea,
  earned: string[] | undefined,
): { have: number; need: number; pct: number; complete: boolean } {
  const chase = areaChaseSet(cfg, area);
  const ids = new Set(earned || []);
  const have = chase.filter((b) => ids.has(b.id)).length;
  const need = chase.length;
  return {
    have, need,
    pct: need > 0 ? Math.round((have / need) * 100) : 0,
    complete: need > 0 && have >= need,
  };
}

/** One kid's progress through an evolving set (I → II → III). */
export function setProgress(
  cfg: BadgeConfig | undefined,
  setId: string,
  earned: string[] | undefined,
): { levels: Array<{ def: BadgeDef; earned: boolean }>; highest: 0 | 1 | 2 | 3 } {
  const ids = new Set(earned || []);
  const levels = familyBadgeSet(cfg)
    .filter((b) => b.set?.id === setId)
    .sort((a, b) => (a.set!.level) - (b.set!.level))
    .map((def) => ({ def, earned: ids.has(def.id) }));
  let highest: 0 | 1 | 2 | 3 = 0;
  for (const l of levels) if (l.earned) highest = l.def.set!.level;
  return { levels, highest };
}
