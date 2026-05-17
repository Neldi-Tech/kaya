'use client';

// Bottom tab bar for the Pantry section: Kaya · Home · List ·
// Browse · Meals · Budget · Soko. Mobile-only; desktop reaches
// the same routes via the parent sidebar in AppShell.
//
// First tab is "Kaya" → /dashboard, the global app home. It comes
// before the section's own "Home" (/pantry, the grocery home) so a
// user deep inside Pantry can escape back to Kaya without finding
// the small chevron up at the top header.
//
// "Browse" → /pantry/directory (the catalog of staples + foods).
// "Meals"  → /pantry/meals (the 7-day food timetable, replacing
//             the old "Coming soon" stub).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

// Tab bar is intentionally tight on slots — the Household design proposal
// (v1.1, 2026-05-17) calls for Browse/Meals/Soko to collapse under a
// "More" sheet once the new modules ship. While we coexist with the
// legacy /pantry/list route, Purchase takes its slot in the bar and
// List remains reachable via Pantry home + direct URL.
//
// `parentOnly: true` filters the tab out for helpers. Budget is the
// only one today — household money policy (cap + spend) stays on the
// parent side.
const TABS = [
  { path: '/home',               icon: '🏠', label: 'Kaya',     match: 'kaya' as const,   parentOnly: false },
  { path: '/pantry',             icon: '🛒', label: 'Home',     match: 'exact' as const,  parentOnly: false },
  { path: '/pantry/people',      icon: '🤝', label: 'People',   match: 'prefix' as const, parentOnly: false },
  { path: '/pantry/purchase',    icon: '🧾', label: 'Purchase', match: 'prefix' as const, parentOnly: false },
  { path: '/pantry/outdoor',     icon: '🌿', label: 'Outdoor',  match: 'prefix' as const, parentOnly: false },
  { path: '/pantry/drivers',     icon: '🚗', label: 'Drivers',  match: 'prefix' as const, parentOnly: false },
  { path: '/pantry/finances',    icon: '💰', label: 'Finances', match: 'prefix' as const, parentOnly: true  },
  { path: '/pantry/directory',   icon: '🧺', label: 'Browse',   match: 'prefix' as const, parentOnly: false },
  { path: '/pantry/meals',       icon: '🍽️', label: 'Meals',    match: 'prefix' as const, parentOnly: false },
  { path: '/pantry/budget',      icon: '⚙️', label: 'Budget',   match: 'prefix' as const, parentOnly: true  },
  { path: '/pantry/suppliers',   icon: '🏪', label: 'Soko',     match: 'prefix' as const, parentOnly: false },
];

export default function PantryTabBar() {
  const pathname = usePathname() || '';
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';
  const visibleTabs = TABS.filter((t) => !t.parentOnly || isParent);
  const isActive = (path: string, match: 'exact' | 'prefix' | 'list-prefix' | 'kaya') => {
    // The Kaya tab never lights up inside /pantry — it's the escape
    // hatch back to the global home, not a state of the section.
    if (match === 'kaya') return false;
    if (match === 'exact') return pathname === path;
    if (match === 'list-prefix') return pathname.startsWith('/pantry/list');
    return pathname.startsWith(path);
  };
  return (
    <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper border-t border-hive-line z-30 lg:hidden safe-bottom">
      <div className="flex items-center px-1.5 pt-2 pb-4">
        {visibleTabs.map((t) => {
          const active = isActive(t.path, t.match);
          return (
            <Link
              key={t.path}
              href={t.path}
              className="flex-1 flex flex-col items-center gap-1 py-1.5 font-nunito font-bold text-[10px] no-underline"
            >
              <span className={`w-7 h-7 rounded-[10px] flex items-center justify-center text-base transition-colors ${
                active ? 'bg-pantry-leaf text-white' : 'bg-hive-cream text-hive-muted'
              }`}>
                {t.icon}
              </span>
              <span className={active ? 'text-pantry-leaf-dk' : 'text-hive-muted'}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
