// Canonical list of modules a helper can be granted access to. Lives
// separately from `lib/kidModules.ts` because the helper vocabulary is
// different from the kid sidebar:
//
//   - Helpers don't have a "Home" module — /helper IS their home, and
//     it's always reachable. Kid-home (`/kid`) is irrelevant to them.
//   - Helpers DO have a "Kaya" module — the routine + award + meeting
//     surface that kids never see (parent-facing in the original IA).
//     Re-mapped here so a parent can grant a tutor access only to the
//     Kaya pieces without bundling the whole household.
//   - Modules that exist for kids but are out of scope for helpers
//     (Discover, Badges, Rewards-as-kid-page) are omitted.
//
// Each module has an optional `subModules` array. Sub-grants are stored
// as composite keys "{parent}:{sub}" in HelperLink.moduleAccess; a bare
// parent key means "everything inside this module" (act tier propagates
// to all subs in rule checks). UI renders parent + indented sub cards.

export type HelperModuleTier = 'active' | 'soon' | 'legacy';

export interface HelperSubModule {
  id: string;        // unique within parent — composite key is "{parent}:{id}"
  label: string;
  icon: string;
  /** Path prefix(es) under this sub. Used by AppShell to decide which
   *  sub a navigated path falls under. Optional — modules without
   *  routes (e.g. "Rewards" inside Kaya) skip it. */
  paths?: string[];
}

export interface HelperModule {
  id: string;        // moduleAccess key for the bare parent grant
  label: string;
  icon: string;
  tier: HelperModuleTier;
  subModules?: HelperSubModule[];
  /** True for modules unique to the helper context (Kaya, Profiles). */
  helperOnly?: boolean;
}

export const HELPER_MODULES: HelperModule[] = [
  {
    id: 'kaya',
    label: 'Kaya',
    icon: '🏛️',
    tier: 'active',
    helperOnly: true,
    subModules: [
      { id: 'rate',     label: 'Rate routines', icon: '📋', paths: ['/rate'] },
      { id: 'award',    label: 'Award points',  icon: '🎖️', paths: ['/award'] },
      { id: 'meetings', label: 'Meetings',      icon: '👨‍👩‍👧‍👦', paths: ['/meetings'] },
      { id: 'rewards',  label: 'Rewards',       icon: '🎁', paths: ['/rewards'] },
    ],
  },
  {
    id: 'household',
    label: 'Household',
    icon: '🏡',
    tier: 'active',
    subModules: [
      { id: 'meals',     label: 'Meals',         icon: '🍽️', paths: ['/pantry/meals'] },
      { id: 'list',      label: 'Shopping list', icon: '🛒', paths: ['/pantry/list'] },
      { id: 'staples',   label: 'Staples',       icon: '🥫', paths: ['/pantry/staples'] },
      { id: 'suppliers', label: 'Suppliers',     icon: '🚚', paths: ['/pantry/suppliers'] },
      { id: 'directory', label: 'Contacts',      icon: '📞', paths: ['/pantry/directory'] },
      { id: 'utilities', label: 'Utilities',     icon: '💡', paths: ['/pantry/utilities'] },
      { id: 'budget',    label: 'Budget',        icon: '💰', paths: ['/pantry/budget'] },
      // Purchase v1 — the request → approve → reconcile loop on Pantry.
      { id: 'purchase',  label: 'Purchase',      icon: '🧾', paths: ['/pantry/purchase'] },
      // Outdoor — same loop on garden / pool / kuku / pets / repairs / vehicle.
      { id: 'outdoor',   label: 'Outdoor',       icon: '🌿', paths: ['/pantry/outdoor'] },
    ],
  },
  { id: 'moments',  label: 'Moments',        icon: '📸', tier: 'active' },
  { id: 'hive',     label: 'The Hive',       icon: '🍯', tier: 'active' },
  { id: 'business', label: 'Kaya Business',  icon: '💼', tier: 'active' },
  { id: 'profiles', label: 'Kid profiles',   icon: '👧', tier: 'active', helperOnly: true },
  { id: 'fun',      label: 'Fun',            icon: '🎮', tier: 'active' },
  { id: 'wealth',   label: 'Kaya Wealth',    icon: '💎', tier: 'soon' },
  { id: 'wellness', label: 'Kaya Wellness',  icon: '🧘', tier: 'soon' },
  { id: 'chef',     label: 'Kaya Chef',      icon: '🍳', tier: 'soon' },
];

/** Flat lookup table for any module key (parent OR composite). */
export const HELPER_MODULE_KEY_LABEL: Record<string, { label: string; icon: string }> = (() => {
  const out: Record<string, { label: string; icon: string }> = {};
  for (const m of HELPER_MODULES) {
    out[m.id] = { label: m.label, icon: m.icon };
    if (m.subModules) {
      for (const s of m.subModules) {
        out[`${m.id}:${s.id}`] = { label: s.label, icon: s.icon };
      }
    }
  }
  return out;
})();

/** All composite + parent keys (used by helpers.ts to build presets). */
export function allHelperModuleKeys(): string[] {
  const out: string[] = [];
  for (const m of HELPER_MODULES) {
    if (m.subModules) {
      for (const s of m.subModules) out.push(`${m.id}:${s.id}`);
    } else {
      out.push(m.id);
    }
  }
  return out;
}

/** Map a route pathname to the most-specific helper module key that
 *  gates it, or undefined when the route isn't helper-module-gated.
 *  Used by AppShell for route guarding + nav filtering. */
export function helperModuleKeyForPath(pathname: string): string | undefined {
  // First pass — try sub-module path matches (most specific).
  for (const m of HELPER_MODULES) {
    if (!m.subModules) continue;
    for (const s of m.subModules) {
      if (!s.paths) continue;
      for (const p of s.paths) {
        if (pathname === p || pathname.startsWith(p + '/')) {
          return `${m.id}:${s.id}`;
        }
      }
    }
  }
  // Second pass — bare module paths (e.g. /pantry → household,
  // /moments → moments). Kept as a fallback so a helper granted just
  // the parent still navigates correctly.
  const FLAT_PATH_TO_MODULE: Record<string, string> = {
    '/moments': 'moments',
    '/pantry':  'household',
    '/hive':    'hive',
    '/business': 'business',
    '/directory': 'household:directory',
    '/profiles': 'profiles',
    '/videos':  'fun',
    '/games':   'fun',
    '/wealth':  'wealth',
    '/wellness': 'wellness',
    '/chef':    'chef',
  };
  for (const [path, mod] of Object.entries(FLAT_PATH_TO_MODULE)) {
    if (pathname === path || pathname.startsWith(path + '/')) return mod;
  }
  return undefined;
}
