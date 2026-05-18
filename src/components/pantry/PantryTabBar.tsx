'use client';

// Bottom tab bar for the Pantry section — 7 primary slots + a "More"
// sheet for secondary surfaces. Mobile-only; desktop reaches everything
// via the AppShell sidebar.
//
// Primary (7 slots): Kaya · Home · 5 request modules · More.
// Payroll lives in More (self-service surface, helpers reach their own
// pay there). Browse / Meals / Soko / Finances / Budget / People are
// also in More — every secondary surface in one place.
//
// Parent-only items in the More sheet are filtered out for helpers.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

type TabMatch = 'exact' | 'prefix' | 'list-prefix' | 'kaya';
interface TabDef {
  path: string;
  icon: string;
  label: string;
  match: TabMatch;
  parentOnly?: boolean;
  /** Used only by More items: a short note that appears under the label
   *  in the sheet to disambiguate similar emojis (the 🤝 collision
   *  between People and Payroll is the obvious one). */
  sub?: string;
}

// Primary slots — fits 7 across a phone tab bar without overflow.
// Order: escape hatch back to Kaya · section home · five request
// modules · the More sheet.
const PRIMARY_TABS: TabDef[] = [
  { path: '/home',             icon: '🏠',  label: 'Kaya',     match: 'kaya' },
  { path: '/pantry',           icon: '🛒',  label: 'Home',     match: 'exact' },
  { path: '/pantry/purchase',  icon: '🧾',  label: 'Purchase', match: 'prefix' },
  { path: '/pantry/outdoor',   icon: '🌿',  label: 'Outdoor',  match: 'prefix' },
  { path: '/pantry/drivers',   icon: '🚗',  label: 'Drivers',  match: 'prefix' },
  { path: '/pantry/utility',   icon: '⚡',  label: 'Utility',  match: 'prefix' },
];

// More sheet — everything else under Household. Parent-only items
// filter out for helpers. People + Payroll are useful for both roles;
// Finances + Budget are parent-only.
const MORE_TABS: TabDef[] = [
  { path: '/pantry/payroll',   icon: '🤝', label: 'Payroll',          match: 'prefix', sub: 'Self · advances & loans' },
  { path: '/pantry/people',    icon: '🤝', label: 'People',           match: 'prefix', sub: 'Helpers + workplans' },
  { path: '/pantry/browse',    icon: '🧺', label: 'Browse Catalogue', match: 'prefix', sub: 'Pantry + Others' },
  { path: '/pantry/meals',     icon: '🍽️', label: 'Meals',            match: 'prefix', sub: '7-day timetable' },
  { path: '/pantry/suppliers', icon: '🏪', label: 'Soko',             match: 'prefix', sub: 'Suppliers' },
  { path: '/pantry/finances',  icon: '💰', label: 'Finances',         match: 'prefix', parentOnly: true, sub: 'Money roll-up' },
  { path: '/pantry/budget',    icon: '⚙️', label: 'Budget',           match: 'prefix', parentOnly: true, sub: 'Per-module caps' },
];

const isActive = (pathname: string, path: string, match: TabMatch): boolean => {
  if (match === 'kaya') return false;
  if (match === 'exact') return pathname === path;
  if (match === 'list-prefix') return pathname.startsWith('/pantry/list');
  return pathname.startsWith(path);
};

export default function PantryTabBar() {
  const pathname = usePathname() || '';
  const { profile } = useAuth();
  const isParent = profile?.role === 'parent';

  const visibleMore = MORE_TABS.filter((t) => !t.parentOnly || isParent);
  const moreActive = visibleMore.some((t) => isActive(pathname, t.path, t.match));

  const [sheetOpen, setSheetOpen] = useState(false);
  // Close the sheet whenever the user lands on a new route (so tapping
  // an item inside the sheet auto-dismisses it).
  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      setSheetOpen(false);
      lastPath.current = pathname;
    }
  }, [pathname]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSheetOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen]);

  return (
    <>
      {/* ── More sheet (overlay) ── */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-40 bg-hive-navy/40 lg:hidden"
          onClick={() => setSheetOpen(false)}
          aria-hidden="true"
        />
      )}
      <div
        className={`fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 lg:hidden transition-transform duration-200 ${sheetOpen ? 'translate-y-0' : 'translate-y-full pointer-events-none'}`}
        aria-hidden={!sheetOpen}
      >
        <div className="bg-hive-paper border-t border-hive-line rounded-t-3xl shadow-2xl pb-24 pt-2">
          <div className="flex justify-center pt-1 pb-2">
            <div className="w-12 h-1 rounded-full bg-hive-line"></div>
          </div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted text-center mb-2">
            More
          </p>
          <div className="px-3">
            {visibleMore.map((t) => {
              const active = isActive(pathname, t.path, t.match);
              return (
                <Link
                  key={t.path}
                  href={t.path}
                  onClick={() => setSheetOpen(false)}
                  className={`flex items-center gap-3 px-3 py-3 rounded-2xl no-underline ${active ? 'bg-pantry-leaf-soft' : ''}`}
                >
                  <span className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${active ? 'bg-pantry-leaf text-white' : 'bg-hive-cream text-hive-navy'}`}>
                    {t.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className={`font-nunito font-extrabold text-sm ${active ? 'text-pantry-leaf-dk' : 'text-hive-navy'}`}>
                      {t.label}
                      {t.parentOnly && (
                        <span className="ml-2 text-[9px] font-extrabold tracking-[1px] uppercase bg-hive-cream border border-hive-line text-hive-muted px-1.5 py-0.5 rounded">
                          Parent
                        </span>
                      )}
                    </div>
                    {t.sub && <div className="text-[11px] text-hive-muted font-bold mt-0.5">{t.sub}</div>}
                  </div>
                  <span className="text-hive-muted">›</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Primary tab bar (always visible) ── */}
      <div className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md bg-hive-paper border-t border-hive-line z-30 lg:hidden safe-bottom">
        <div className="flex items-center px-1.5 pt-2 pb-4">
          {PRIMARY_TABS.map((t) => {
            const active = isActive(pathname, t.path, t.match);
            return (
              <Link
                key={t.path}
                href={t.path}
                onClick={() => setSheetOpen(false)}
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
          <button
            type="button"
            onClick={() => setSheetOpen((v) => !v)}
            className="flex-1 flex flex-col items-center gap-1 py-1.5 font-nunito font-bold text-[10px]"
            aria-expanded={sheetOpen}
            aria-label="More Household surfaces"
          >
            <span className={`w-7 h-7 rounded-[10px] flex items-center justify-center text-base transition-colors ${
              sheetOpen || moreActive ? 'bg-pantry-leaf text-white' : 'bg-hive-cream text-hive-muted'
            }`}>
              ⋯
            </span>
            <span className={sheetOpen || moreActive ? 'text-pantry-leaf-dk' : 'text-hive-muted'}>More</span>
          </button>
        </div>
      </div>
    </>
  );
}
