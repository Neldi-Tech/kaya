// Canonical list of modules that can appear in a kid's nav. Parents
// pick which ones their kids see via Settings → "What kids see"; the
// selection is persisted on `Family.kidModules`. Modules not in the
// granted set are dropped from the kid sidebar, the mobile bottom bar,
// and the More sheet — and kid visits to their routes are bounced to
// the kid Home page.
//
// IDs are stable strings persisted on the Family document — don't
// rename existing entries; add new ones instead.

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
}

export const KID_MODULES: KidModule[] = [
  { id: 'home',      label: 'Home',           icon: '🏠', path: '/kid', alwaysOn: true },
  { id: 'moments',   label: 'Moments',        icon: '📸', path: '/moments' },
  { id: 'household', label: 'Household',      icon: '🏡', path: '/pantry' },
  { id: 'hive',      label: 'The Hive',       icon: '🍯', path: '/hive' },
  { id: 'business',  label: 'Kaya Business',  icon: '💼', path: '/business' },
  { id: 'directory', label: 'Directory',      icon: '📞', path: '/directory' },
  { id: 'fun',       label: 'Fun',            icon: '🎮', path: '/videos', extraPaths: ['/games'] },
  { id: 'wealth',    label: 'Kaya Wealth',    icon: '💎', path: '/wealth',   soon: true },
  { id: 'wellness',  label: 'Kaya Wellness',  icon: '🧘', path: '/wellness', soon: true },
  { id: 'chef',      label: 'Kaya Chef',      icon: '🍳', path: '/chef',     soon: true },
  // ── Phased-out (OFF by default) ───────────────────────────────────
  { id: 'discover',  label: 'Discover',       icon: '🔎', path: '/',        isLegacy: true },
  { id: 'badges',    label: 'Badges',         icon: '🏆', path: '/badges',  isLegacy: true },
  { id: 'rewards',   label: 'Rewards',        icon: '🎁', path: '/rewards', isLegacy: true },
];

// Default set granted to kids when `Family.kidModules` is undefined.
// Slim by design — parents opt their kids into more via Settings.
export const DEFAULT_KID_MODULES = ['home', 'moments', 'hive', 'fun'];

/** Resolve the granted module-id set for a family. Adds `home`
 *  unconditionally and falls back to {@link DEFAULT_KID_MODULES} when
 *  the family hasn't customised. */
export function resolveKidModules(kidModules: string[] | undefined): Set<string> {
  const set = new Set(kidModules ?? DEFAULT_KID_MODULES);
  set.add('home');
  return set;
}

/** Return the module id that gates a given pathname, or undefined when
 *  the path isn't covered by any kid module (e.g. /login, /settings). */
export function moduleIdForPath(pathname: string): string | undefined {
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
