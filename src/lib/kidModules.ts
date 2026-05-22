// Canonical list of modules that can appear in a kid's nav. Parents
// pick which ones their kids see via Settings → "What kids see"; the
// selection is persisted on `Family.kidModules`. Modules not in the
// granted set are dropped from the kid sidebar, the mobile bottom bar,
// and the More sheet — and kid visits to their routes are bounced to
// the kid Home page.
//
// IDs are stable strings persisted on the Family document — don't
// rename existing entries; add new ones instead.

/** A sub-page beneath a top-level module that parents can grant
 *  independently. Composite id "{parent}:{sub}" lives in
 *  `Family.kidModules` and is returned by `moduleIdForPath` for any
 *  matching route. Granting a sub auto-implies the parent (see
 *  `resolveKidModules`) so nav stays consistent. */
export interface KidSubModule {
  id: string;          // unique within parent — e.g. 'meals'
  label: string;
  icon: string;
  path: string;
  extraPaths?: string[];
}

export interface KidModule {
  id: string;
  label: string;
  icon: string;
  /** Primary route the toggle controls. */
  path: string;
  /** Additional path prefixes that should also be gated under this id
   *  (e.g. Fun → /videos AND /games). */
  extraPaths?: string[];
  /** Phased-out modules (Discover/Badges/Rewards) — shown in Settings
   *  so families can re-enable them, but OFF by default. */
  isLegacy?: boolean;
  /** Not toggleable — always granted. Only `home` today. */
  alwaysOn?: boolean;
  /** Route exists as a teaser only; render a SOON pill in nav. */
  soon?: boolean;
  /** Optional nested toggles for sub-pages. Each sub gets its own
   *  granted bit (composite id "{parent}:{sub}"). When a parent has
   *  subs, kids see the parent link unconditionally if the parent is
   *  granted, but each sub-route checks its own grant. */
  subModules?: KidSubModule[];
}

export const KID_MODULES: KidModule[] = [
  { id: 'home',      label: 'Home',           icon: '🏠', path: '/kid', alwaysOn: true },
  { id: 'moments',   label: 'Moments',        icon: '📸', path: '/moments' },
  {
    // Kaya · the point system. Parent surface lives in /rate /award
    // /meetings /rewards; the kid surface is a view-only roll-up of
    // their own scores + badges. Exposing Kaya as a top-level toggle
    // lets parents (a) hide point-system surface from a kid who
    // doesn't engage with it, and (b) light up Kaya in the helper
    // access cards (no more "family disabled" badge there for
    // families that have Kaya on). Sub-pages mirror the helper-side
    // map so the two views stay symmetric.
    id: 'kaya', label: 'Kaya', icon: '🏛️', path: '/kid',
    subModules: [
      { id: 'rate',     label: 'Rate routines', icon: '📋', path: '/rate' },
      { id: 'award',    label: 'Award points',  icon: '🎖️', path: '/award' },
      { id: 'meetings', label: 'Meetings',      icon: '👨‍👩‍👧‍👦', path: '/meetings' },
      { id: 'rewards',  label: 'Rewards',       icon: '🎁', path: '/rewards' },
    ],
  },
  {
    id: 'household', label: 'Household', icon: '🏡', path: '/pantry',
    subModules: [
      { id: 'meals',     label: 'Meals',         icon: '🍽️', path: '/pantry/meals' },
      { id: 'list',      label: 'Shopping list', icon: '🛒', path: '/pantry/list' },
      { id: 'staples',   label: 'Staples',       icon: '🥫', path: '/pantry/staples' },
      { id: 'suppliers', label: 'Suppliers',     icon: '🚚', path: '/pantry/suppliers' },
      { id: 'directory', label: 'Contacts',      icon: '📞', path: '/pantry/directory' },
      { id: 'utilities', label: 'Utilities',     icon: '💡', path: '/pantry/utilities' },
      { id: 'budget',    label: 'Budget',        icon: '💰', path: '/pantry/budget' },
    ],
  },
  { id: 'hive',      label: 'The Hive',       icon: '🍯', path: '/hive' },
  { id: 'business',  label: 'Kaya Business',  icon: '💼', path: '/business' },
  { id: 'directory', label: 'Directory',      icon: '📞', path: '/directory' },
  { id: 'fun',       label: 'Fun',            icon: '🎮', path: '/videos', extraPaths: ['/games'] },
  { id: 'wealth',    label: 'Kaya Wealth',    icon: '💎', path: '/wealth',   soon: true },
  { id: 'wellness',  label: 'Kaya Wellness',  icon: '🧘', path: '/wellness', soon: true },
  { id: 'chef',      label: 'Kaya Chef',      icon: '🍳', path: '/chef',     soon: true },
  // Stats — Reports / Kid profiles / Family tree. Defined WITHOUT
  // subModules (extraPaths instead) so all three pages gate on the
  // single top-level `stats` id — granting `stats` unlocks the whole
  // section without per-page sub-grants.
  { id: 'stats',     label: 'Stats',          icon: '📊', path: '/reports', extraPaths: ['/profiles', '/family-tree'] },
  // ── Phased-out (OFF by default) ───────────────────────────────────
  { id: 'discover',  label: 'Discover',       icon: '🔎', path: '/',        isLegacy: true },
  { id: 'badges',    label: 'Badges',         icon: '🏆', path: '/badges',  isLegacy: true },
  { id: 'rewards',   label: 'Rewards',        icon: '🎁', path: '/rewards', isLegacy: true },
];

// Default set granted to kids when `Family.kidModules` is undefined.
// Slim by design — parents opt their kids into more via Settings.
// `kaya:meetings` + `kaya:rewards` light up the kid-safe Kaya surfaces
// (Family meeting + Rewards) while leaving Rate/Award parent-only;
// `badges` rounds out the kid Kaya section; `stats` opens Reports /
// Kid profiles / Family tree (one grant, all three via extraPaths);
// `discover` brings back the Discover landing.
export const DEFAULT_KID_MODULES = [
  'home', 'moments',
  'kaya', 'kaya:meetings', 'kaya:rewards', 'badges',
  'hive', 'fun', 'discover', 'stats',
];

/** Resolve the granted module-id set for a family. Adds `home`
 *  unconditionally and falls back to {@link DEFAULT_KID_MODULES} when
 *  the family hasn't customised. Also auto-grants the parent id for
 *  any sub-id present so the kid's nav stays consistent — i.e. you
 *  can't have a granted sub whose parent is hidden. */
export function resolveKidModules(kidModules: string[] | undefined): Set<string> {
  const set = new Set(kidModules ?? DEFAULT_KID_MODULES);
  set.add('home');
  // Sub-ids look like "household:meals" — promote each to its parent
  // so the parent's nav row renders and the parent route resolves.
  for (const id of Array.from(set)) {
    const colon = id.indexOf(':');
    if (colon > 0) set.add(id.slice(0, colon));
  }
  return set;
}

/** Return the module id that gates a given pathname, or undefined
 *  when the path isn't covered by any kid module (e.g. /login,
 *  /settings). Sub-modules win for the deeper match — granting
 *  `household:meals` lets the kid reach `/pantry/meals` even if other
 *  household subs are off. */
export function moduleIdForPath(pathname: string): string | undefined {
  // Pass 1 — sub-modules first (more specific paths take priority).
  for (const m of KID_MODULES) {
    if (!m.subModules) continue;
    for (const sub of m.subModules) {
      if (matchesPath(pathname, sub.path)) return `${m.id}:${sub.id}`;
      if (sub.extraPaths) {
        for (const p of sub.extraPaths) {
          if (matchesPath(pathname, p)) return `${m.id}:${sub.id}`;
        }
      }
    }
  }
  // Pass 2 — top-level module paths.
  for (const m of KID_MODULES) {
    if (matchesPath(pathname, m.path)) return m.id;
    if (m.extraPaths) {
      for (const p of m.extraPaths) {
        if (matchesPath(pathname, p)) return m.id;
      }
    }
  }
  return undefined;
}

function matchesPath(pathname: string, target: string): boolean {
  if (target === '/') return pathname === '/';
  return pathname === target || pathname.startsWith(target + '/');
}
