// Kaya Module Guides — the data + tiny launcher behind the in-app "how it
// works" guides. A guide plays like a short video (auto-advancing scenes with
// optional voiceover) but is built from the live app, so it never goes stale.
//
// Homes (all powered by this one registry):
//   • KayaGuide FAB  → "▶ Show me how this works" for the current screen
//   • Videos module  → the browseable "Guides & Videos" library
//   • A ▶ pill on each module page
// Launch from anywhere with openModuleGuide(moduleId); GuideHost (mounted in
// the app layout) listens and renders the player.

export type GuideSceneVisual =
  | { kind: 'hero'; emoji: string }
  | { kind: 'flow'; steps: { emoji: string; label: string }[] }
  | { kind: 'grid'; items: { emoji: string; label: string }[] }
  | { kind: 'pair'; items: { emoji: string; label: string; sub: string }[] }
  | { kind: 'budget'; label: string; pct: number; note: string };

export interface GuideScene {
  visual: GuideSceneVisual;
  title: string;
  body: string;
  /** Optional role-aware override shown to helpers instead of `body`. */
  bodyHelper?: string;
}

export interface ModuleGuide {
  /** Stable id — used by openModuleGuide + the library + watched-state. */
  id: string;
  title: string;
  emoji: string;
  /** One-line description for the Videos library. */
  blurb: string;
  /** Route prefixes this guide is the "how it works" for (FAB matching). */
  paths: string[];
  /** End-of-guide hand-off — drops the user into the real screen. */
  ctaLabel?: string;
  ctaHref?: string;
  scenes: GuideScene[];
  /** false = shown in the library as "Coming soon" (no player yet). */
  available: boolean;
}

// ── Household ──────────────────────────────────────────────────────────────
const HOUSEHOLD_GUIDE: ModuleGuide = {
  id: 'household',
  title: 'Household',
  emoji: '🏡',
  blurb: 'Your family’s money out — log, approve, reconcile.',
  paths: ['/household', '/pantry'],
  ctaLabel: 'Open Purchases',
  ctaHref: '/pantry/purchase',
  available: true,
  scenes: [
    {
      visual: { kind: 'hero', emoji: '🏡' },
      title: 'Welcome to Household',
      body: 'This is where your family’s money out lives — calm, in one place. Every shilling that leaves the home, tracked.',
    },
    {
      visual: { kind: 'flow', steps: [
        { emoji: '✍️', label: 'Log' }, { emoji: '✅', label: 'Approve' }, { emoji: '📊', label: 'Done' },
      ] },
      title: 'One simple loop',
      body: 'Someone logs a spend, a parent taps yes, and it’s reconciled against your budget. Log, approve, done.',
      bodyHelper: 'You log a spend within your scope, a parent approves it, and it’s reconciled against the budget. Log, approve, done.',
    },
    {
      visual: { kind: 'grid', items: [
        { emoji: '🧾', label: 'Purchases' }, { emoji: '⚡', label: 'Utilities' }, { emoji: '🌿', label: 'Outdoor' },
        { emoji: '🚗', label: 'Drivers' }, { emoji: '🍽️', label: 'Dine Out' }, { emoji: '🛋️', label: 'Home' },
      ] },
      title: 'Everyday spending',
      body: 'Groceries, power and water, the garden, the car, eating out, the home itself — each has its own tidy place.',
    },
    {
      visual: { kind: 'pair', items: [
        { emoji: '🤝', label: 'Payroll', sub: 'Helpers request privately' },
        { emoji: '🤲', label: 'Contributions', sub: 'Gifts · tithe · msiba' },
      ] },
      title: 'People & giving',
      body: 'Payroll lets each helper request their own advance, privately. Contributions tracks gifts, tithe, msiba and charity.',
    },
    {
      visual: { kind: 'hero', emoji: '🔁' },
      title: 'Recurring, handled',
      body: 'Subscriptions remembers every repeating bill — apps, memberships, property dues — so you never miss or overpay one.',
    },
    {
      visual: { kind: 'budget', label: 'This month’s budget', pct: 62, note: 'on track ✅' },
      title: 'Stay on budget',
      body: 'Finances shows what’s left this month at a glance, so the family always knows if you’re on track.',
    },
    {
      visual: { kind: 'hero', emoji: '🎉' },
      title: 'You’re ready!',
      body: 'Best first step — open Purchases and log one thing you bought today. You’ll feel the loop in ten seconds.',
    },
  ],
};

// ── Registry ────────────────────────────────────────────────────────────────
// `available: false` entries appear in the library as "Coming soon" so the
// roadmap is visible without a player behind them yet.
export const MODULE_GUIDES: ModuleGuide[] = [
  HOUSEHOLD_GUIDE,
  { id: 'hive', title: 'The Hive', emoji: '🐝', blurb: 'Points → Honey → real cash.', paths: ['/hive'], scenes: [], available: false },
  { id: 'games', title: 'Kaya Games', emoji: '🎮', blurb: 'Play, earn House Points, stay safe.', paths: ['/games'], scenes: [], available: false },
  { id: 'wealth', title: 'Kaya Wealth', emoji: '💎', blurb: 'The family vault & investments.', paths: ['/wealth'], scenes: [], available: false },
];

export function getGuide(id: string | null | undefined): ModuleGuide | undefined {
  if (!id) return undefined;
  return MODULE_GUIDES.find((g) => g.id === id);
}

/** The guide whose module owns this route (for the FAB's contextual offer). */
export function guideForPath(pathname: string | null | undefined): ModuleGuide | undefined {
  if (!pathname) return undefined;
  return MODULE_GUIDES.find((g) => g.available && g.paths.some((p) => pathname === p || pathname.startsWith(p + '/')));
}

export const GUIDE_EVENT = 'kaya:open-guide';

/** Open a module guide from anywhere (the GuideHost in the app layout listens). */
export function openModuleGuide(id: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: { id } }));
}

// ── Watched state (Phase 1: local to the device; Firestore sync is a
//    fast-follow so the ✓ travels across devices) ──────────────────────────
const WATCHED_KEY = 'kaya:guidesWatched';
export function markGuideWatched(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    const set = new Set<string>(JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]'));
    set.add(id);
    localStorage.setItem(WATCHED_KEY, JSON.stringify([...set]));
  } catch { /* storage blocked — watched state is non-critical */ }
}
export function isGuideWatched(id: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return (JSON.parse(localStorage.getItem(WATCHED_KEY) || '[]') as string[]).includes(id);
  } catch { return false; }
}
