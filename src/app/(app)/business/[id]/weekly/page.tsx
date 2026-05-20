'use client';

// Kaya Business · Weekly review (kid screen 7). A warm recap of the last 7
// days from the kid's real books, plus the AI coach's "story of the week" +
// one thing to try next week. Read-only — the coach proposes, never acts.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, LedgerEntry, subscribeToBusiness, subscribeToLedger, readBusinessConfig,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import AICoachCard from '@/components/business/AICoachCard';

export default function WeeklyReviewPage() {
  const params = useParams();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const familyId = profile?.familyId;
  const coachName = readBusinessConfig(family).coachName;

  const [business, setBusiness] = useState<Business | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToLedger(familyId, businessId, setLedger, 100);
    return () => { u1(); u2(); };
  }, [familyId, businessId]);

  const week = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    let sales = 0, costs = 0, salesCount = 0;
    const customers: Record<string, number> = {};
    for (const e of ledger) {
      if (e.voided) continue;
      const ms = (e.occurredAt as any)?.toMillis?.() ?? 0;
      if (ms < cutoff) continue;
      if (e.kind === 'sale' && e.paymentStatus === 'paid') {
        sales += e.amountCents; salesCount += 1;
        if (e.customerLabel) customers[e.customerLabel] = (customers[e.customerLabel] || 0) + e.amountCents;
      } else if (e.kind === 'cost') {
        costs += e.amountCents;
      }
    }
    const profit = sales - costs;
    const margin = sales > 0 ? Math.round((profit / sales) * 100) : null;
    const topCustomer = Object.entries(customers).sort((a, b) => b[1] - a[1])[0]?.[0];
    return { sales, costs, profit, salesCount, margin, topCustomer };
  }, [ledger]);

  const cur = config.currency;
  const row = 'flex items-center justify-between py-2 border-b border-dashed border-hive-line last:border-0 text-[13px]';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">🗓️</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px]">Weekly review</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">{business?.name || 'Last 7 days'}</div>
        </div>
        {business && (
          <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">Dashboard →</Link>
        )}
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mb-3">
        <div className="flex items-baseline justify-between mb-1">
          <h3 className="font-nunito font-extrabold text-[14px]">This week</h3>
          <span className={`text-[11px] font-nunito font-black px-2 py-0.5 rounded-hive-pill ${week.profit >= 0 ? 'bg-[#E2F0E2] text-[#2F7D32]' : 'bg-[#FCEAD6] text-[#B25E16]'}`}>
            {week.profit >= 0 ? 'In the black' : 'In the red'}
          </span>
        </div>
        <div className={row}><span>Sales</span><span className="font-nunito font-extrabold text-[#2F7D32]">+{formatCash(week.sales, cur)} ({week.salesCount})</span></div>
        <div className={row}><span>Costs</span><span className="font-nunito font-extrabold text-hive-rose">−{formatCash(week.costs, cur)}</span></div>
        <div className={row}><span>Profit</span><span className="font-nunito font-extrabold">{formatCash(week.profit, cur)}</span></div>
        {week.margin !== null && <div className={row}><span>Margin</span><span className="font-nunito font-extrabold">{week.margin}%</span></div>}
        {week.topCustomer && <div className={row}><span>Best customer</span><span className="font-nunito font-extrabold">{week.topCustomer}</span></div>}
      </div>

      {week.salesCount === 0 && week.costs === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center">
          <div className="text-3xl mb-1.5">🌱</div>
          <p className="text-hive-muted text-[13px]">No sales or costs this week yet. Log a few and come back for your recap.</p>
        </div>
      ) : (
        <AICoachCard
          loop="weekly"
          coachName={coachName}
          currency={cur}
          cta={`Get ${coachName}'s story of the week`}
          facts={{
            business: business?.name || 'this business',
            weekSales: formatCash(week.sales, cur),
            weekCosts: formatCash(week.costs, cur),
            weekProfit: formatCash(week.profit, cur),
            ...(week.margin !== null ? { margin: `${week.margin}%` } : {}),
            salesThisWeek: week.salesCount,
            ...(week.topCustomer ? { bestCustomer: week.topCustomer } : {}),
          }}
        />
      )}
    </div>
  );
}
