'use client';

// Bottom tab bar for the Business section — mirrors HiveTabBar / PantryTabBar.
// Five tabs: escape to Kaya home, then the four Business surfaces.
// Report is reachable from the Home page rather than a tab slot (keeps 5 tabs).

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { path: '/dashboard',        icon: '🏠', label: 'Kaya',   external: true  },
  { path: '/business',         icon: '🌱', label: 'Home'                    },
  { path: '/business/assets',  icon: '🏷️', label: 'Assets'                  },
  { path: '/business/sales',   icon: '💼', label: 'Sales'                   },
  { path: '/business/costs',   icon: '🧾', label: 'Costs'                   },
];

export default function BusinessTabBar() {
  const pathname = usePathname() || '';
  const isActive = (path: string, external?: boolean) => {
    if (external) return false;
    return path === '/business' ? pathname === '/business' : pathname.startsWith(path);
  };
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper border-t border-hive-line z-30 lg:hidden safe-bottom">
      <div className="flex items-center px-1.5 pt-2 pb-4">
        {TABS.map((t) => {
          const active = isActive(t.path, t.external);
          return (
            <Link
              key={t.path}
              href={t.path}
              className="flex-1 flex flex-col items-center gap-1 py-1.5 font-nunito font-bold text-[10px] no-underline"
            >
              <span className={`w-7 h-7 rounded-[10px] flex items-center justify-center text-base transition-colors ${
                active
                  ? 'bg-hive-green text-white'
                  : 'bg-hive-cream text-hive-muted'
              }`}>
                {t.icon}
              </span>
              <span className={active ? 'text-hive-green' : 'text-hive-muted'}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
