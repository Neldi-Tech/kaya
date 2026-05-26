'use client';

// Chef route group — tier-gated under `chef` (PR 3, 2026-05-26). Home
// families need the Chef add-on; Castle includes it; Nest doesn't have
// access. Operators + founding families bypass.

import { TierGate } from '@/components/TierGate';

export default function ChefSectionLayout({ children }: { children: React.ReactNode }) {
  return <TierGate moduleId="chef">{children}</TierGate>;
}
