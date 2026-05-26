'use client';

import type { SparkStatus } from '@/lib/sparks';
import { statusPill } from '@/lib/sparks';

export function StatusPill({ status }: { status: SparkStatus }) {
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
