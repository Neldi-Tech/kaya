'use client';

// YTD giving widget for /household/contributions. Shows the YTD total
// and (when income is on file via any tithe entry's incomeBasis) the
// effective tithe %, plus the top 3 recipients. Pure rendering — all
// math is in computeContributionKpis().

import { formatCents } from '@/components/pantry/format';
import type { ContributionKpis } from '@/lib/contributions';

export function GivingProgress({
  kpis,
  householdCurrency,
}: {
  kpis: ContributionKpis;
  householdCurrency: string;
}) {
  return (
    <div className="rounded-kaya bg-white border border-pulse-navy/10 px-5 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">
            YTD giving
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold text-pulse-navy">
            {formatCents(kpis.ytdTotalCents, householdCurrency)}
          </div>
        </div>
        <TitheBadge percent={kpis.tithePercent} />
      </div>

      {kpis.topRecipients.length > 0 && (
        <div className="mt-3 pt-3 border-t border-pulse-navy/8">
          <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55 mb-1.5">
            Top recipients
          </div>
          <ul className="space-y-1">
            {kpis.topRecipients.map((r) => (
              <li key={r.name} className="flex items-center justify-between text-sm font-semibold">
                <span className="text-pulse-navy/80 truncate pr-3">{r.name}</span>
                <span className="text-pulse-navy">{formatCents(r.cents, householdCurrency)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function TitheBadge({ percent }: { percent: number | null }) {
  if (percent == null) {
    return (
      <div className="text-right">
        <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">
          Tithe %
        </div>
        <div className="text-pulse-navy/50 text-sm font-semibold">
          Add income basis to track
        </div>
      </div>
    );
  }
  const onCovenant = percent >= 9.5;  // 10% is the canonical line; within 0.5pp
  return (
    <div className="text-right">
      <div className="text-[11px] font-bold uppercase tracking-wide text-pulse-navy/55">
        Tithe %
      </div>
      <div className={`font-display text-xl font-extrabold ${onCovenant ? 'text-pulse-green' : 'text-pulse-navy'}`}>
        {percent.toFixed(1)}%
      </div>
      <div className="text-[11px] font-semibold text-pulse-navy/55">
        {onCovenant ? 'On covenant' : 'Of income'}
      </div>
    </div>
  );
}
