'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import GuestBanner from './GuestBanner';

const NAV_ITEMS = [
  { path: '/dashboard', icon: '🏠', label: 'Home' },
  { path: '/rate', icon: '📋', label: 'Rate' },
  { path: '/award', icon: '🎖️', label: 'Award' },
  { path: '/meetings', icon: '👨‍👩‍👧‍👦', label: 'Meet' },
  { path: '/rewards', icon: '🎁', label: 'Rewards' },
];

const HELPER_NAV = [
  { path: '/dashboard', icon: '🏠', label: 'Home' },
  { path: '/rate', icon: '📋', label: 'Rate' },
  { path: '/profiles', icon: '👧', label: 'Kids' },
];

const KID_NAV = [
  { path: '/kid', icon: '🏠', label: 'Home' },
  { path: '/badges', icon: '🏆', label: 'Badges' },
  { path: '/rewards', icon: '🎁', label: 'Rewards' },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile } = useAuth();

  const role = profile?.role || 'parent';
  const nav = role === 'kid' ? KID_NAV : role === 'helper' ? HELPER_NAV : NAV_ITEMS;

  return (
    <div className="min-h-screen bg-kaya-cream">
      <GuestBanner />
      {/* Header */}
      <div className="sticky top-0 z-20 bg-kaya-cream/95 backdrop-blur-md border-b border-kaya-warm-dark/50 safe-top">
        <div className="flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-[10px] bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light flex items-center justify-center text-base">
              🏠
            </div>
            <span className="font-display text-lg font-black tracking-tight">Kaya</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => router.push('/notifications')}
              className="w-9 h-9 rounded-full bg-white border border-kaya-warm-dark flex items-center justify-center text-sm hover:bg-kaya-warm transition-colors"
            >
              🔔
            </button>
            <button
              onClick={() => router.push('/settings')}
              className="w-9 h-9 rounded-full bg-gradient-to-br from-kaya-gold to-kaya-gold-dark flex items-center justify-center text-xs text-white font-black shadow-sm"
            >
              {profile?.displayName?.[0]?.toUpperCase() || 'U'}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="pb-24">
        {children}
      </div>

      {/* Bottom Nav */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-kaya-cream/95 backdrop-blur-md border-t border-kaya-warm-dark/50 safe-bottom z-20">
        <div className="flex justify-around px-2 pt-1.5 pb-5">
          {nav.map((item) => {
            const active = pathname === item.path || pathname?.startsWith(item.path + '/');
            return (
              <button
                key={item.path}
                onClick={() => router.push(item.path)}
                className={`flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-xl transition-opacity ${
                  active ? 'opacity-100' : 'opacity-40'
                }`}
              >
                <span className="text-xl leading-none">{item.icon}</span>
                <span className="text-[10px] font-extrabold">{item.label}</span>
                {active && <div className="w-1 h-1 rounded-full bg-kaya-gold mt-0.5" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
