'use client';

// One business in the kid Portfolio. Type-coloured card → the business
// dashboard. Numbers come straight off the denormalized `business.stats`
// (zero for a fresh pilot — the books fill it in from PR4).

import Link from 'next/link';
import { Business, DisplayRounding } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import { formatWorth } from './money';
import { typeMeta, TYPE_GRADIENT, STATUS_META } from './meta';

export default function BusinessCard({ business, currency, rounding = 'whole' }: { business: Business; currency: string; rounding?: DisplayRounding }) {
  const t = typeMeta(business.type);
  const s = STATUS_META[business.status];
  const profit = business.stats?.monthProfitCents ?? 0;
  const worth = business.stats?.worthCents ?? 0;
  const sales = business.stats?.salesCount ?? 0;

  return (
    <Link
      href={`/business/${business.id}`}
      className="block rounded-hive p-4 border border-hive-line no-underline text-hive-navy hover:brightness-[0.98] active:scale-[0.99] transition"
      style={{ background: TYPE_GRADIENT[business.type] }}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-hive-pill bg-white/55 text-[11px] font-nunito font-extrabold">
          <span>{t.emoji}</span><span>{t.label} · {s.label}</span>
        </span>
        {profit > 0 && (
          <span className="font-nunito font-black text-[14px]">+{formatCash(profit, currency)}</span>
        )}
      </div>
      <h4 className="font-nunito font-black text-[16px] mt-2 mb-0.5 leading-tight">
        {business.emoji} {business.name}
      </h4>
      <p className="text-[12px] text-hive-navy/70">
        {worth > 0 ? `Worth ${formatWorth(worth, currency, rounding)}` : 'New — set up your books'}
        {sales > 0 ? ` · ${sales} ${sales === 1 ? 'sale' : 'sales'}` : ''}
      </p>
    </Link>
  );
}
