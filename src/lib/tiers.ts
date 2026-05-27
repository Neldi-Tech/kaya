// Kaya Tiers — subscription plans + module gating.
//
// The 15-module matrix lives here. Defaults mirror the design HTML
// (Kaya_Buzz-and-Tiers_Design_2026-05-26.html). Persisted at
// /config/tiers/{tierId} so an admin can tweak access from the Admin
// Portal without a code deploy; the defaults are the fallback when the
// doc is missing.
//
// NAMESPACE — distinct from `referral.ts` `TIERS` (referral perks:
// Friend / Tribe / Champion). Subscription tiers are called "plans"
// throughout the API surface (`SubscriptionTierId`, `PlanConfig`,
// `subscriptionTier`) to keep the two systems orthogonal.

export type SubscriptionTierId = 'nest' | 'home' | 'castle';

/** Canonical module IDs that gate access in the matrix. NEVER rename —
 *  these are persisted on /config/tiers/{tierId}.modules arrays. Add
 *  new IDs at the bottom only. Some IDs are stubs (no route yet); the
 *  matrix shows them so an admin can pre-flip access before the
 *  module ships. See `MODULE_REGISTRY` below for shipped vs planned. */
export type ModuleId =
  | 'kaya-core'         // Core points/chores/houses
  | 'moments'           // Daily family feed
  | 'fun'               // Joy-only games / videos
  | 'buzz'              // Ideas & help (renamed from 'sparks' 2026-05-27)
  | 'hive'              // The Hive — Honey Coins + vault
  | 'household'         // Pantry / Utilities / Helpers
  | 'pages'             // Family address book (stub)
  | 'dreams'            // Milestone tracking (stub)
  | 'business'          // Kaya Business
  | 'wealth'            // Kaya Wealth
  | 'chef'              // Kaya Chef
  | 'wellness'          // Kaya Wellness
  | 'grow'              // Kaya Grow (stub)
  | 'analytics'         // Advanced analytics (stub)
  | 'letter';           // Family Letter (stub)

export interface ModuleMeta {
  id: ModuleId;
  name: string;
  emoji: string;
  description: string;
  /** True when the module has a route in this build. False = stub for
   *  the matrix; toggling does nothing user-visible until the module
   *  ships. PR 3 wires gating only against shipped modules. */
  shipped: boolean;
  /** Existing route prefix the gate should wrap, if shipped. */
  routePrefix?: string;
}

export const MODULE_REGISTRY: ModuleMeta[] = [
  { id: 'kaya-core', name: 'Kaya (core)',       emoji: '🏆', description: 'Chores, points, houses',         shipped: true,  routePrefix: '/home' },
  { id: 'moments',   name: 'Moments',           emoji: '📷', description: 'Daily family feed',              shipped: true,  routePrefix: '/moments' },
  { id: 'fun',       name: 'Fun',               emoji: '🎉', description: 'Joy-only, no points',            shipped: true,  routePrefix: '/games' },
  { id: 'buzz',      name: 'Kaya Buzz',         emoji: '🐝', description: 'Ideas & help community',         shipped: true,  routePrefix: '/buzz' },
  { id: 'hive',      name: 'The Hive',          emoji: '🍯', description: 'Honey Coins & vault',            shipped: true,  routePrefix: '/hive' },
  { id: 'household', name: 'Household',         emoji: '🏡', description: 'Pantry, utilities, helpers',     shipped: true,  routePrefix: '/pantry' },
  { id: 'pages',     name: 'Pages',             emoji: '📇', description: 'Family smart address book',      shipped: false },
  { id: 'dreams',    name: 'Kaya Dreams',       emoji: '🌟', description: 'Milestone tracking',             shipped: false },
  { id: 'business',  name: 'Kaya Business',     emoji: '🐝', description: 'Kid micro-enterprises',          shipped: true,  routePrefix: '/business' },
  { id: 'wealth',    name: 'Kaya Wealth',       emoji: '💎', description: 'Asset & property registry',      shipped: true,  routePrefix: '/wealth' },
  { id: 'chef',      name: 'Kaya Chef',         emoji: '🥗', description: 'Recipes, meal planning',         shipped: true,  routePrefix: '/chef' },
  { id: 'wellness',  name: 'Kaya Wellness',     emoji: '🌱', description: 'Sleep, screen time, mindful',    shipped: true,  routePrefix: '/wellness' },
  { id: 'grow',      name: 'Kaya Grow',         emoji: '📚', description: 'Skill tracks & learning',        shipped: false },
  { id: 'analytics', name: 'Advanced analytics',emoji: '📊', description: 'Stats, trends, exports',         shipped: false },
  { id: 'letter',    name: 'Family Letter',     emoji: '📜', description: 'Monthly recap newsletter',       shipped: false },
];

// ── Tier configs ─────────────────────────────────────────────────────

export interface TierConfig {
  id: SubscriptionTierId;
  name: string;
  tagline: string;
  emoji: string;
  /** USD cents, monthly billing. */
  priceMonthly: number;
  /** USD cents, billed annually (per-month displayed = priceYearly/12). */
  priceYearly: number;
  memberLimit: number | null;        // null = unlimited
  helperLimit: number | null;
  householdLimit: number | null;
  historyRetentionDays: number | null;
  /** Module IDs included BY DEFAULT in this tier (i.e. without an
   *  add-on). For Castle this is every module. For Home this is the
   *  "always included" set; add-ons unlock more. */
  modules: ModuleId[];
  /** Module IDs offered AS PAID ADD-ONS for this tier (only Home today).
   *  Showing a coral "Add-on" chip next to the checkbox in the matrix. */
  addonModules: ModuleId[];
  isFeatured: boolean;
}

const FREE = 0;
// $6/mo billed yearly = $72/yr = 7200 cents. Monthly billing is +20% per
// the spec so monthly tier shows $7.20 ≈ 720 cents.
const HOME_MONTHLY = 720;
const HOME_YEARLY  = 7200;
const CASTLE_MONTHLY = 1680;
const CASTLE_YEARLY  = 16800;

export const DEFAULT_TIERS: Record<SubscriptionTierId, TierConfig> = {
  nest: {
    id: 'nest',
    name: 'Kaya Nest',
    tagline: 'Free forever',
    emoji: '🏡',
    priceMonthly: FREE,
    priceYearly: FREE,
    memberLimit: 4,
    helperLimit: 1,
    householdLimit: 1,
    historyRetentionDays: 30,
    modules: ['kaya-core', 'moments', 'fun', 'buzz'],
    addonModules: [],
    isFeatured: false,
  },
  home: {
    id: 'home',
    name: 'Kaya Home',
    tagline: 'Family plan',
    emoji: '🏠',
    priceMonthly: HOME_MONTHLY,
    priceYearly: HOME_YEARLY,
    memberLimit: 8,
    helperLimit: 3,
    householdLimit: 2,
    historyRetentionDays: 365,
    modules: ['kaya-core', 'moments', 'fun', 'buzz', 'hive', 'household', 'pages', 'dreams'],
    addonModules: ['business', 'wealth', 'chef', 'wellness', 'grow', 'letter'],
    isFeatured: true,
  },
  castle: {
    id: 'castle',
    name: 'Kaya Castle',
    tagline: 'Everything Kaya',
    emoji: '🏰',
    priceMonthly: CASTLE_MONTHLY,
    priceYearly: CASTLE_YEARLY,
    memberLimit: null,
    helperLimit: null,
    householdLimit: null,
    historyRetentionDays: null,
    modules: MODULE_REGISTRY.map((m) => m.id),
    addonModules: [],
    isFeatured: false,
  },
};

// ── Add-on catalogue ─────────────────────────────────────────────────

export interface AddonConfig {
  id: string;
  name: string;
  emoji: string;
  emojiBg: string;
  emojiFg: string;
  description: string;
  /** USD cents per month. */
  priceMonthly: number;
  /** Module unlocked when this add-on is active. */
  moduleId: ModuleId;
  /** Which tier IDs can buy this add-on. */
  eligibleTiers: SubscriptionTierId[];
}

export const DEFAULT_ADDONS: AddonConfig[] = [
  { id: 'business',  name: 'Kaya Business',    emoji: '🐝', emojiBg: '#FFE8E5', emojiFg: '#E85C5C', description: 'Kids run real micro-enterprises (orchard, eggs, crafts).', priceMonthly: 300, moduleId: 'business', eligibleTiers: ['home'] },
  { id: 'wealth',    name: 'Kaya Wealth',      emoji: '💎', emojiBg: '#FFF4D6', emojiFg: '#B8860B', description: 'Family asset & property registry with access controls.', priceMonthly: 400, moduleId: 'wealth',   eligibleTiers: ['home'] },
  { id: 'chef',      name: 'Kaya Chef',        emoji: '🥗', emojiBg: '#E5F7EF', emojiFg: '#5BB85B', description: 'Recipes, meal plans, cook-alongs.',                       priceMonthly: 200, moduleId: 'chef',     eligibleTiers: ['home'] },
  { id: 'wellness',  name: 'Kaya Wellness',    emoji: '🌱', emojiBg: '#F0E8FB', emojiFg: '#9B6BE3', description: 'Sleep, screen time, mindfulness routines.',                priceMonthly: 200, moduleId: 'wellness', eligibleTiers: ['home'] },
  { id: 'grow',      name: 'Kaya Grow',        emoji: '📚', emojiBg: '#E2F0FF', emojiFg: '#1F6FB8', description: 'Skill tracks & learning ladders.',                         priceMonthly: 200, moduleId: 'grow',     eligibleTiers: ['home'] },
  { id: 'honey',     name: 'Honey Coin Boost', emoji: '🍯', emojiBg: '#FFE8E5', emojiFg: '#E85C5C', description: 'Higher savings caps + bonus exchange rates.',              priceMonthly: 200, moduleId: 'hive',     eligibleTiers: ['home'] },
  { id: 'helpers',   name: 'Extra Helpers',    emoji: '👥', emojiBg: '#E5F7EF', emojiFg: '#5BB85B', description: '+5 helper slots (nannies, tutors, grandparents).',          priceMonthly: 100, moduleId: 'household',eligibleTiers: ['home'] },
  { id: 'letter',    name: 'Family Letter',    emoji: '📜', emojiBg: '#FFF4D6', emojiFg: '#B8860B', description: 'Monthly recap newsletter, printable + shareable.',          priceMonthly: 100, moduleId: 'letter',   eligibleTiers: ['home'] },
];

// ── Tier access resolver ─────────────────────────────────────────────
//
// PURE function — given a family's `tierId` + their active `addons` list
// + the persisted tier configs (from /config/tiers/{tierId} or the
// defaults), return the resolved set of moduleIds they have access to.
// Used by the `useTierAccess()` hook (PR 3) and by API gates.

export function resolveModuleAccess(
  tierId: SubscriptionTierId | undefined,
  activeAddons: string[],
  tierOverrides?: Partial<Record<SubscriptionTierId, Partial<TierConfig>>>,
): Set<ModuleId> {
  const resolvedTier: SubscriptionTierId = tierId ?? 'nest';
  const base = mergedTierConfig(resolvedTier, tierOverrides);
  const granted = new Set<ModuleId>(base.modules);
  // Castle implicitly includes everything; don't bother checking addons.
  if (resolvedTier === 'castle') {
    for (const m of MODULE_REGISTRY) granted.add(m.id);
    return granted;
  }
  for (const addonId of activeAddons) {
    const addon = DEFAULT_ADDONS.find((a) => a.id === addonId);
    if (!addon) continue;
    if (!addon.eligibleTiers.includes(resolvedTier)) continue;
    granted.add(addon.moduleId);
  }
  return granted;
}

/** Returns the effective tier config — defaults overridden by anything
 *  the admin set at /config/tiers/{tierId}. Caller-supplied
 *  `tierOverrides` map mirrors the on-doc shape. */
export function mergedTierConfig(
  tierId: SubscriptionTierId,
  tierOverrides?: Partial<Record<SubscriptionTierId, Partial<TierConfig>>>,
): TierConfig {
  const base = DEFAULT_TIERS[tierId];
  const patch = tierOverrides?.[tierId];
  if (!patch) return base;
  return {
    ...base,
    ...patch,
    modules: patch.modules ?? base.modules,
    addonModules: patch.addonModules ?? base.addonModules,
  };
}

/** True if Home offers this module as a paid add-on (used by the
 *  matrix to render the coral "Add-on" chip on the Home column). */
export function isHomeAddonModule(moduleId: ModuleId, tierOverrides?: Partial<Record<SubscriptionTierId, Partial<TierConfig>>>): boolean {
  const cfg = mergedTierConfig('home', tierOverrides);
  return cfg.addonModules.includes(moduleId);
}
