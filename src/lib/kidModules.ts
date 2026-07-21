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
  // My Day — the kid's one-stop aggregator: today's workplan + Pulse
  // readings + reminders + request statuses, in one prioritised list.
  { id: 'myday',     label: 'My Day',         icon: '🌟', path: '/my-day' },
  // My Workplan — the kid's repeatable daily plan (school times, homework,
  // chores, play) that they tick off + earn points. Parent assigns from
  // the parent /workplan view. Also feeds the kid "My Day" aggregator.
  { id: 'workplan',  label: 'My Workplan',    icon: '🗓️', path: '/workplan' },
  { id: 'moments',   label: 'Moments',        icon: '📸', path: '/moments' },
  // Messages — family-only in-app chat (group + direct). Kid-safe: the
  // member list is exactly the family's accounts, no external contacts.
  // Default-on but parent-toggleable like every other kid module.
  { id: 'messages',  label: 'Messages',       icon: '💬', path: '/messages' },
  // Kaya Buzz — ideas & help community. Open to every invited family
  // on every tier (per the Tiers matrix). Default-on for kids; parents
  // can hide via Settings if they don't want their kid posting publicly.
  { id: 'buzz',      label: 'Buzz',           icon: '🐝', path: '/buzz' },
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
  // Kaya Sparks — kids education. Top-level toggle only; per-area
  // visibility (school projects / home projects / achievements /
  // academic / sports) is governed by `sparks_profiles.sibling_visibility`
  // (open / independent / per_area), enforced in firestore.rules — that's
  // a SIBLING-read concern, not a kid's own nav. Kids always see their
  // own /sparks subtree when the parent has the module on.
  // Dashboard + setup live under /sparks/setup + /sparks/[kidId]/dashboard
  // and are parent-only by route guard (not by kidModules).
  { id: 'sparks',    label: 'Kaya Sparks',    icon: '✨', path: '/sparks' },
  { id: 'hive',      label: 'The Hive',       icon: '🍯', path: '/hive' },
  { id: 'business',  label: 'Kaya Business',  icon: '💼', path: '/business' },
  // Kaya Pulse — kid surface is Today + Quick Entry + the points Ledger.
  // The parent Dashboard (/pulse) redirects non-parents, so it isn't gated here.
  { id: 'pulse',     label: 'Kaya Pulse',     icon: '📈', path: '/pulse/today', extraPaths: ['/pulse/log', '/pulse/ledger'] },
  { id: 'directory', label: 'Directory',      icon: '📞', path: '/directory' },
  { id: 'fun',       label: 'Fun',            icon: '🎮', path: '/videos' },
  // Kaya Games — the family play hub (22 games, 4 worlds). Its own toggle
  // so parents can grant Games without Videos. Credits House Points via the
  // server award route. Was previously folded into `fun` via extraPaths.
  { id: 'games',     label: 'Games',          icon: '🎮', path: '/games' },
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
  'home', 'myday', 'workplan', 'moments', 'messages', 'buzz', 'sparks',
  'kaya', 'kaya:meetings', 'kaya:rewards', 'badges',
  'hive', 'fun', 'games', 'discover', 'stats',
];

/** Resolve the granted module-id set for a family. Adds `home`
 *  unconditionally and falls back to {@link DEFAULT_KID_MODULES} when
 *  the family hasn't customised. Also auto-grants the parent id for
 *  any sub-id present so the kid's nav stays consistent — i.e. you
 *  can't have a granted sub whose parent is hidden. */
export function resolveKidModules(kidModules: string[] | undefined): Set<string> {
  const set = new Set(kidModules ?? DEFAULT_KID_MODULES);
  set.add('home');
  // The Universe is a guided, read-only tour of every module — always shown,
  // never a gated feature. Granting it here just lets its nav row render; the
  // deep links inside still respect each module's own kid route guard.
  set.add('universe');
  // Reminders — the calendar/reminders space is for EVERY user (approved v3
  // FINAL 2026-06-13), so it's always granted like Home, never a toggle. Its
  // route (/reminders) isn't in KID_MODULES, so moduleIdForPath returns
  // undefined → the kid route guard never bounces it.
  set.add('reminders');
  // NO sub→parent promotion. Legitimate sub-grants always carry their parent
  // id (the settings UI only offers subs while the parent is ON and writes
  // both), so promotion's only real effect was the gate leak: sub-ids
  // orphaned by an earlier parent-off toggle silently re-granted the parent,
  // and Household reappeared for kids after being switched off. An orphaned
  // sub now grants exactly its own deep path (moduleIdForPath returns the
  // composite for sub-paths) and nothing else.
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
