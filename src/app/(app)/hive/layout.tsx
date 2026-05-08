'use client';

// Hive route group — applies the Lato body font everywhere under /hive,
// dresses the page in `--cream`-toned background, and renders the section
// tab bar at the bottom on mobile. Desktop keeps using the main app
// sidebar (the existing AppShell already wraps this layout).

import HiveTabBar from '@/components/hive/HiveTabBar';

export default function HiveSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-lato bg-hive-cream text-hive-navy min-h-screen pb-24 lg:pb-0">
      {children}
      <HiveTabBar />
    </div>
  );
}
