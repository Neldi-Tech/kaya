'use client';

// Wealth route group — tier-gated under `wealth` (PR 3, 2026-05-26).
// Home families need the Wealth add-on; Castle includes it; Nest
// doesn't have access. Operators + founding families bypass.

import { TierGate } from '@/components/TierGate';

export default function WealthSectionLayout({ children }: { children: React.ReactNode }) {
  return <TierGate moduleId="wealth">{children}</TierGate>;
}
