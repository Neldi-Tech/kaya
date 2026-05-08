'use client';

// Bottom tab bar specific to the Hive section: Hive · Quests · Wallet ·
// Insights. Renders only inside /hive/* routes — the main app keeps its
// own bottom nav untouched. Visible on mobile (lg-); on desktop the Hive
// nav lives in the existing sidebar so this stays out of the way.

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { path: '/hive',          icon: '🍯', label: 'Hive' },
  { path: '/hive/quests',   icon: '🏆', label: 'Quests' },
  { path: '/hive/wallet',   icon: '💰', label: 'Wallet' },
  { path: '/hive/insights', icon: '📊', label: 'Insights' },
];

export default function HiveTabBar() {
  const pathname = usePathname() || '';
  // Active rules: exact match for the Home tab, prefix match for the
  // others so /hive/wallet and /hive/wallet/foo both highlight Wallet.
  const isActive = (path: string) =>
    path === '/hive' ? pathname === '/hive' : pathname.startsWith(path);
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper border-t border-hive-line z-30 lg:hidden safe-bottom">
      <div className="flex items-center px-1.5 pt-2 pb-4">
        {TABS.map((t) => {
          const active = isActive(t.path);
          return (
            <Link
              key={t.path}
              href={t.path}
              className="flex-1 flex flex-col items-center gap-1 py-1.5 font-nunito font-bold text-[10px] no-underline"
            >
              <span className={`w-7 h-7 rounded-[10px] flex items-center justify-center text-base transition-colors ${
                active ? 'bg-hive-honey text-white' : 'bg-hive-cream text-hive-muted'
              }`}>
                {t.icon}
              </span>
              <span className={active ? 'text-hive-honey-dk' : 'text-hive-muted'}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
