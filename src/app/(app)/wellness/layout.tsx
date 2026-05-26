'use client';

// Wellness route group — tier-gated under `wellness` (PR 3, 2026-05-26).
// Home families need the Wellness add-on; Castle includes it; Nest
// doesn't have access. Operators + founding families bypass.

import { TierGate } from '@/components/TierGate';

export default function WellnessSectionLayout({ children }: { children: React.ReactNode }) {
  return <TierGate moduleId="wellness">{children}</TierGate>;
}
