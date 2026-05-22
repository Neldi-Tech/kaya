'use client';

// The headline number on the Portfolio: a kid's total worth = what their
// businesses are worth (assets + stock) + their Hive worth + what they've
// invested. Dark honey hero from the mockup. Invested is 0 until PR6.

import { DisplayRounding } from '@/lib/business';
import { formatWorth } from '@/components/business/money';

export default function NetWorthHero({
  businessWorthCents,
  hiveWorthCents,
  investedCents,
  businessCount,
  currency,
  rounding = 'whole',
}: {
  businessWorthCents: number;
  hiveWorthCents: number;
  investedCents: number;
  businessCount: number;
  currency: string;
  rounding?: DisplayRounding;
}) {
  const total = businessWorthCents + hiveWorthCents + investedCents;
  const fmt = (c: number) => formatWorth(c, currency, rounding);
  const chip = 'px-2.5 py-1 rounded-hive-pill bg-[rgba(245,215,122,0.15)] text-hive-honey-soft whitespace-nowrap';

  return (
    <div
      className="rounded-hive p-4 text-hive-cream"
      style={{ background: 'linear-gradient(135deg, #1F1A12 0%, #3D3320 100%)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] uppercase tracking-[0.06em] font-nunito font-extrabold text-hive-honey-soft">
            Your total worth today
          </div>
          <div className="font-nunito font-black text-[32px] leading-tight mt-1">
            {fmt(total)}
          </div>
          <div className="text-[12px] opacity-70 mt-0.5">
            across {businessCount} {businessCount === 1 ? 'business' : 'businesses'}
          </div>
        </div>
        <div className="text-[36px] leading-none">💎</div>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2.5 text-[11px] font-nunito font-bold">
        <span className={chip}>📦 Stock &amp; assets {fmt(businessWorthCents)}</span>
        <span className={chip}>🐝 Hive {fmt(hiveWorthCents)}</span>
        <span className={chip}>📈 Invested {fmt(investedCents)}</span>
      </div>
    </div>
  );
}
