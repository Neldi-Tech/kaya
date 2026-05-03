// Catalog of ways kids can earn points. Families pick up to 3 active methods
// (free tier); the rest are visible as "Coming soon" or "Pro" but not
// selectable yet.
//
// `status: 'active'` methods are wired into Phase 1 today. `status: 'soon'`
// methods are shown for transparency about the roadmap but can't be turned on.
// `tier: 'pro'` methods sit behind the paid plan.

export type EarningStatus = 'active' | 'soon';
export type EarningTier = 'free' | 'pro';

export interface EarningMethod {
  id: string;
  title: string;
  description: string;
  emoji: string;
  status: EarningStatus;
  tier: EarningTier;
}

// IDs are stable strings persisted on the Family document — don't rename
// existing entries; add new ones instead.
export const EARNING_METHODS: EarningMethod[] = [
  // ── Free tier · already wired ─────────────────────────────────────
  {
    id: 'routines',
    title: 'Daily routines',
    description: 'Rate the morning and evening routines — points flow from how well each task went.',
    emoji: '📋',
    status: 'active',
    tier: 'free',
  },
  {
    id: 'awards',
    title: 'Bonus awards',
    description: 'Catch a kindness in the moment. Parents and helpers can award bonus points for kindness, helping, bravery, learning…',
    emoji: '🎖️',
    status: 'active',
    tier: 'free',
  },
  {
    id: 'diamond',
    title: 'Diamond points',
    description: 'Parent-only escalation for exceptional behaviour — 3 to 10 high-value points reserved for the big moments.',
    emoji: '💎',
    status: 'active',
    tier: 'free',
  },

  // ── Free tier · roadmap ───────────────────────────────────────────
  {
    id: 'streaks',
    title: 'Streak bonuses',
    description: 'Auto-bonus points when a kid hits a 3, 7 or 30-day routine streak.',
    emoji: '🔥',
    status: 'soon',
    tier: 'free',
  },
  {
    id: 'peer-kindness',
    title: 'Peer kindness',
    description: 'Kids nominate each other for kind acts. The family confirms 1–2 nominations at the weekly meeting.',
    emoji: '💝',
    status: 'soon',
    tier: 'free',
  },
  {
    id: 'reading',
    title: 'Reading minutes',
    description: 'Log time spent reading — converts to points at a family-set rate.',
    emoji: '📚',
    status: 'soon',
    tier: 'free',
  },

  // ── Pro tier · paid ───────────────────────────────────────────────
  {
    id: 'enterprise',
    title: 'Family micro-enterprise',
    description: 'Track a family business — chickens, orchard, passion fruits — and pay points by output.',
    emoji: '💼',
    status: 'soon',
    tier: 'pro',
  },
  {
    id: 'helper-hours',
    title: 'Helper hours',
    description: 'Time-tracked helper-completed chores. Minutes logged → points earned.',
    emoji: '⏱️',
    status: 'soon',
    tier: 'pro',
  },
  {
    id: 'custom-rules',
    title: 'Custom rules',
    description: 'Define your own earning conditions — "first to read 30 minutes", "Saturday cleanup squad", anything.',
    emoji: '🛠️',
    status: 'soon',
    tier: 'pro',
  },
];

// How many "active" methods a free family can run at once.
export const FREE_EARNING_METHOD_LIMIT = 3;

// What every family starts with (matches the Phase 1 default behaviour). Used
// when a family has no `earningMethods` field yet — Firestore docs created
// before this feature shipped show the same UX as before.
export const DEFAULT_EARNING_METHODS = ['routines', 'awards', 'diamond'];

export function isMethodSelectable(method: EarningMethod): boolean {
  return method.status === 'active' && method.tier === 'free';
}
