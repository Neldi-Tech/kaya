'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import GuestBanner from './GuestBanner';

type NavItem = { path: string; icon: string; label: string; mobileLabel?: string; soon?: boolean; disabled?: boolean };
type NavSection = { title?: string; href?: string; items: NavItem[] };

// Mobile bottom nav uses category-level "groups" rather than the flat
// list of routes the desktop sidebar shows. Each group is one of:
//   - link  : taps go straight to a route (e.g. Home → /dashboard,
//             House → /pantry, Hive → /hive). For groups with their
//             own section tab bar (Pantry, Hive) this avoids a
//             redundant intermediate menu.
//   - sheet : taps open a slide-up sheet listing the group's routes.
//             Used for groups that don't (yet) have a single landing
//             page — Insights, Fun.
//   - soon  : non-interactive placeholder with a SOON pill, for
//             groups the feature hasn't shipped yet (Directory).
// `activePrefixes` lets a link group light up while the user is on a
// related route — e.g. Home stays active on /rate, /award, /meetings.
type MobileGroup =
  | { kind: 'link'; id: string; path: string; icon: string; label: string; activePrefixes?: string[] }
  | { kind: 'sheet'; id: string; icon: string; label: string; title: string; sections: NavSection[] }
  | { kind: 'soon'; id: string; icon: string; label: string };

// Home · the dashboard landing — module overview + family score.
const PARENT_HOME: NavItem[] = [
  { path: '/dashboard', icon: '🏠', label: 'Home', mobileLabel: 'Home' },
];

// Kaya · the point-system foundation — rate routines, award points,
// run the weekly family meeting, manage rewards. The core parenting
// loop the rest of the app is built around, so it gets its own
// top-level slot rather than living only as dashboard cards.
const KAYA_NAV: NavItem[] = [
  { path: '/rate',      icon: '📋', label: 'Rate routines',  mobileLabel: 'Rate' },
  { path: '/award',     icon: '🎖️', label: 'Award points',   mobileLabel: 'Award' },
  { path: '/meetings',  icon: '👨‍👩‍👧‍👦', label: 'Family meeting', mobileLabel: 'Meet' },
  { path: '/rewards',   icon: '🎁', label: 'Rewards',        mobileLabel: 'Rewards' },
];

const PARENT_INSIGHTS: NavItem[] = [
  { path: '/reports',     icon: '📊', label: 'Reports' },
  { path: '/profiles',    icon: '👧', label: 'Kid profiles' },
  { path: '/badges',      icon: '🏆', label: 'Badges' },
  { path: '/family-tree', icon: '🌳', label: 'Family tree' },
];

const PARENT_HIVE_NAV: NavItem[] = [
  { path: '/hive',              icon: '🍯', label: 'The Hive' },
  { path: '/parent/approvals',  icon: '✅', label: 'Approvals' },
  { path: '/parent/rates',      icon: '⚖️', label: 'Rates & policy' },
  { path: '/parent/hive-deposit', icon: '💸', label: 'Deposit cash' },
];

// Household section · adult-facing surfaces that aren't about kids
// directly. Pantry today; The Roster (suppliers directory) and
// household chats land here next.
const PARENT_HOUSEHOLD: NavItem[] = [
  { path: '/pantry', icon: '🛒', label: 'The Pantry' },
];

// Directory · the Yellow Pages — the family's service directory
// (plumber, pharmacy, mama wa kazi, school). Live now.
const PARENT_DIRECTORY: NavItem[] = [
  { path: '/directory', icon: '📒', label: 'Yellow Pages' },
];

const FUN_NAV: NavItem[] = [
  { path: '/videos', icon: '📺', label: 'Videos', soon: true },
  { path: '/games',  icon: '🎮', label: 'Games',  soon: true },
];

const HELPER_NAV: NavItem[] = [
  { path: '/dashboard', icon: '🏠', label: 'Home',   mobileLabel: 'Home' },
  { path: '/rate',      icon: '📋', label: 'Rate',   mobileLabel: 'Rate' },
  { path: '/award',     icon: '🎖️', label: 'Award',  mobileLabel: 'Award' },
  { path: '/pantry',    icon: '🛒', label: 'Pantry', mobileLabel: 'Pantry' },
  { path: '/profiles',  icon: '👧', label: 'Kids',   mobileLabel: 'Kids' },
];

const KID_NAV: NavItem[] = [
  { path: '/kid',     icon: '🏠', label: 'Home',    mobileLabel: 'Home' },
  // The Hive · kid's three-layer wallet, conversions, goals.
  { path: '/hive',    icon: '🍯', label: 'Hive',    mobileLabel: 'Hive' },
  { path: '/badges',  icon: '🏆', label: 'Badges',  mobileLabel: 'Badges' },
  { path: '/rewards', icon: '🎁', label: 'Rewards', mobileLabel: 'Rewards' },
];

const KID_FUN_NAV: NavItem[] = [
  { path: '/videos', icon: '📺', label: 'Videos', mobileLabel: 'Videos', soon: true },
  { path: '/games',  icon: '🎮', label: 'Games',  mobileLabel: 'Games',  soon: true },
];

// Seven top-level groups for parents on mobile. These seven slots
// are fixed for now — a "pick what shows here" customiser is a
// planned follow-up. Order matches the desktop sidebar sections.
//   1. Home   — dashboard: module overview + family score
//   2. Kaya   — point-system sheet (Rate / Award / Meet / Rewards)
//   3. Pantry — Household section (lists, staples, meals, suppliers)
//   4. Hive   — The Hive section (wallets, approvals, rates, deposit)
//   5. Pages  — Yellow Pages service directory
//   6. Stats  — Insights sheet (Reports, Profiles, Badges, Family tree)
//   7. Fun    — Videos / Games sheet
const PARENT_MOBILE_GROUPS: MobileGroup[] = [
  {
    kind: 'link',
    id: 'home',
    path: '/dashboard',
    icon: '🏠',
    label: 'Home',
    // Notifications conceptually belong to Home. Rate/Award/Meet/
    // Rewards moved to the Kaya group — the Kaya sheet lights up on
    // those routes automatically since they're its sheet items.
    activePrefixes: ['/notifications'],
  },
  {
    kind: 'sheet',
    id: 'kaya',
    icon: '⭐',
    label: 'Kaya',
    title: 'Kaya · point system',
    sections: [{ items: KAYA_NAV }],
  },
  { kind: 'link', id: 'pantry', path: '/pantry', icon: '🛒', label: 'Pantry' },
  {
    kind: 'link',
    id: 'hive',
    path: '/hive',
    icon: '🍯',
    label: 'Hive',
    // Parent-only Hive routes that live outside /hive/* but belong
    // to the Hive group conceptually.
    activePrefixes: ['/parent/approvals', '/parent/rates', '/parent/hive-deposit'],
  },
  { kind: 'link', id: 'directory', path: '/directory', icon: '📒', label: 'Pages' },
  {
    kind: 'sheet',
    id: 'insights',
    icon: '📊',
    label: 'Stats',
    title: 'Insights',
    sections: [{ items: PARENT_INSIGHTS }],
  },
  {
    kind: 'sheet',
    id: 'fun',
    icon: '🎮',
    label: 'Fun',
    title: 'Fun',
    sections: [{ items: FUN_NAV }],
  },
];

// Kid mobile groups — 4 primary routes plus a Fun sheet so Videos/Games
// are reachable on mobile.
const KID_MOBILE_GROUPS: MobileGroup[] = [
  { kind: 'link', id: 'home',    path: '/kid',     icon: '🏠', label: 'Home' },
  { kind: 'link', id: 'hive',    path: '/hive',    icon: '🍯', label: 'Hive' },
  { kind: 'link', id: 'badges',  path: '/badges',  icon: '🏆', label: 'Badges' },
  { kind: 'link', id: 'rewards', path: '/rewards', icon: '🎁', label: 'Rewards' },
  {
    kind: 'sheet',
    id: 'fun',
    icon: '🎮',
    label: 'Fun',
    title: 'Fun',
    sections: [{ items: KID_FUN_NAV }],
  },
];

// Helper already has full sidebar parity — convert their flat nav to
// link-kind groups so the rendering loop is uniform.
const HELPER_MOBILE_GROUPS: MobileGroup[] = HELPER_NAV.map((item) => ({
  kind: 'link' as const,
  id: item.path,
  path: item.path,
  icon: item.icon,
  label: item.mobileLabel || item.label,
}));

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children: kids } = useFamily();

  const role = profile?.role || 'parent';
  // Where "home" lives for this role. Used by the Kaya logo, the
  // mobile top-header back button, and to know when to show that
  // back button at all.
  const homePath = role === 'kid' ? '/kid' : '/dashboard';
  const isAtHome = pathname === homePath;

  // Inside /hive/* OR /pantry/* the section renders its own bottom tab
  // bar. Suppress AppShell's mobile bottom nav so the two don't stack
  // and double the safe-area padding.
  const inHiveSection = !!pathname?.startsWith('/hive');
  const inPantrySection = !!pathname?.startsWith('/pantry');
  const inSectionWithOwnTabBar = inHiveSection || inPantrySection;

  // Desktop sidebar mirrors the mobile 6-group model for parents:
  // Home, Household, The Hive, Insights, Directory, Fun. Section
  // headers carry an `href` when there's a single landing page —
  // clicking "Household" jumps to /pantry, "The Hive" to /hive,
  // matching the mobile group-tap behavior. Insights/Directory/Fun
  // headers stay plain text since they have no single landing page.
  const sidebarSections: NavSection[] =
    role === 'kid'
      ? [{ items: KID_NAV }, { title: 'Fun', items: KID_FUN_NAV }]
      : role === 'helper'
      ? [{ items: HELPER_NAV }]
      : [
          // Desktop sidebar mirrors the 7-slot mobile model.
          { title: 'Home',                         items: PARENT_HOME },
          { title: 'Kaya',                         items: KAYA_NAV },
          { title: 'Pantry',    href: '/pantry',    items: PARENT_HOUSEHOLD },
          { title: 'The Hive',  href: '/hive',      items: PARENT_HIVE_NAV },
          { title: 'Pages',     href: '/directory', items: PARENT_DIRECTORY },
          { title: 'Stats',                        items: PARENT_INSIGHTS },
          { title: 'Fun',                          items: FUN_NAV },
        ];

  // Mobile bottom nav uses the 7-slot model for parents.
  const mobileGroups: MobileGroup[] =
    role === 'kid' ? KID_MOBILE_GROUPS :
    role === 'helper' ? HELPER_MOBILE_GROUPS :
    PARENT_MOBILE_GROUPS;

  // Sheet state: which group's sub-menu is currently open. We also
  // remember the last sheet that was open so the slide-down animation
  // keeps showing its content as it animates off-screen.
  const [openSheetId, setOpenSheetId] = useState<string | null>(null);
  const [lastSheetId, setLastSheetId] = useState<string | null>(null);
  useEffect(() => {
    if (openSheetId) setLastSheetId(openSheetId);
  }, [openSheetId]);

  const sheetGroup = mobileGroups.find(
    (g) => g.kind === 'sheet' && g.id === lastSheetId
  );

  // Close the sheet on route change so it doesn't linger after a tap.
  useEffect(() => {
    setOpenSheetId(null);
  }, [pathname]);

  // Path matching helpers — exact for /dashboard (so it doesn't swallow
  // /dashboard/foo if it ever appears), prefix-match otherwise.
  const isPathActive = (path: string) =>
    pathname === path || (path !== '/dashboard' && pathname?.startsWith(path + '/'));
  const isActive = isPathActive;

  // A link group is active if its path matches OR any of its
  // activePrefixes match. This lets Home stay highlighted on /rate,
  // /award, etc.
  const isLinkGroupActive = (
    g: Extract<MobileGroup, { kind: 'link' }>
  ): boolean => {
    if (isPathActive(g.path)) return true;
    if (g.activePrefixes) {
      for (const p of g.activePrefixes) {
        if (pathname === p || pathname?.startsWith(p + '/')) return true;
      }
    }
    return false;
  };

  // A sheet group is active if any route inside any of its sections
  // matches the current path.
  const isSheetGroupActive = (
    g: Extract<MobileGroup, { kind: 'sheet' }>
  ): boolean =>
    g.sections.some((s) =>
      s.items.some((i) => isPathActive(i.path))
    );

  const initial = profile?.displayName?.[0]?.toUpperCase() || 'U';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <div className="min-h-screen bg-kaya-cream">
      {/* ── Desktop sidebar (lg+) ─────────────────────────── */}
      <aside className="hidden lg:flex fixed top-0 left-0 bottom-0 w-[260px] flex-col border-r border-kaya-warm-dark/60 bg-kaya-cream z-30">
        <Link
          href={homePath}
          aria-label="Go to home"
          className="px-5 pt-6 pb-5 flex items-center gap-2.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light flex items-center justify-center font-display font-bold text-base">K</div>
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
          {sidebarSections.map((section, sIdx) => {
            // A section header is clickable when its NavSection
            // carries an `href`, lighting up like the items beneath it.
            const headerActive = section.href ? isActive(section.href) : false;
            const headerClasses = `pt-3 pb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] ${
              headerActive ? 'text-kaya-chocolate' : 'text-kaya-sand'
            }`;
            return (
              <div key={sIdx}>
                {section.title && (
                  section.href ? (
                    <Link
                      href={section.href}
                      className={`${headerClasses} block hover:text-kaya-chocolate transition-colors`}
                    >
                      {section.title}
                    </Link>
                  ) : (
                    <div className={headerClasses}>{section.title}</div>
                  )
                )}
                {section.items.map((item) => {
                  const active = isActive(item.path);
                  // Disabled items (e.g. Yellow Pages SOON) render as
                  // a non-interactive div instead of a Link.
                  const itemClasses = `w-full flex items-center gap-3 px-3 py-2.5 rounded-kaya-sm text-[13px] transition-colors ${
                    active
                      ? 'bg-kaya-chocolate text-white font-semibold'
                      : item.disabled
                      ? 'text-kaya-sand cursor-not-allowed'
                      : 'text-kaya-chocolate hover:bg-white font-medium'
                  }`;
                  const inner = (
                    <>
                      <span className="text-base leading-none">{item.icon}</span>
                      <span className="text-left flex-1 truncate">{item.label}</span>
                      {item.soon && (
                        <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${
                          active ? 'bg-white/20 text-kaya-gold-light' : 'bg-kaya-warm-dark/60 text-kaya-sand'
                        }`}>Soon</span>
                      )}
                    </>
                  );
                  if (item.disabled) {
                    return (
                      <div
                        key={item.path}
                        aria-disabled="true"
                        className={itemClasses}
                      >
                        {inner}
                      </div>
                    );
                  }
                  return (
                    <Link key={item.path} href={item.path} className={itemClasses}>
                      {inner}
                    </Link>
                  );
                })}
              </div>
            );
          })}
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
        {/* Mobile top header
            Layout:
              [🏠 Kaya logo → home]                       [🔔]  [⚙ avatar]
            The top header is intentionally minimal — Back lives at
            the bottom of every page (just above the section tab
            bar) and Kaya home is the first tab in the section tab
            bars / first item in the main bottom nav, so neither
            needs a slot up here. The Kaya logo still navigates to
            the role's home as a redundant entry point. */}
        <div className="lg:hidden sticky top-0 z-20 bg-kaya-cream/95 backdrop-blur-md border-b border-kaya-warm-dark/50 safe-top">
          <div className="mx-auto max-w-md flex items-center justify-between px-4 h-14 gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Link
                href={homePath}
                aria-label="Go to home"
                className="flex items-center gap-2.5 hover:opacity-80 transition-opacity min-w-0"
              >
                <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light flex items-center justify-center text-base shrink-0">🏠</div>
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

        {/* Content
            Bottom padding clears the fixed mobile bottom nav (~64px tall) PLUS
            the home-indicator safe-area on notched phones, so nothing stays
            hidden under the nav.
            A visible Back button sits inline at BOTH the top and the bottom
            of {children} on every non-home page (mobile + desktop). Two
            copies because a long list buries the bottom one off-screen —
            this way Back is reachable at any scroll position without making
            the button float over content. */}
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

        Anchored with `inset-x-0` instead of `left-1/2 + -translate-x-1/2` —
        a transform on a fixed element causes iOS Safari to jitter when the
        URL bar collapses/expands during scroll. We also drop backdrop-blur
        here for the same reason (the blur layer repaints per-frame on iOS).
        Centering up to max-w-md happens on the INNER row.

        `will-change: transform` and an explicit translateZ promote the nav
        to its own compositor layer so it doesn't flicker on momentum scroll.
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
            // Link group: direct nav.
            if (g.kind === 'link') {
              const active = isLinkGroupActive(g);
              return (
                <Link
                  key={g.id}
                  href={g.path}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl transition-opacity ${
                    active ? 'opacity-100' : 'opacity-40'
                  }`}
                >
                  <span className="text-xl leading-none">{g.icon}</span>
                  <span className="text-[10px] font-extrabold">{g.label}</span>
                  {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
                </Link>
              );
            }
            // Sheet group: opens a slide-up sheet listing this group's
            // sub-modules.
            if (g.kind === 'sheet') {
              const active = isSheetGroupActive(g);
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
                  <span className="text-xl leading-none">{g.icon}</span>
                  <span className="text-[10px] font-extrabold">{g.label}</span>
                  {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
                </button>
              );
            }
            // Soon group: non-interactive placeholder.
            return (
              <button
                key={g.id}
                type="button"
                disabled
                aria-label={`${g.label} (coming soon)`}
                className="flex flex-col items-center gap-0.5 px-1.5 py-1.5 rounded-xl opacity-30 cursor-not-allowed relative"
              >
                <span className="text-xl leading-none">{g.icon}</span>
                <span className="text-[10px] font-extrabold">{g.label}</span>
                <span className="absolute -top-1 right-0 text-[7px] font-black uppercase tracking-wider px-1 py-px rounded-full bg-kaya-warm-dark/70 text-kaya-sand leading-none">
                  Soon
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Mobile sub-menu sheet · slides up from the bottom for the
          currently-tapped sheet group (Insights, Fun, …). The sheet
          DOM is kept mounted while a group has been opened at least
          once so the slide-down animation has content to animate. */}
      {sheetGroup && sheetGroup.kind === 'sheet' && (
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
            <nav className="px-3 pb-4 max-h-[70vh] overflow-y-auto">
              {sheetGroup.sections.map((section, sIdx) => (
                <div key={sIdx} className="mb-2">
                  {section.title && (
                    <div className="pt-3 pb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-kaya-sand">
                      {section.title}
                    </div>
                  )}
                  {section.items.map((item) => {
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
                  })}
                </div>
              ))}
            </nav>
          </div>
        </div>
      )}
    </div>
  );
}

// Inline Back button used at both ends of {children} on every
// non-home page. Same look top + bottom — the only thing that
// changes is the vertical margins so the top instance sits flush
// under the page header and the bottom instance gets breathing
// room from the last content card.
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
