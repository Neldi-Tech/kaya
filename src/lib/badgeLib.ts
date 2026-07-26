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
  { id: 'rising-star', name: 'Rising Star', icon: '🌟', tier: 'easy', area: 'points', how: 'Earn 50 lifetime points', signal: { kind: 'lifetime_points', threshold: 50 } },
  { id: 'superstar', name: 'Superstar', icon: '💫', tier: 'medium', area: 'points', how: 'Earn 200 lifetime points', signal: { kind: 'lifetime_points', threshold: 200 } },
  { id: 'point-chief', name: 'Point Chief', icon: '🏵️', tier: 'hard', area: 'points', how: 'Earn 1,000 lifetime points', signal: { kind: 'lifetime_points', threshold: 1000 } },
  { id: 'point-legend', name: 'Point Legend', icon: '🌌', tier: 'legendary', area: 'points', how: 'Earn 5,000 lifetime points', signal: { kind: 'lifetime_points', threshold: 5000 } },
  // 🔥 Streaks (existing ids preserved)
  { id: 'streak-3', name: 'On Fire', icon: '🔥', tier: 'easy', area: 'routines', how: '3-day perfect streak', signal: { kind: 'streak_days', threshold: 3 } },
  { id: 'streak-7', name: 'Unstoppable', icon: '🚀', tier: 'medium', area: 'routines', how: '7-day perfect streak', signal: { kind: 'streak_days', threshold: 7 } },
  { id: 'streak-30', name: 'Legend', icon: '👑', tier: 'hard', area: 'routines', how: '30-day streak', signal: { kind: 'streak_days', threshold: 30 } },
  // 💗 Kindness / HP categories
  { id: 'kindness-heart', name: 'Kindness Heart', icon: '💗', tier: 'easy', area: 'kindness', how: '5 kindness awards', signal: { kind: 'award_category_count', category: 'kindness', threshold: 5 } },
  { id: 'helping-hand', name: 'Helping Hand', icon: '🤲', tier: 'medium', area: 'kindness', how: '10 helping awards', signal: { kind: 'award_category_count', category: 'helping', threshold: 10 } },
  { id: 'diamond-mind', name: 'Diamond Mind', icon: '💎', tier: 'hard', area: 'kindness', how: 'Collect 5 Diamond awards', signal: { kind: 'diamond_count', threshold: 5 } },
  { id: 'golden-soul', name: 'Golden Soul', icon: '🌞', tier: 'legendary', area: 'kindness', how: '25 kindness awards', signal: { kind: 'award_category_count', category: 'kindness', threshold: 25 } },
  // 🎯 Quiz
  { id: 'quiz-whiz', name: 'Quiz Whiz', icon: '🎯', tier: 'easy', area: 'quiz', how: '10 correct daily questions', signal: { kind: 'quiz_correct', threshold: 10 } },
  { id: 'brainiac', name: 'Brainiac', icon: '🧠', tier: 'medium', area: 'quiz', how: '50 correct daily questions', signal: { kind: 'quiz_correct', threshold: 50 } },
  // 👨‍👩‍👧 Family
  { id: 'meeting-champ', name: 'Meeting Champion', icon: '🏆', tier: 'medium', area: 'family', how: 'Attend 5 family meetings', signal: { kind: 'meeting_count', threshold: 5 } },
  { id: 'team-player', name: 'Team Player', icon: '🤝', tier: 'easy', area: 'family', how: 'First chip-in to a family goal', signal: { kind: 'goal_chipins', threshold: 1 } },
  // 🍯 Money (Saver ids preserved — already minted by SaverStreakCard)
  { id: 'saver-4', name: 'Bronze Saver', icon: '🥉', tier: 'medium', area: 'money', how: '4-week saver streak (≥50% saved)', signal: { kind: 'saver_weeks', threshold: 4 } },
  { id: 'saver-12', name: 'Silver Saver', icon: '🥈', tier: 'hard', area: 'money', how: '12-week saver streak', signal: { kind: 'saver_weeks', threshold: 12 } },
  { id: 'saver-26', name: 'Gold Saver', icon: '🥇', tier: 'legendary', area: 'money', how: '26-week saver streak', signal: { kind: 'saver_weeks', threshold: 26 } },
  { id: 'smart-spender', name: 'Smart Spender', icon: '🛍️', tier: 'easy', area: 'money', how: 'First reward redeemed (with your 🛡 floor safe)', signal: { kind: 'redemption_count', threshold: 1 } },
];

/** Boutique config on the family doc. Absent released map = the DEFAULT set
 *  (every catalog badge whose tier is easy/medium) so families start alive. */
export interface BadgeConfig {
  /** badgeId → released? Missing id = default (easy+medium released). */
  released?: Record<string, boolean>;
  /** badgeId → threshold override (points/counts). */
  thresholds?: Record<string, number>;
  /** Parent-created customs (ride the parent_confirm or lifetime_points signals). */
  customs?: Array<{ id: string; name: string; icon: string; tier: BadgeTier; area: BadgeArea; how: string; pointsThreshold?: number }>;
}

export function isBadgeReleased(cfg: BadgeConfig | undefined, def: BadgeDef): boolean {
  const explicit = cfg?.released?.[def.id];
  if (typeof explicit === 'boolean') return explicit;
  return def.tier === 'easy' || def.tier === 'medium';
}

export function badgeThreshold(cfg: BadgeConfig | undefined, def: BadgeDef): number {
  const t = cfg?.thresholds?.[def.id];
  if (Number.isFinite(t) && (t as number) > 0) return Math.floor(t as number);
  return 'threshold' in def.signal ? def.signal.threshold : 0;
}

/** Full working set for a family: catalog + customs mapped to defs. */
export function familyBadgeSet(cfg: BadgeConfig | undefined): BadgeDef[] {
  const customs: BadgeDef[] = (cfg?.customs ?? []).map((c) => ({
    id: c.id, name: c.name, icon: c.icon, tier: c.tier, area: c.area, how: c.how,
    signal: c.pointsThreshold && c.pointsThreshold > 0
      ? { kind: 'lifetime_points', threshold: c.pointsThreshold }
      : { kind: 'parent_confirm' },
  }));
  return [...BADGE_CATALOG, ...customs];
}

export function badgeById(cfg: BadgeConfig | undefined, id: string): BadgeDef | undefined {
  return familyBadgeSet(cfg).find((b) => b.id === id);
}
