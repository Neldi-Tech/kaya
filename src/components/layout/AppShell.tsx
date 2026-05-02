'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import GuestBanner from './GuestBanner';

type NavItem = { path: string; icon: string; label: string; mobileLabel?: string };

const PARENT_PRIMARY: NavItem[] = [
  { path: '/dashboard', icon: '🏠', label: 'Home',           mobileLabel: 'Home' },
  { path: '/rate',      icon: '📋', label: 'Rate routines',  mobileLabel: 'Rate' },
  { path: '/award',     icon: '🎖️', label: 'Award points',   mobileLabel: 'Award' },
  { path: '/meetings',  icon: '👨‍👩‍👧‍👦', label: 'Family meeting', mobileLabel: 'Meet' },
  { path: '/rewards',   icon: '🎁', label: 'Rewards',        mobileLabel: 'Rewards' },
];

const PARENT_INSIGHTS: NavItem[] = [
  { path: '/reports',  icon: '📊', label: 'Reports' },
  { path: '/profiles', icon: '👧', label: 'Kid profiles' },
  { path: '/badges',   icon: '🏆', label: 'Badges' },
];

const HELPER_NAV: NavItem[] = [
  { path: '/dashboard', icon: '🏠', label: 'Home',  mobileLabel: 'Home' },
  { path: '/rate',      icon: '📋', label: 'Rate',  mobileLabel: 'Rate' },
  { path: '/profiles',  icon: '👧', label: 'Kids',  mobileLabel: 'Kids' },
];

const KID_NAV: NavItem[] = [
  { path: '/kid',     icon: '🏠', label: 'Home',    mobileLabel: 'Home' },
  { path: '/badges',  icon: '🏆', label: 'Badges',  mobileLabel: 'Badges' },
  { path: '/rewards', icon: '🎁', label: 'Rewards', mobileLabel: 'Rewards' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children: kids } = useFamily();

  const role = profile?.role || 'parent';
  const mobileNav: NavItem[] =
    role === 'kid' ? KID_NAV : role === 'helper' ? HELPER_NAV : PARENT_PRIMARY;

  const sidebarSections =
    role === 'kid'
      ? [{ items: KID_NAV }]
      : role === 'helper'
      ? [{ items: HELPER_NAV }]
      : [{ items: PARENT_PRIMARY }, { title: 'Insights', items: PARENT_INSIGHTS }];

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
        <button
          onClick={() => router.push('/')}
          className="px-5 pt-6 pb-5 flex items-center gap-2.5 hover:opacity-80 transition-opacity text-left"
          aria-label="Go to ourkaya.com"
        >
          <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light text-kaya-gold-light flex items-center justify-center font-display font-bold text-base">K</div>
          <span className="font-display font-bold text-lg tracking-tight">Kaya</span>
        </button>

        {(family || role !== 'kid') && (
          <div className="px-4 mb-5">
            <button
              onClick={() => router.push('/settings')}
              className="w-full bg-white border border-kaya-warm-dark rounded-kaya p-3 flex items-center gap-2.5 hover:border-kaya-chocolate transition-colors text-left"
            >
              <div className="w-9 h-9 rounded-[10px] bg-kaya-gold-light flex items-center justify-center text-base shrink-0">🏡</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-bold truncate">{family?.name || 'Your family'}</div>
                <div className="text-[11px] text-kaya-sand">
                  {kids.length} {kids.length === 1 ? 'kid' : 'kids'} · {role.charAt(0).toUpperCase() + role.slice(1)}
                </div>
              </div>
              <span className="text-kaya-sand text-xs">⌄</span>
            </button>
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
                  <button
                    key={item.path}
                    onClick={() => router.push(item.path)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-kaya-sm text-[13px] transition-colors ${
                      active
                        ? 'bg-kaya-chocolate text-white font-semibold'
                        : 'text-kaya-chocolate hover:bg-white font-medium'
                    }`}
                  >
                    <span className="text-base leading-none">{item.icon}</span>
                    <span className="text-left flex-1 truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-kaya-warm-dark/60">
          <button
            onClick={() => router.push('/settings')}
            className="w-full flex items-center gap-3 px-2 py-2 rounded-kaya-sm hover:bg-white text-kaya-chocolate text-left"
          >
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-xs text-white font-black shadow-sm shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-bold truncate">{profile?.displayName || 'You'}</div>
              <div className="text-[10px] text-kaya-sand">Settings</div>
            </div>
            <span className="text-kaya-sand text-xs">⚙</span>
          </button>
        </div>
      </aside>

      {/* ── Right column (shifted right of sidebar at lg+) ── */}
      <div className="lg:pl-[260px]">
        <GuestBanner />
        {/* Mobile top header */}
        <div className="lg:hidden sticky top-0 z-20 bg-kaya-cream/95 backdrop-blur-md border-b border-kaya-warm-dark/50 safe-top">
          <div className="mx-auto max-w-md flex items-center justify-between px-4 h-14">
            <button
              onClick={() => router.push('/')}
              className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
              aria-label="Go to ourkaya.com"
            >
              <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light flex items-center justify-center text-base">🏠</div>
              <span className="font-display text-lg font-black tracking-tight">Kaya</span>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => router.push('/notifications')}
                className="w-9 h-9 rounded-full bg-white border border-kaya-warm-dark flex items-center justify-center text-sm hover:bg-kaya-warm transition-colors"
                aria-label="Notifications"
              >
                🔔
              </button>
              <button
                onClick={() => router.push('/settings')}
                className="w-9 h-9 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-xs text-white font-black shadow-sm"
                aria-label="Settings"
              >
                {initial}
              </button>
            </div>
          </div>
        </div>

        {/* Desktop top bar */}
        <header className="hidden lg:flex sticky top-0 z-20 h-14 px-8 items-center justify-between bg-kaya-cream/85 backdrop-blur border-b border-kaya-warm-dark/60">
          <div className="text-xs text-kaya-sand">
            <span className="font-bold uppercase tracking-[0.14em]">{today}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/award')}
              className="h-9 px-3.5 rounded-kaya-sm border border-kaya-warm-dark text-[12px] font-semibold hover:bg-white transition-colors"
            >
              ＋ Award points
            </button>
            <button
              onClick={() => router.push('/notifications')}
              className="w-9 h-9 rounded-full border border-kaya-warm-dark flex items-center justify-center text-sm hover:bg-white transition-colors"
              aria-label="Notifications"
            >
              🔔
            </button>
          </div>
        </header>

        {/* Content */}
        <div className="pb-24 lg:pb-0">{children}</div>
      </div>

      {/* Mobile bottom nav (lg- only) */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-kaya-cream/95 backdrop-blur-md border-t border-kaya-warm-dark/50 safe-bottom z-20 lg:hidden">
        <div className="flex justify-around px-2 pt-1.5 pb-5">
          {mobileNav.map((item) => {
            const active = isActive(item.path);
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-opacity ${
                  active ? 'opacity-100' : 'opacity-40'
                }`}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span className="text-[10px] font-extrabold">{item.mobileLabel || item.label}</span>
                {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
