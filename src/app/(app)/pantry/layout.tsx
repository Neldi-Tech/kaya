'use client';

// Pantry section layout — applies the Lato body font + cream background
// and renders the section tab bar at the bottom on mobile. Desktop keeps
// using the main app sidebar (AppShell wraps this layout).
//
// Tier-gated under `household` (PR 3, 2026-05-26): Nest families see the
// upsell; Home + Castle pass through. Operators + founding families bypass.

import PantryTabBar from '@/components/pantry/PantryTabBar';
import { TierGate } from '@/components/TierGate';

export default function PantrySectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <TierGate moduleId="household">
      <div className="font-lato bg-hive-cream text-hive-navy min-h-screen pb-24 lg:pb-0">
        {children}
        <PantryTabBar />
      </div>
    </TierGate>
  );
}
