'use client';

// Business section layout — Lato body font, cream background, Business tab bar.
// Exactly mirrors the Hive and Pantry section layouts — don't touch the outer
// AppShell or the root layout (they're responsible for auth + font loading).

import BusinessTabBar from '@/components/business/BusinessTabBar';

export default function BusinessSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-lato bg-hive-cream text-hive-navy min-h-screen pb-24 lg:pb-0">
      {children}
      <BusinessTabBar />
    </div>
  );
}
