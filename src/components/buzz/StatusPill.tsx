'use client';

import type { BuzzStatus } from '@/lib/buzz';
import { statusPill } from '@/lib/buzz';

export function StatusPill({ status }: { status: BuzzStatus }) {
  const p = statusPill(status);
  return (
    <span
      className="inline-block text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full"
      style={p.bgGradient
        ? { background: p.bgGradient, color: p.fg }
        : { backgroundColor: p.bg, color: p.fg }}
    >
      {p.label}
    </span>
  );
}
