'use client';

// Premium KPI strip shared by /household/contributions + /household/subscriptions.
// Three cells, side-by-side on tablet+, stacked on mobile. Navy/gold/cream palette
// (Treatment A — the parent-facing finance look the spec locks for both modules).

import { ReactNode } from 'react';

export interface KpiItem {
  label: string;
  value: ReactNode;
  /** Small line under the value — context, share, or sparkline placeholder. */
  sub?: ReactNode;
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {items.map((it, i) => (
        <div
          key={i}
          className="rounded-kaya bg-pulse-cream border border-pulse-navy/10 px-5 py-4"
        >
          <div className="text-[11px] font-bold tracking-wide uppercase text-pulse-navy/55">
            {it.label}
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold text-pulse-navy">
            {it.value}
          </div>
          {it.sub != null && (
            <div className="mt-0.5 text-xs font-semibold text-pulse-navy/60">
              {it.sub}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
