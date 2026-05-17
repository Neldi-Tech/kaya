'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { resolveKidModules, moduleIdForPath } from '@/lib/kidModules';
import { getHelperLink } from '@/lib/helpers';
import { helperModuleKeyForPath } from '@/lib/helperModules';
import GuestBanner from './GuestBanner';

// Visibility check for a helper navigating to `path`. Walks
// helperModuleKeyForPath() → gets the required key (e.g. 'kaya:rate',
// 'household:meals', 'moments'); matches against the helper's granted
// set with three fallbacks:
//   1. exact match (composite or bare parent)
//   2. composite required, parent granted → access (parent grant
//      covers all subs)
//   3. kaya:* required, legacy 'home' granted → access (pre-Kaya-split
//      docs from earlier helper rollout)
// Returns true when the route isn't helper-module-gated at all.
function isHelperPathAllowed(pathname: string, granted: Set<string>): boolean {
  const required = helperModuleKeyForPath(pathname);
  if (!required) return true;
  if (granted.has(required)) return true;
  const colon = required.indexOf(':');
  if (colon > 0) {
    const parent = required.slice(0, colon);
    if (granted.has(parent)) return true;
    if (parent === 'kaya' && granted.has('home')) return true;  // legacy alias
  }
  return false;
}

// Kaya brand logomark · the house-with-heart from Brand/svg/kaya-icon.svg,
// inlined so the "Kaya" section ships with the real brand mark instead
// of the old star emoji. fill picks up currentColor so the same icon
// renders correctly in idle (chocolate) and active (gold-light) states
// without branching on theme.
function KayaIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      aria-hidden="true"
      focusable="false"
      fill="currentColor"
    >
      <path d="M338 210L338 138Q338 124 352 124L374 124Q388 124 388 138L388 210Z" />
      <path
        fillRule="evenodd"
        d="M116 432Q96 432 96 412L96 246Q96 240 102 234L244 92Q256 80 268 92L410 234Q416 240 416 246L416 412Q416 432 396 432L116 432Z M256 320C256 290 216 290 216 312C216 344 236 360 256 380C276 360 296 344 296 312C296 290 256 290 256 320Z"
      />
    </svg>
  );
}

type NavItem = {
  path: string;
  icon: string;
  iconNode?: React.ReactNode;
  label: string;
  mobileLabel?: string;
  soon?: boolean;
  disabled?: boolean;
};

// Each row in the desktop sidebar (and the mobile "More" sheet) is one of:
//   - link    : direct nav. Tap → `path`. Used for Home, Moments, Pages.
//   - section : header + indented sub-items, collapsible. Chevron
//               toggles inline; tapping the header itself (when `href`
//               is set) jumps to the section's landing page
//               (e.g. Household → /pantry).
//   - soon    : non-interactive placeholder for an unshipped module
//               (Kaya Wealth, Wellness, Chef). Renders with a SOON pill.
type SidebarRow =
  | {
      kind: 'link';
      id: string;
      path: string;
      icon?: string;
      iconNode?: React.ReactNode;
      label: string;
      activePrefixes?: string[];
      /** Render a SOON pill on the row. The row is still tappable —
       *  it navigates to a teaser page that explains the unshipped
       *  module. */
      soon?: boolean;
    }
  | {
      kind: 'section';
      id: string;
      icon?: string;
      iconNode?: React.ReactNode;
      label: string;
      href?: string;
      items: NavItem[];
      activePrefixes?: string[];
    };

// Mobile bottom nav uses 5 fixed slots for parents:
//   1. Home     — link (auto-highlights on /notifications too)
//   2. Moments  — link
//   3. Kaya     — sheet (point-system sub-menu)
//   4. Hive     — link (Hive has its own section tab bar)
//   5. More     — mega-sheet (full sidebar list w/ collapsibles)
type MobileGroup =
  | {
      kind: 'link';
      id: string;
      path: string;
      icon?: string;
      iconNode?: React.ReactNode;
      label: string;
      activePrefixes?: string[];
    }
  | {
      kind: 'sheet';
      id: string;
      icon?: string;
      iconNode?: React.ReactNode;
      label: string;
      title: string;
      items: NavItem[];
    }
  | {
      kind: 'mega';
      id: string;
      icon?: string;
      iconNode?: React.ReactNode;
      label: string;
      title: string;
    };

// ── Parent nav items ─────────────────────────────────────────────────
// Kaya · point system. The original parenting loop.
const KAYA_NAV: NavItem[] = [
  { path: '/rate',            icon: '📋',           label: 'Rate routines',   mobileLabel: 'Rate' },
  { path: '/award',           icon: '🎖️',          label: 'Award points',    mobileLabel: 'Award' },
  { path: '/meetings',        icon: '👨‍👩‍👧‍👦', label: 'Family meeting',  mobileLabel: 'Meet' },
  { path: '/rewards',         icon: '🎁',           label: 'Rewards',         mobileLabel: 'Rewards' },
  { path: '/parent/rewards',  icon: '⚙️',           label: 'Manage rewards',  mobileLabel: 'Manage' },
];

// Household · runs the home. Pantry today; shopping list, meal plan,
// household routines follow. (Renamed from "Pantry" — the section name
// now describes the surface, not one feature inside it.)
const HOUSEHOLD_NAV: NavItem[] = [
  { path: '/pantry',          icon: '🛒', label: 'The Pantry' },
  { path: '/pantry/people',   icon: '🤝', label: 'People' },
  { path: '/pantry/purchase', icon: '🧾', label: 'Purchase' },
  { path: '/pantry/budget',   icon: '💰', label: 'Budget' },
];

// The Hive · kid's three-layer wallet plus parent controls.
const HIVE_NAV: NavItem[] = [
  { path: '/hive',                icon: '🍯', label: 'The Hive' },
  { path: '/parent/approvals',    icon: '✅', label: 'Approvals' },
  { path: '/parent/rates',        icon: '⚖️', label: 'Rates & policy' },
  { path: '/parent/hive-deposit', icon: '💸', label: 'Deposit cash' },
];

// Kaya Business · micro-enterprises. Coming soon — one placeholder
// sub-item announces the module until it ships.
const BUSINESS_NAV: NavItem[] = [
  { path: '/business', icon: '💼', label: 'Overview' },
];

// Stats · reports & trends. Collapsed by default to keep the menu calm.
const STATS_NAV: NavItem[] = [
  { path: '/reports',       icon: '📊', label: 'Reports' },
  { path: '/profiles',      icon: '👧', label: 'Kid profiles' },
  { path: '/pantry/people', icon: '🤝', label: 'Helper performance' },
  { path: '/badges',        icon: '🏆', label: 'Badges' },
  { path: '/family-tree',   icon: '🌳', label: 'Family tree' },
];

// Fun · games & surprises. Both items "Soon" today.
const FUN_NAV: NavItem[] = [
  { path: '/videos', icon: '📺', label: 'Videos', soon: true },
  { path: '/games',  icon: '🎮', label: 'Games',  soon: true },
];

// Kid Fun sheet (parents see the same emoji set in their Fun section).
const KID_FUN_NAV: NavItem[] = [
  { path: '/videos', icon: '📺', label: 'Videos', mobileLabel: 'Videos', soon: true },
  { path: '/games',  icon: '🎮', label: 'Games',  mobileLabel: 'Games',  soon: true },
];

// ── Sidebars per role ────────────────────────────────────────────────
// Parents · 13 rows in the design-proposal order (Discover + 12 modules).
// Container sections (Kaya, Household, Hive, Business, Stats, Fun) are
// collapsible and auto-open whenever the user is on a route inside them.
const PARENT_SIDEBAR: SidebarRow[] = [
  { kind: 'link',    id: 'discover',  path: '/',          icon: '🔎', label: 'Discover' },
  { kind: 'link',    id: 'home',      path: '/home',      icon: '🏠', label: 'Home', activePrefixes: ['/notifications'] },
  { kind: 'link',    id: 'moments',   path: '/moments',   icon: '📸', label: 'Moments' },
  { kind: 'section', id: 'kaya',      iconNode: <KayaIcon className="w-4 h-4" />, label: 'Kaya', items: KAYA_NAV },
  { kind: 'section', id: 'household', icon: '🏡', label: 'Household', href: '/pantry', items: HOUSEHOLD_NAV },
  { kind: 'section', id: 'hive',      icon: '🍯', label: 'The Hive', href: '/hive', items: HIVE_NAV, activePrefixes: ['/parent/approvals', '/parent/rates', '/parent/hive-deposit'] },
  { kind: 'section', id: 'business',  icon: '💼', label: 'Kaya Business', items: BUSINESS_NAV },
  { kind: 'link',    id: 'pages',     path: '/directory', icon: '📞', label: 'Directory' },
  { kind: 'section', id: 'stats',     icon: '📊', label: 'Stats', items: STATS_NAV },
  { kind: 'section', id: 'fun',       icon: '🎮', label: 'Fun', items: FUN_NAV },
  { kind: 'link',    id: 'wealth',    path: '/wealth',   icon: '💎', label: 'Kaya Wealth',   soon: true },
  { kind: 'link',    id: 'wellness',  path: '/wellness', icon: '🧘', label: 'Kaya Wellness', soon: true },
  { kind: 'link',    id: 'chef',      path: '/chef',     icon: '🍳', label: 'Kaya Chef',     soon: true },
];

// Helpers and kids — no Soon teasers, no collapsibles (their feature
// set is small enough to render flat).
const HELPER_SIDEBAR: SidebarRow[] = [
  { kind: 'link', id: 'discover', path: '/',         icon: '🔎', label: 'Discover' },
  { kind: 'link', id: 'home',     path: '/home',     icon: '🏠', label: 'Home' },
  { kind: 'link', id: 'rate',     path: '/rate',     icon: '📋', label: 'Rate' },
  { kind: 'link', id: 'award',    path: '/award',    icon: '🎖️', label: 'Award' },
  { kind: 'link', id: 'moments',  path: '/moments',  icon: '📸', label: 'Moments' },
  { kind: 'link', id: 'pantry',   path: '/pantry',   icon: '🛒', label: 'Pantry' },
  { kind: 'link', id: 'profiles', path: '/profiles', icon: '👧', label: 'Kids' },
];

// Full kid menu in canonical order. Filtered at render time through
// `family.kidModules` (see `resolveKidModules`) — rows whose `id`
// isn't in the granted set are dropped. Home is always granted.
// Discover/Badges/Rewards are legacy modules and OFF by default for
// new families, but kept as toggleable so households who liked the old
// shape can re-enable them. Wealth/Wellness/Chef render with a SOON
// pill until their pages ship.
const KID_SIDEBAR: SidebarRow[] = [
  { kind: 'link',    id: 'discover',  path: '/',          icon: '🔎', label: 'Discover' },
  { kind: 'link',    id: 'home',      path: '/kid',       icon: '🏠', label: 'Home' },
  { kind: 'link',    id: 'moments',   path: '/moments',   icon: '📸', label: 'Moments' },
  { kind: 'link',    id: 'household', path: '/pantry',    icon: '🏡', label: 'Household' },
  { kind: 'link',    id: 'hive',      path: '/hive',      icon: '🍯', label: 'The Hive' },
  { kind: 'link',    id: 'business',  path: '/business',  icon: '💼', label: 'Kaya Business' },
  { kind: 'link',    id: 'directory', path: '/directory', icon: '📞', label: 'Directory' },
  { kind: 'section', id: 'fun',       icon: '🎮', label: 'Fun', items: KID_FUN_NAV },
  { kind: 'link',    id: 'wealth',    path: '/wealth',    icon: '💎', label: 'Kaya Wealth',   soon: true },
  { kind: 'link',    id: 'wellness',  path: '/wellness',  icon: '🧘', label: 'Kaya Wellness', soon: true },
  { kind: 'link',    id: 'chef',      path: '/chef',      icon: '🍳', label: 'Kaya Chef',     soon: true },
  { kind: 'link',    id: 'badges',    path: '/badges',    icon: '🏆', label: 'Badges' },
  { kind: 'link',    id: 'rewards',   path: '/rewards',   icon: '🎁', label: 'Rewards' },
];

// ── Mobile bottom-bar groups ─────────────────────────────────────────
// 5 slots per role — Discover always anchors slot 1. Moments + the rest
// remain reachable via the More mega-sheet.
const PARENT_MOBILE_GROUPS: MobileGroup[] = [
  { kind: 'link', id: 'discover', path: '/',     icon: '🔎', label: 'Discover' },
  { kind: 'link', id: 'home',     path: '/home', icon: '🏠', label: 'Home', activePrefixes: ['/notifications'] },
  { kind: 'sheet', id: 'kaya', iconNode: <KayaIcon className="w-5 h-5" />, label: 'Kaya', title: 'Kaya · point system', items: KAYA_NAV },
  { kind: 'link', id: 'hive',     path: '/hive', icon: '🍯', label: 'Hive', activePrefixes: ['/parent/approvals', '/parent/rates', '/parent/hive-deposit'] },
  { kind: 'mega', id: 'more',     icon: '☰', label: 'More', title: 'All modules' },
];

const KID_MOBILE_GROUPS: MobileGroup[] = [
  { kind: 'link', id: 'discover', path: '/',        icon: '🔎', label: 'Discover' },
  { kind: 'link', id: 'home',     path: '/kid',     icon: '🏠', label: 'Home' },
  { kind: 'link', id: 'hive',     path: '/hive',    icon: '🍯', label: 'Hive' },
  { kind: 'link', id: 'moments',  path: '/moments', icon: '📸', label: 'Moments' },
  { kind: 'mega', id: 'more',     icon: '☰', label: 'More', title: 'All modules' },
];

const HELPER_MOBILE_GROUPS: MobileGroup[] = [
  { kind: 'link', id: 'discover', path: '/',        icon: '🔎', label: 'Discover' },
  { kind: 'link', id: 'home',     path: '/home',    icon: '🏠', label: 'Home' },
  { kind: 'link', id: 'rate',     path: '/rate',    icon: '📋', label: 'Rate' },
  { kind: 'link', id: 'pantry',   path: '/pantry',  icon: '🛒', label: 'Pantry' },
  { kind: 'mega', id: 'more',     icon: '☰', label: 'More', title: 'All modules' },
];

// localStorage key for the open/closed state of collapsible sections.
// Stored as { [sectionId]: boolean }. Missing key = closed (unless the
// current route auto-opens the section).
const OPEN_SECTIONS_LS_KEY = 'kaya:nav:openSections';

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children: kids } = useFamily();

  const role = profile?.role || 'parent';
  const homePath = role === 'kid' ? '/kid' : '/home';
  // BackBar is suppressed on Discover (`/`) and on the role's Home page —
  // both are top-level destinations, so a Back affordance would be noise.
  const isAtHome = pathname === homePath || pathname === '/';

  // Inside /hive/* OR /pantry/* the section renders its own bottom tab
  // bar. Suppress AppShell's mobile bottom nav so the two don't stack.
  const inHiveSection = !!pathname?.startsWith('/hive');
  const inPantrySection = !!pathname?.startsWith('/pantry');
  const inSectionWithOwnTabBar = inHiveSection || inPantrySection;

  // Full-screen routes — the page renders its own chrome edge-to-edge
  // and the AppShell's sidebar + top header would only steal width.
  // Today: the Family Meeting presenter (cast-friendly, dark backdrop,
  // wants the whole window) and the Points Review presenter (Belt /
  // Ladder reveal designed to fill a TV). Add other routes here as
  // they ship.
  const isFullScreenRoute =
    !!pathname?.startsWith('/meetings/present') ||
    !!pathname?.startsWith('/meetings/review');

  // Parent-controlled set of modules a kid is allowed to see. Falls back
  // to `DEFAULT_KID_MODULES` (slim default) when the family hasn't
  // customised. Home is always included.
  const grantedKidModules = useMemo(
    () => resolveKidModules(family?.kidModules),
    [family?.kidModules]
  );

  // Per-helper module scope. Fetched from the HelperLink doc once per
  // session. `null` initial = "not loaded yet"; `'legacy'` = "no
  // HelperLink doc, fall back to full helper sidebar" (matches the
  // firestore.rules `isLegacyHelperWithoutLink` carve-out). A real Set
  // means we filter strictly.
  const [helperModules, setHelperModules] = useState<Set<string> | 'legacy' | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (role !== 'helper' || !profile?.familyId || !profile.uid) {
      setHelperModules(null);
      return;
    }
    (async () => {
      try {
        const link = await getHelperLink(profile.familyId, profile.uid);
        if (cancelled) return;
        if (!link) { setHelperModules('legacy'); return; }
        // Prefer `moduleAccess` (view tier) when present — that's the
        // canonical source post-rollout. Sidebar visibility = "can
        // they navigate to it" = view-tier. Act-tier checks happen
        // on writes inside each screen. Legacy docs (only `modules`
        // array, no moduleAccess) get treated as view+act.
        const ids = new Set<string>();
        if (link.moduleAccess) {
          for (const [id, flags] of Object.entries(link.moduleAccess)) {
            if (flags.view) ids.add(id);
          }
        } else {
          for (const id of link.modules) ids.add(id);
        }
        setHelperModules(ids);
      } catch {
        if (!cancelled) setHelperModules('legacy');
      }
    })();
    return () => { cancelled = true; };
  }, [role, profile?.familyId, profile?.uid]);

  // Visibility predicate for a helper sidebar/mobile row. Walks the
  // path through helperModuleKeyForPath() and checks the helper's
  // granted set with the composite/parent/legacy fallback chain.
  const isHelperRowVisible = useMemo(() => {
    return (path: string | undefined) => {
      if (helperModules === 'legacy' || helperModules === null) return true;
      if (!path) return true;
      return isHelperPathAllowed(path, helperModules);
    };
  }, [helperModules]);

  const sidebar: SidebarRow[] = useMemo(() => {
    if (role === 'kid') return KID_SIDEBAR.filter((row) => grantedKidModules.has(row.id));
    if (role === 'helper') {
      return HELPER_SIDEBAR.filter((row) => row.kind !== 'link' || isHelperRowVisible(row.path));
    }
    return PARENT_SIDEBAR;
  }, [role, grantedKidModules, isHelperRowVisible]);

  const mobileGroups: MobileGroup[] = useMemo(() => {
    if (role === 'kid') {
      // `more` is a mega-sheet that renders the (already-filtered)
      // sidebar — keep it regardless of toggles.
      return KID_MOBILE_GROUPS.filter((g) => g.id === 'more' || grantedKidModules.has(g.id));
    }
    if (role === 'helper') {
      return HELPER_MOBILE_GROUPS.filter((g) => g.kind !== 'link' || isHelperRowVisible(g.path));
    }
    return PARENT_MOBILE_GROUPS;
  }, [role, grantedKidModules, isHelperRowVisible]);

  // Route guard for kids — if they land on a path that belongs to a
  // module their family hasn't granted, bounce them back to Home so the
  // visibility setting can't be bypassed by typing a URL.
  useEffect(() => {
    if (role !== 'kid' || !pathname) return;
    const moduleId = moduleIdForPath(pathname);
    if (!moduleId) return; // path isn't gated (e.g. /settings, /notifications)
    if (!grantedKidModules.has(moduleId)) {
      router.replace('/kid');
    }
  }, [role, pathname, grantedKidModules, router]);

  // Route guard for helpers — bounces to /helper when typing a URL
  // they don't have access to. Uses isHelperPathAllowed which walks
  // helperModuleKeyForPath and applies composite/parent/legacy
  // fallbacks. Mirrors the kid guard above.
  useEffect(() => {
    if (role !== 'helper' || !pathname) return;
    if (helperModules === 'legacy' || helperModules === null) return;
    if (!isHelperPathAllowed(pathname, helperModules)) {
      router.replace('/helper');
    }
  }, [role, pathname, helperModules, router]);

  // ── Path matching ──────────────────────────────────────────────────
  const isPathActive = (path: string) => {
    if (pathname === path) return true;
    // `/` (Discover) and `/home` are top-level destinations — without
    // this guard a startsWith('/') would mark Discover active on every
    // page, and startsWith('/home') would catch /home/anything in future.
    if (path === '/' || path === '/home') return false;
    return !!pathname?.startsWith(path + '/');
  };
  const isActive = isPathActive;

  const isLinkActive = (g: { path: string; activePrefixes?: string[] }): boolean => {
    if (isPathActive(g.path)) return true;
    if (g.activePrefixes) {
      for (const p of g.activePrefixes) {
        if (pathname === p || pathname?.startsWith(p + '/')) return true;
      }
    }
    return false;
  };

  const isSectionActive = (s: Extract<SidebarRow, { kind: 'section' }>): boolean => {
    if (s.href && isPathActive(s.href)) return true;
    if (s.items.some((i) => isPathActive(i.path))) return true;
    if (s.activePrefixes) {
      for (const p of s.activePrefixes) {
        if (pathname === p || pathname?.startsWith(p + '/')) return true;
      }
    }
    return false;
  };

  // ── Collapsible section state (localStorage-backed) ────────────────
  // Default behaviour: closed. Auto-opens the section the user is
  // currently inside. User toggles override the auto state and persist
  // across sessions.
  const [storedOpen, setStoredOpen] = useState<Record<string, boolean>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(OPEN_SECTIONS_LS_KEY);
      if (raw) setStoredOpen(JSON.parse(raw));
    } catch {
      /* localStorage unavailable — silently fall back to defaults */
    }
  }, []);
  const toggleSection = (id: string, currentlyOpen: boolean) => {
    const next = { ...storedOpen, [id]: !currentlyOpen };
    setStoredOpen(next);
    try {
      localStorage.setItem(OPEN_SECTIONS_LS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const isSectionOpen = (s: Extract<SidebarRow, { kind: 'section' }>) => {
    const stored = storedOpen[s.id];
    if (stored === true) return true;
    if (stored === false) return false;
    return isSectionActive(s); // auto-open when user is inside the section
  };

  // ── Sheet state ────────────────────────────────────────────────────
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [lastSheetId, setLastSheetId] = useState<string | null>(null);
  useEffect(() => {
    if (openSheetId) setLastSheetId(openSheetId);
  }, [openSheetId]);
  useEffect(() => {
    setOpenSheetId(null);
  }, [pathname]);

  const sheetGroup = mobileGroups.find(
    (g) => (g.kind === 'sheet' || g.kind === 'mega') && g.id === lastSheetId
  );

  const initial = profile?.displayName?.[0]?.toUpperCase() || 'U';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  // ── Icon helper ────────────────────────────────────────────────────
  // Renders either an SVG component (iconNode) or an emoji string.
  // sizeClass controls the sizing wrapper for SVGs; emoji ride the
  // surrounding font-size.
  const renderIcon = (
    icon: string | undefined,
    iconNode: React.ReactNode | undefined,
    emojiClass: string,
    nodeClass: string
  ) => {
    if (iconNode) {
      return <span className={`inline-flex items-center justify-center ${nodeClass}`}>{iconNode}</span>;
    }
    return <span className={`leading-none ${emojiClass}`}>{icon}</span>;
  };

  // ── Sidebar row renderer (shared: desktop aside + mobile More sheet)
  const renderSidebarRow = (row: SidebarRow) => {
    if (row.kind === 'link') {
      const active = isLinkActive({ path: row.path, activePrefixes: row.activePrefixes });
      return (
        <Link
          key={row.id}
          href={row.path}
          onClick={() => setOpenSheetId(null)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-kaya-sm text-[13px] transition-colors ${
            active
              ? 'bg-kaya-chocolate text-white font-semibold'
              : row.soon
              ? 'text-kaya-sand hover:bg-white font-medium'
              : 'text-kaya-chocolate hover:bg-white font-medium'
          }`}
        >
          {renderIcon(row.icon, row.iconNode, row.soon ? 'text-base opacity-70' : 'text-base', row.soon ? 'w-4 h-4 opacity-70' : 'w-4 h-4')}
          <span className="text-left flex-1 truncate">{row.label}</span>
          {row.soon && (
            <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
              active ? 'bg-white/20 text-kaya-gold-light' : 'bg-kaya-warm-dark text-kaya-sand'
            }`}>
              Soon
            </span>
          )}
        </Link>
      );
    }
    if (row.kind === 'section') {
      const active = isSectionActive(row);
      const open = isSectionOpen(row);
      const headerClasses = `flex-1 flex items-center gap-3 px-3 py-2.5 rounded-kaya-sm text-[13px] transition-colors text-left ${
        active
          ? 'bg-kaya-chocolate text-white font-semibold'
          : 'text-kaya-chocolate hover:bg-white font-medium'
      }`;
      const headerInner = (
        <>
          {renderIcon(row.icon, row.iconNode, 'text-base', 'w-4 h-4')}
          <span className="text-left flex-1 truncate">{row.label}</span>
        </>
      );
      return (
        <div key={row.id}>
          <div className="flex items-stretch gap-1">
            {row.href ? (
              <Link
                href={row.href}
                onClick={() => setOpenSheetId(null)}
                className={headerClasses}
              >
                {headerInner}
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => toggleSection(row.id, open)}
                className={headerClasses}
              >
                {headerInner}
              </button>
            )}
            <button
              type="button"
              aria-label={open ? `Collapse ${row.label}` : `Expand ${row.label}`}
              aria-expanded={open}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleSection(row.id, open);
              }}
              className={`w-8 flex items-center justify-center rounded-kaya-sm text-sm transition-colors ${
                active
                  ? 'text-white hover:bg-kaya-chocolate-light'
                  : 'text-kaya-sand hover:bg-white'
              }`}
            >
              <span className={`inline-block transition-transform ${open ? 'rotate-180' : ''}`}>⌄</span>
            </button>
          </div>
          {open && (
            <div className="ml-3 mt-1 mb-1 pl-3 border-l-2 border-kaya-warm-dark space-y-0.5">
              {row.items.map((item) => {
                const itemActive = isActive(item.path);
                const itemClasses = `w-full flex items-center gap-3 px-3 py-2 rounded-kaya-sm text-[12.5px] transition-colors ${
                  itemActive
                    ? 'bg-kaya-gold-light text-kaya-chocolate font-semibold'
                    : 'text-kaya-chocolate hover:bg-white font-medium'
                }`;
                const inner = (
                  <>
                    <span className="text-sm leading-none">{item.icon}</span>
                    <span className="text-left flex-1 truncate">{item.label}</span>
                    {item.soon && (
                      <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-kaya-warm-dark text-kaya-sand">
                        Soon
                      </span>
                    )}
                  </>
                );
                if (item.disabled) {
                  return (
                    <div key={item.path} aria-disabled="true" className={itemClasses}>
                      {inner}
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.path}
                    href={item.path}
                    onClick={() => setOpenSheetId(null)}
                    className={itemClasses}
                  >
                    {inner}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      );
    }
    // Exhaustiveness check — SidebarRow has no other kinds today, but
    // a future `kind` addition will surface here as a TS error.
    const _exhaustive: never = row;
    return _exhaustive;
  };

  // Full-screen routes render their own chrome (presenter mode, etc.)
  // — bypass the whole AppShell wrap so the page gets the full window
  // with no sidebar / top header / bottom nav stealing space.
  if (isFullScreenRoute) {
    return <div className="min-h-screen bg-kaya-cream">{children}</div>;
  }

  return (
    <div className="min-h-screen bg-kaya-cream">
      {/* ── Desktop sidebar (lg+) ─────────────────────────── */}
      <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-[260px] flex-col border-r border-kaya-warm-dark/60 bg-kaya-cream z-30">
        <Link
          href={homePath}
          aria-label="Go to home"
          className="px-5 pt-6 pb-5 flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/kaya-icon-k.svg" alt="" width="36" height="36" className="w-9 h-9 shrink-0" />
          <span className="font-display font-bold text-lg tracking-tight">Kaya</span>
        </Link>

        {(family || role !== 'kid') && (
          <div className="px-4 mb-5">
            <Link
              href="/settings"
              className="w-full bg-white border border-kaya-warm-dark rounded-kaya p-3 flex items-center gap-2.5 hover:border-kaya-chocolate transition-colors"
            >
              <div className="w-9 h-9 rounded-[10px] bg-kaya-gold-light flex items-center justify-center text-base shrink-0">🏡</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{family?.name || 'Your family'}</div>
                <div className="text-[11px] text-kaya-sand">
                  {kids.length} {kids.length === 1 ? 'kid' : 'kids'} · {role.charAt(0).toUpperCase() + role.slice(1)}
                </div>
              </div>
              <span className="text-kaya-sand text-xs">⌄</span>
            </Link>
          </div>
        )}

        <nav className="px-3 flex-1 overflow-y-auto space-y-0.5">
          {sidebar.map(renderSidebarRow)}
        </nav>

        <div className="p-3 border-t border-kaya-warm-dark/60">
          <Link
            href="/settings"
            className="w-full flex items-center gap-3 px-2 py-2 rounded-kaya-sm hover:bg-white text-kaya-chocolate"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-xs text-white font-black shadow-sm shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold truncate">{profile?.displayName || 'You'}</div>
              <div className="text-[10px] text-kaya-sand">Settings</div>
            </div>
            <span className="text-kaya-sand text-xs">⚙</span>
          </Link>
        </div>
      </aside>

      {/* ── Right column (shifted right of sidebar at lg+) ── */}
      <div className="lg:pl-[260px]">
        <GuestBanner />
        {/* Mobile top header */}
        <div className="lg:hidden sticky top-0 z-20 bg-kaya-cream/95 backdrop-blur-md border-b border-kaya-warm-dark/50 safe-top">
          <div className="mx-auto max-w-md flex items-center justify-between px-4 h-14 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href={homePath}
                aria-label="Go to home"
                className="flex items-center gap-2.5 hover:opacity-80 transition-opacity min-w-0"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/brand/kaya-icon-k.svg" alt="" width="36" height="36" className="w-9 h-9 shrink-0" />
                <span className="font-display text-lg font-black tracking-tight truncate">Kaya</span>
              </Link>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Link
                href="/notifications"
                aria-label="Notifications"
                className="w-9 h-9 rounded-full bg-white border border-kaya-warm-dark flex items-center justify-center text-sm hover:bg-kaya-warm transition-colors"
              >
                🔔
              </Link>
              <Link
                href="/settings"
                aria-label="Settings"
                className="w-9 h-9 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-xs text-white font-black shadow-sm"
              >
                {initial}
              </Link>
            </div>
          </div>
        </div>

        {/* Desktop top bar */}
        <header className="hidden lg:flex sticky top-0 z-20 h-14 px-8 items-center justify-between bg-kaya-cream/85 backdrop-blur border-b border-kaya-warm-dark/60">
          <div className="text-xs text-kaya-sand">
            <span className="font-bold uppercase tracking-[0.14em]">{today}</span>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/award"
              className="h-9 px-3.5 rounded-kaya-sm border border-kaya-warm-dark text-[12px] font-semibold hover:bg-white transition-colors flex items-center"
            >
              ＋ Award points
            </Link>
            <Link
              href="/notifications"
              aria-label="Notifications"
              className="w-9 h-9 rounded-full border border-kaya-warm-dark flex items-center justify-center text-sm hover:bg-white transition-colors"
            >
              🔔
            </Link>
          </div>
        </header>

        {/* Content */}
        <div
          className="lg:pb-0"
          style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
        >
          {!isAtHome && <BackBar onBack={() => router.back()} placement="top" />}
          {children}
          {!isAtHome && <BackBar onBack={() => router.back()} placement="bottom" />}
        </div>
      </div>

      {/*
        Mobile bottom nav (lg- only).
        Anchored with `inset-x-0` instead of a centring transform —
        a transform on a fixed element jitters on iOS Safari when the
        URL bar collapses/expands during scroll. `will-change: transform`
        + explicit translateZ promotes the nav to its own compositor layer.
      */}
      <div
        className={`fixed bottom-0 inset-x-0 bg-kaya-cream border-t border-kaya-warm-dark/50 z-20 lg:hidden will-change-transform ${
          inSectionWithOwnTabBar ? 'hidden' : ''
        }`}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: 'translateZ(0)',
        }}
      >
        <div className="mx-auto max-w-md flex justify-around px-1 pt-1.5 pb-2">
          {mobileGroups.map((g) => {
            if (g.kind === 'link') {
              const active = isLinkActive(g);
              return (
                <Link
                  key={g.id}
                  href={g.path}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl transition-opacity ${
                    active ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  {g.iconNode ? (
                    <span className="w-6 h-6 inline-flex items-center justify-center">{g.iconNode}</span>
                  ) : (
                    <span className="text-xl leading-none">{g.icon}</span>
                  )}
                  <span className="text-[10px] font-extrabold">{g.label}</span>
                  {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
                </Link>
              );
            }
            // sheet OR mega · both open a slide-up sheet
            const active = g.kind === 'sheet'
              ? g.items.some((i) => isPathActive(i.path))
              : false;
            const open = openSheetId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                onClick={() => setOpenSheetId(open ? null : g.id)}
                aria-label={g.title}
                aria-expanded={open}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl transition-opacity ${
                  active || open ? 'opacity-100' : 'opacity-40'
                }`}
              >
                {g.iconNode ? (
                  <span className="w-6 h-6 inline-flex items-center justify-center">{g.iconNode}</span>
                ) : (
                  <span className="text-xl leading-none">{g.icon}</span>
                )}
                <span className="text-[10px] font-extrabold">{g.label}</span>
                {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile sub-menu sheet · slides up for the active group.
          For `sheet` groups (Kaya, kid Fun): renders a flat list of items.
          For `mega` group (More): renders the full collapsible sidebar.
          Kept mounted while a group has been opened at least once so
          the slide-down animation has content as it animates off-screen. */}
      {sheetGroup && (sheetGroup.kind === 'sheet' || sheetGroup.kind === 'mega') && (
        <div
          className={`fixed inset-0 z-40 lg:hidden ${openSheetId ? '' : 'pointer-events-none'}`}
          aria-hidden={!openSheetId}
        >
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpenSheetId(null)}
            className={`absolute inset-0 bg-black transition-opacity ${
              openSheetId ? 'opacity-40' : 'opacity-0'
            }`}
          />
          <div
            role="dialog"
            aria-label={sheetGroup.title}
            className={`absolute left-0 right-0 bottom-0 bg-kaya-cream border-t border-kaya-warm-dark/60 rounded-t-2xl shadow-xl transform transition-transform duration-200 ${
              openSheetId ? 'translate-y-0' : 'translate-y-full'
            }`}
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
          >
            <div className="flex items-center justify-between px-5 pt-3 pb-2">
              <div className="w-10 h-1 rounded-full bg-kaya-warm-dark/60 mx-auto" />
            </div>
            <div className="flex items-center justify-between px-5 pb-2">
              <div className="text-[15px] font-display font-bold">{sheetGroup.title}</div>
              <button
                type="button"
                onClick={() => setOpenSheetId(null)}
                aria-label="Close"
                className="w-8 h-8 rounded-full bg-white border border-kaya-warm-dark text-kaya-chocolate text-sm flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            <nav className="px-3 pb-4 max-h-[70vh] overflow-y-auto space-y-0.5">
              {sheetGroup.kind === 'sheet'
                ? sheetGroup.items.map((item) => {
                    const active = isActive(item.path);
                    return (
                      <Link
                        key={item.path}
                        href={item.path}
                        onClick={() => setOpenSheetId(null)}
                        className={`w-full flex items-center gap-3 px-3 py-3 rounded-kaya-sm text-[14px] transition-colors ${
                          active
                            ? 'bg-kaya-chocolate text-white font-semibold'
                            : 'text-kaya-chocolate hover:bg-white font-medium'
                        }`}
                      >
                        <span className="text-lg leading-none">{item.icon}</span>
                        <span className="text-left flex-1 truncate">{item.label}</span>
                        {item.soon && (
                          <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                            active ? 'bg-white/20 text-kaya-gold-light' : 'bg-kaya-warm-dark/60 text-kaya-sand'
                          }`}>Soon</span>
                        )}
                      </Link>
                    );
                  })
                : sidebar.map(renderSidebarRow)}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline Back button used at both ends of {children} on every non-home
// page. Same look top + bottom — only the vertical margins change so
// the top instance sits flush under the page header and the bottom
// instance gets breathing room from the last content card.
function BackBar({ onBack, placement }: { onBack: () => void; placement: 'top' | 'bottom' }) {
  const wrap = placement === 'top'
    ? 'mt-3 mb-4 px-4 lg:px-8'
    : 'mt-8 px-4 lg:px-8 pb-2 lg:pb-12';
  return (
    <div className={wrap}>
      <div className="mx-auto max-w-md lg:max-w-3xl">
        <button
          type="button"
          onClick={onBack}
          aria-label="Go back to previous page"
          className="w-full flex items-center justify-center gap-2 h-12 lg:h-14 rounded-kaya bg-white border-2 border-kaya-warm-dark text-kaya-chocolate font-display font-extrabold text-[14px] lg:text-[15px] hover:bg-kaya-warm active:scale-[0.99] transition-all shadow-sm"
        >
          <span className="text-base leading-none">←</span>
          <span>Back</span>
        </button>
      </div>
    </div>
  );
}
