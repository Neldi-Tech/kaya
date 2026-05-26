'use client';

// Business route group — dresses every /business page in the shared
// honey/cream section theme (same family as The Hive, per the v2 mockup).
// No section tab bar: the Portfolio is the hub and the app's own nav +
// BackBar carry navigation, so the AppShell mobile bar stays visible.
//
// Tier-gated under `business` (PR 3, 2026-05-26): Home families need the
// Business add-on; Castle includes it; Nest doesn't have access.

import { TierGate } from '@/components/TierGate';

export default function BusinessSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <TierGate moduleId="business">
      <div className="font-lato bg-hive-cream text-hive-navy min-h-screen">
        {children}
      </div>
    </TierGate>
  );
}
