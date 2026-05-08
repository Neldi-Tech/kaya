'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import GuestBanner from './GuestBanner';

type NavItem = { path: string; icon: string; label: string; mobileLabel?: string; soon?: boolean };

const PARENT_PRIMARY: NavItem[] = [
  { path: '/dashboard', icon: '🏠', label: 'Home',           mobileLabel: 'Home' },
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
  // The Hive · parent-side surface (kid wallets, approvals come in PR-Hive-B).
  { path: '/hive',        icon: '🍯', label: 'The Hive' },
];

const FUN_NAV: NavItem[] = [
  { path: '/videos', icon: '📺', label: 'Videos', soon: true },
  { path: '/games',  icon: '🎮', label: 'Games',  soon: true },
];

const HELPER_NAV: NavItem[] = [
  { path: '/dashboard', icon: '🏠', label: 'Home',   mobileLabel: 'Home' },
  { path: '/rate',      icon: '📋', label: 'Rate',   mobileLabel: 'Rate' },
  { path: '/award',     icon: '🎖️', label: 'Award',  mobileLabel: 'Award' },
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

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { profile } = useAuth();
  const { family, children: kids } = useFamily();

  const role = profile?.role || 'parent';
  const mobileNav: NavItem[] =
    role === 'kid' ? KID_NAV : role === 'helper' ? HELPER_NAV : PARENT_PRIMARY;

  // Inside /hive/* the section renders its own bottom tab bar
  // (HiveTabBar). Suppress AppShell's mobile bottom nav so the two
  // don't stack and double the safe-area padding.
  const inHiveSection = !!pathname?.startsWith('/hive');

  const sidebarSections =
    role === 'kid'
      ? [{ items: KID_NAV }, { title: 'Fun', items: KID_FUN_NAV }]
      : role === 'helper'
      ? [{ items: HELPER_NAV }]
      : [
          { items: PARENT_PRIMARY },
          { title: 'Insights', items: PARENT_INSIGHTS },
          { title: 'Fun', items: FUN_NAV },
        ];

  const isActive = (path: string) =>
    pathname === path || (path !== '/dashboard' && pathname?.startsWith(path + '/'));

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
          href="/"
          aria-label="Go to ourkaya.com"
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
          {sidebarSections.map((section, sIdx) => (
            <div key={sIdx}>
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
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-kaya-sm text-[13px] transition-colors ${
                      active
                        ? 'bg-kaya-chocolate text-white font-semibold'
                        : 'text-kaya-chocolate hover:bg-white font-medium'
                    }`}
                  >
                    <span className="text-base leading-none">{item.icon}</span>
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
          <div className="mx-auto max-w-md flex items-center justify-between px-4 h-14">
            <Link
              href="/"
              aria-label="Go to ourkaya.com"
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
            >
              <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light flex items-center justify-center text-base">🏠</div>
              <span className="font-display text-lg font-black tracking-tight">Kaya</span>
            </Link>
            <div className="flex items-center gap-2">
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
            hidden under the nav. */}
        <div
          className="lg:pb-0"
          style={{ paddingBottom: 'calc(6rem + env(safe-area-inset-bottom))' }}
        >
          {children}
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
          inHiveSection ? 'hidden' : ''
        }`}
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          transform: 'translateZ(0)',
        }}
      >
        <div className="mx-auto max-w-md flex justify-around px-2 pt-1.5 pb-2">
          {mobileNav.map((item) => {
            const active = isActive(item.path);
            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-opacity ${
                  active ? 'opacity-100' : 'opacity-40'
                }`}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span className="text-[10px] font-extrabold">{item.mobileLabel || item.label}</span>
                {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
