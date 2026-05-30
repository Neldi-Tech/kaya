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
  | 'letter'            // Family Letter (stub)
  | 'myday'             // My Day — daily landing surface (added 2026-05-28)
  | 'messages'          // Family chat (added 2026-05-28)
  | 'pulse'             // Kaya Pulse — utilities + finances (added 2026-05-28)
  | 'workplan'          // Kids' Workplan editor (added 2026-05-28)
  | 'directory'         // Family + supplier contacts (added 2026-05-28)
  | 'stats'             // Reports / kid profiles / family tree (added 2026-05-28)
  | 'sparks';           // Kaya Sparks — kids education (added 2026-05-27,
                        //   reusing the freed ID slot from the buzz rename;
                        //   completely different feature: school projects,
                        //   home projects, achievements, academic, sports)

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
  { id: 'kaya-core', name: 'Kaya (core)',       emoji: '🏆', description: 'Chores, points, houses · rate, award, meetings, rewards', shipped: true,  routePrefix: '/home' },
  { id: 'myday',     name: 'My Day',            emoji: '🌟', description: 'Personal daily landing — your rate/award/messages all in one', shipped: true,  routePrefix: '/my-day' },
  { id: 'moments',   name: 'Moments',           emoji: '📷', description: 'Daily family feed of photos + memories', shipped: true,  routePrefix: '/moments' },
  { id: 'messages',  name: 'Messages',          emoji: '💬', description: 'In-app family chat (parents · helpers · kids)', shipped: true,  routePrefix: '/messages' },
  { id: 'workplan',  name: 'Kids’ Workplan', emoji: '🗓️', description: 'Per-kid workplan editor + day-of schedule', shipped: true,  routePrefix: '/workplan' },
  { id: 'buzz',      name: 'Kaya Buzz',         emoji: '🐝', description: 'Ideas & help community',         shipped: true,  routePrefix: '/buzz' },
  { id: 'sparks',    name: 'Kaya Sparks',       emoji: '✨', description: "Kids' education — projects, achievements, academic, sports", shipped: true,  routePrefix: '/sparks' },
  { id: 'fun',       name: 'Fun',               emoji: '🎉', description: 'Joy-only, no points — videos + games', shipped: true,  routePrefix: '/games' },
  { id: 'directory', name: 'Directory',         emoji: '📞', description: 'Family + supplier contact directory', shipped: true,  routePrefix: '/directory' },
  { id: 'stats',     name: 'Stats',             emoji: '📊', description: 'Reports · kid profiles · family tree (read-only roll-ups)', shipped: true,  routePrefix: '/reports' },
  { id: 'hive',      name: 'The Hive',          emoji: '🍯', description: 'Honey Coins & vault',            shipped: true,  routePrefix: '/hive' },
  { id: 'household', name: 'Household',         emoji: '🏡', description: 'Pantry, utilities, helpers, payroll', shipped: true,  routePrefix: '/pantry' },
  { id: 'pulse',     name: 'Kaya Pulse',        emoji: '📈', description: 'Daily readings · finances · run-rate advisory', shipped: true,  routePrefix: '/pulse' },
  { id: 'pages',     name: 'Pages',             emoji: '📇', description: 'Family smart address book',      shipped: false },
  { id: 'dreams',    name: 'Kaya Dreams',       emoji: '🌟', description: 'Milestone tracking',             shipped: false },
  { id: 'business',  name: 'Kaya Business',     emoji: '🐝', description: 'Kid micro-enterprises',          shipped: true,  routePrefix: '/business' },
  { id: 'wealth',    name: 'Kaya Wealth',       emoji: '💎', description: 'Asset & property registry',      shipped: true,  routePrefix: '/wealth' },
  { id: 'chef',      name: 'Kaya Chef',         emoji: '🥗', description: 'Recipes, meal planning',         shipped: true,  routePrefix: '/chef' },
  { id: 'wellness',  name: 'Kaya Wellness',     emoji: '🌱', description: 'Sleep, screen time, mindful',    shipped: true,  routePrefix: '/wellness' },
  { id: 'grow',      name: 'Kaya Grow',         emoji: '📚', description: 'Skill tracks & learning',        shipped: false },
  { id: 'analytics', name: 'Advanced analytics',emoji: '📊', description: 'Trends, exports, multi-year roll-ups', shipped: false },
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
  /** Base Firebase Storage cap, in GIGABYTES. The effective cap a
   *  family sees is `storageGB + family.storage.extraGB` (operator-
   *  granted top-up). Nest = 0.2 GB (200 MB), Home = 2 GB,
   *  Castle = 50 GB. NOT shown to users for Castle (UI says
   *  "Plenty of room" instead). */
  storageGB: number;
  /** Module IDs included BY DEFAULT in this tier (i.e. without an
   *  add-on). For Castle this is every module. For Home this is the
   *  "always included" set; add-ons unlock more. */
  modules: ModuleId[];
  /** Module IDs offered AS PAID ADD-ONS for this tier (only Home today).
   *  Showing a coral "Add-on" chip next to the checkbox in the matrix. */
  addonModules: ModuleId[];
  isFeatured: boolean;
  /** Stripe objects for the paid funnel (PR 4-Pay). Populated by
   *  scripts/stripe-provision.ts and persisted at /config/tiers/{tierId};
   *  absent for Nest (free) and before provisioning has run. */
  stripeProductId?: string;
  stripePriceIdMonthly?: string;
  stripePriceIdYearly?: string;
}

const FREE = 0;
// Monthly is the base rate; annual billing is ~30% cheaper per month
// (set 2026-05-30 — was 2-months-free / 17% before). Per-month shown on
// the yearly toggle = priceYearly / 12:
//   Home   $7.20/mo → $60/yr  = $5.00/mo  (31% off monthly)
//   Castle $16.80/mo → $144/yr = $12.00/mo (29% off monthly)
// NOTE: these are DISPLAY prices only. The actual charge uses the Stripe
// Price IDs (stripePriceIdYearly), provisioned separately by
// scripts/stripe-provision.ts — reprovision them to match before the paid
// funnel charges anyone on annual, else display ($60) ≠ charge ($72).
const HOME_MONTHLY = 720;
const HOME_YEARLY  = 6000;
const CASTLE_MONTHLY = 1680;
const CASTLE_YEARLY  = 14400;

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
    storageGB: 0.2,
    // Sparks Lite is included in Nest — the strongest hook module per the
    // spec ("keep Lite generous so families fall in love"). Feature-level
    // gating (no AI scan, 50-item cap, 30-day ratings history, 1 kid) is
    // enforced in `lib/sparks/gating.ts`, not by withholding the module.
    // Daily-life modules (My Day, Messages, Workplan, Directory) are
    // ALWAYS in Nest — withholding the basics would break the product.
    modules: [
      'kaya-core', 'myday', 'moments', 'messages', 'workplan',
      'fun', 'directory', 'buzz', 'sparks',
    ],
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
    storageGB: 2,
    // Home families get Sparks Family by default — full AI scanning,
    // pre-submission highlights, unlimited items, ≤5 kids, dashboard,
    // PDF export. Castle gets it implicitly (MODULE_REGISTRY.map below).
    // Home adds the premium parent surfaces on top of Nest: The Hive
    // (Honey Coins), Household (pantry/utilities/payroll), Pulse
    // (finances dashboard), and Stats (reports + roll-ups).
    modules: [
      // Everything in Nest
      'kaya-core', 'myday', 'moments', 'messages', 'workplan',
      'fun', 'directory', 'buzz', 'sparks',
      // Home premium adds
      'hive', 'household', 'pulse', 'stats', 'pages', 'dreams',
    ],
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
    storageGB: 50,
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

/** Per-add-on admin override, persisted at /config/addons as a map
 *  { [addonId]: AddonOverride }. `priceMonthly` overrides the catalogue
 *  price; `released:false` hides a shipped add-on as "Coming soon". */
export interface AddonOverride {
  priceMonthly?: number;
  released?: boolean;
  /** Stripe Price ID for self-serve checkout (set after provisioning).
   *  Without it the add-on can't be charged — Stripe mode falls back to
   *  the request flow. */
  stripePriceId?: string;
}
export type AddonOverrides = Record<string, AddonOverride>;

/** An add-on with the admin price override applied, `released` resolved, and
 *  `purchasable` = released AND a Stripe Price is provisioned (self-serve). */
export interface ResolvedAddon extends AddonConfig {
  released: boolean;
  purchasable: boolean;
}

/** Whether the add-on's underlying module has shipped (has real code). The
 *  admin can only toggle availability for shipped add-ons. */
export function addonModuleShipped(addon: AddonConfig): boolean {
  return MODULE_REGISTRY.find((m) => m.id === addon.moduleId)?.shipped === true;
}

/** Whether an add-on is released (purchasable). Requires its module to have
 *  SHIPPED (no code = nothing to sell) AND the admin not to have hidden it
 *  (override.released === false). Unreleased add-ons render "Coming soon"
 *  and can never be selected, requested, or charged — enforced on the server
 *  too (see /api/upgrade-requests). An unshipped module can NEVER be forced
 *  released from admin — we won't sell a feature that doesn't exist. */
export function isAddonReleased(addon: AddonConfig, overrides?: AddonOverrides): boolean {
  return addonModuleShipped(addon) && overrides?.[addon.id]?.released !== false;
}

/** DEFAULT_ADDONS with admin price overrides applied + `released` resolved. */
export function mergedAddons(overrides?: AddonOverrides): ResolvedAddon[] {
  return DEFAULT_ADDONS.map((a) => {
    const o = overrides?.[a.id];
    const priceMonthly = typeof o?.priceMonthly === 'number' && o.priceMonthly >= 0
      ? Math.round(o.priceMonthly)
      : a.priceMonthly;
    const released = isAddonReleased(a, overrides);
    return { ...a, priceMonthly, released, purchasable: released && !!o?.stripePriceId };
  });
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
