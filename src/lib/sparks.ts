// Kaya Sparks — types + pure helpers.
//
// Intentionally has NO firebase imports. This file is safe to import
// from server routes, the Admin SDK code path, and client components
// alike. Client-side fetchers live in `sparksClient.ts` (separate so
// the firebase client SDK never initializes inside an API route).

// ── Types ───────────────────────────────────────────────────────────────

export type SparkCategory = 'idea' | 'bug' | 'help' | 'story';

export type SparkStatus =
  | 'new'        // ⚡ just submitted
  | 'review'     // 👀 admin reading
  | 'soon'       // 🔮 Coming Soon (admin promised)
  | 'building'   // 🛠 actively in development
  | 'live'       // ✅ shipped
  | 'reward';    // 🌟 shipped + spark reward credited

export type SparkTargetWindow = 'Q3 2026' | 'Q4 2026' | 'Q1 2027' | 'No date yet' | null;

// What the public sees. Anonymous posts have authorDisplayName already
// replaced with "A Kaya family" and authorAvatarKey is a stable hash
// that does NOT reveal the family. authorRealName is operator-only and
// returned only when the caller is an operator.
export interface Spark {
  id: string;
  title: string;
  body: string;
  category: SparkCategory;
  status: SparkStatus;
  comingSoonTargetWindow: SparkTargetWindow;
  upvoteCount: number;
  commentCount: number;
  authorDisplayName: string;          // sanitized
  authorAvatarKey: string;            // gradient colour key (anon-safe)
  postedAnonymously: boolean;
  authorIsMe: boolean;                // "did I post this?" for own-edit UI
  iVoted: boolean;
  createdAt: number;                  // ms epoch
  updatedAt: number;
  shippedAt: number | null;
  rewardedHoneyCoins: number | null;
  // Operator-only fields (undefined for non-operators)
  authorRealName?: string;
  authorFamilyId?: string;
  authorUid?: string;
}

export interface SparkComment {
  id: string;
  body: string;
  authorDisplayName: string;
  authorAvatarKey: string;
  postedAnonymously: boolean;
  authorIsMe: boolean;
  createdAt: number;
  // Operator-only
  authorRealName?: string;
  authorFamilyId?: string;
}

export interface SparkListOptions {
  category?: SparkCategory | 'all';
  status?: SparkStatus | 'all';
  sort?: 'hot' | 'new' | 'top';
}

export interface SparksSettings {
  showRoadmap: boolean;
  allowAnonymous: boolean;
  kidsDefaultAnonymous: boolean;
  autoPublish: boolean;
  enableSparkBadge: boolean;
  honeyCoinsPerShippedIdea: number;
  anonymousEarnsCoins: boolean;
  founderCoffeeTopN: number;
  showStoriesCategory: boolean;
}

export const DEFAULT_SPARKS_SETTINGS: SparksSettings = {
  showRoadmap: false,
  allowAnonymous: true,
  kidsDefaultAnonymous: true,
  autoPublish: false,
  enableSparkBadge: true,
  honeyCoinsPerShippedIdea: 500,
  anonymousEarnsCoins: true,
  founderCoffeeTopN: 3,
  showStoriesCategory: true,
};

// ── Status pill copy + colour ─────────────────────────────────────────

export interface PillSpec {
  label: string;
  bg: string;
  fg: string;
  bgGradient?: string;
}

export function statusPill(s: SparkStatus): PillSpec {
  switch (s) {
    case 'new':      return { label: '⚡ New',       bg: '#FFE8E5', fg: '#E85C5C' };
    case 'review':   return { label: '👀 Under review', bg: '#FFF4D6', fg: '#B8860B' };
    case 'soon':     return { label: '🔮 Coming Soon', bg: '#E2F0FF', fg: '#9B6BE3', bgGradient: 'linear-gradient(135deg,#E2F0FF,#F0E8FB)' };
    case 'building': return { label: '🛠 Building',  bg: '#E2F0FF', fg: '#1F6FB8' };
    case 'live':     return { label: '✅ Live',      bg: '#E5F7EF', fg: '#2E7D34' };
    case 'reward':   return { label: '🌟 Shipped — Spark Reward', bg: '#F0E8FB', fg: '#9B6BE3' };
  }
}

export function categoryEmoji(c: SparkCategory): string {
  switch (c) {
    case 'idea':  return '✨';
    case 'bug':   return '🐛';
    case 'help':  return '❓';
    case 'story': return '📖';
  }
}

export function categoryLabel(c: SparkCategory): string {
  switch (c) {
    case 'idea':  return 'Idea';
    case 'bug':   return 'Bug';
    case 'help':  return 'Help';
    case 'story': return 'Story';
  }
}

// ── Avatar colour resolution ───────────────────────────────────────────
//
// Avatar palette mirrors the design HTML. The key (computed server-side
// for sanitization) determines which gradient is shown. The 'anon' key
// renders the masked purple→sky gradient + 🕶 mask.

export type AvatarKey = 'anon' | 'a1' | 'a2' | 'a3' | 'a4' | 'a5' | 'a6';

export function avatarStyle(key: string): { background: string; color: string } {
  switch (key) {
    case 'anon': return { background: 'linear-gradient(135deg,#9B6BE3,#69B7F2)', color: '#fff' };
    case 'a1':   return { background: '#9B6BE3', color: '#fff' };
    case 'a2':   return { background: '#5BB85B', color: '#fff' };
    case 'a3':   return { background: '#E85C5C', color: '#fff' };
    case 'a4':   return { background: '#69B7F2', color: '#fff' };
    case 'a5':   return { background: '#FFC857', color: '#0F1F44' };
    case 'a6':   return { background: '#0F1F44', color: '#fff' };
    default:     return { background: '#9B6BE3', color: '#fff' };
  }
}
