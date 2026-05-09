'use client';

// Pantry section layout — applies the Lato body font + cream background
// and renders the section tab bar at the bottom on mobile. Desktop keeps
// using the main app sidebar (AppShell wraps this layout).

import PantryTabBar from '@/components/pantry/PantryTabBar';

export default function PantrySectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-lato bg-hive-cream text-hive-navy min-h-screen pb-24 lg:pb-0">
      {children}
      <PantryTabBar />
    </div>
  );
}
