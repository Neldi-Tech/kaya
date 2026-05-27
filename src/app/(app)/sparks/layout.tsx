'use client';

// Kaya Sparks route group — tier-gates every /sparks/* page under
// the `sparks` module (Nest+, per `lib/tiers.ts`). Family-level access
// is enforced here in one place so individual pages don't need to
// repeat the check; finer feature flags (AI scan, item caps, PDF
// export) come from `useSparksFeatures()` and ride along inside the
// gate.
//
// The page itself controls its own surface theme (kid-facing
// Bold-and-Playful vs parent-facing Premium) since /sparks/[kidId] is
// kid-led but /sparks/[kidId]/dashboard and /sparks/setup are parent-led.

import { TierGate } from '@/components/TierGate';

export default function SparksSectionLayout({ children }: { children: React.ReactNode }) {
  return (
    <TierGate moduleId="sparks">
      {children}
    </TierGate>
  );
}
