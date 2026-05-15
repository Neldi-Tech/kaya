'use client';

// Business Home — the kid's enterprise dashboard.
// Three stat cards (asset value, float, pending), weekly P&L strip,
// quick-action buttons, recent sales/costs preview.
// On first visit `ensureBusiness` is called to create the singleton.

import { useEffect } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { ensureBusiness } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import KidSwitcher from '@/components/hive/KidSwitcher';
import BackButton from '@/components/ui/BackButton';

export default function BusinessHomePage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const { activeKidId, config } = useHive();
  const {
    business, sales, costs,
    totalAssetValueCents,
    weeklyRevenueCents, weeklyCostsCents, weeklyProfitCents,
    pendingCount, floatBalanceCents,
    loading,
  } = useBusiness();

  const activeKid = children.find((c) => c.id === activeKidId);
  const cur = config.currency;

  // Ensure the business singleton exists on first visit.
  useEffect(() => {
    if (profile?.familyId && activeKidId && !loading && !business) {
      ensureBusiness(profile.familyId, activeKidId).catch(console.error);
    }
  }, [profile?.familyId, activeKidId, loading, business]);

  const recentSales = sales.slice(0, 3);
  const recentCosts = costs.slice(0, 3);

  const profitPositive = weeklyProfitCents >= 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden mb-1"><BackButton /></div>

      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">
          {activeKid ? `${activeKid.name}'s Business` : 'My Business'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
          {business?.emoji || '🌱'} {business?.tagline || 'My Business'}
        </h1>
        {business?.tagline ? (
          <p className="text-[13px] text-hive-muted mt-0.5">{activeKid?.name}&apos;s enterprise</p>
        ) : null}
      </div>

      <KidSwitcher />

      {loading ? (
        <div className="py-12 text-center text-hive-muted text-sm">Loading…</div>
      ) : (
        <>
          {/* Pending approvals banner */}
          {pendingCount > 0 && (
            <div className="mb-3 bg-[#FFF3D9] border border-hive-honey/60 rounded-hive px-4 py-3 flex items-center gap-2">
              <span className="text-xl">⏳</span>
              <p className="font-nunito font-extrabold text-[13px] text-hive-honey-dk">
                {pendingCount} item{pendingCount > 1 ? 's' : ''} waiting for parent approval
              </p>
            </div>
          )}

          {/* 3 stat cards */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-gradient-to-br from-[#E6F7EE] to-[#C9EBD7] border border-[#8FD3AB] rounded-hive p-3 text-center">
              <p className="text-[9px] uppercase tracking-[1.5px] font-bold text-hive-muted leading-none">Assets</p>
              <p className="font-nunito font-black text-[16px] mt-1 leading-none">{formatCash(totalAssetValueCents, cur)}</p>
            </div>
            <div className="bg-gradient-to-br from-[#FFF3D9] to-hive-honey-soft border border-hive-honey rounded-hive p-3 text-center">
              <p className="text-[9px] uppercase tracking-[1.5px] font-bold text-hive-muted leading-none">Float 💰</p>
              <p className="font-nunito font-black text-[16px] mt-1 leading-none">{formatCash(floatBalanceCents, cur)}</p>
            </div>
            <div className={`rounded-hive p-3 text-center border ${
              pendingCount > 0
                ? 'bg-gradient-to-br from-[#FFF3D9] to-[#FDE9B5] border-hive-honey/60'
                : 'bg-hive-paper border-hive-line'
            }`}>
              <p className="text-[9px] uppercase tracking-[1.5px] font-bold text-hive-muted leading-none">Pending</p>
              <p className="font-nunito font-black text-[16px] mt-1 leading-none">{pendingCount}</p>
            </div>
          </div>

          {/* Weekly P&L strip */}
          <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-4">
            <p className="font-nunito font-extrabold text-[11px] text-hive-muted uppercase tracking-[2px] mb-3">This week</p>
            <div className="grid grid-cols-3 gap-2 text-center">
              <div>
                <p className="text-[10px] text-hive-muted font-bold">Revenue</p>
                <p className="font-nunito font-black text-[17px] text-hive-green">{formatCash(weeklyRevenueCents, cur)}</p>
              </div>
              <div>
                <p className="text-[10px] text-hive-muted font-bold">Costs</p>
                <p className="font-nunito font-black text-[17px] text-hive-rose">{formatCash(weeklyCostsCents, cur)}</p>
              </div>
              <div>
                <p className="text-[10px] text-hive-muted font-bold">Profit</p>
                <p className={`font-nunito font-black text-[17px] ${profitPositive ? 'text-hive-green' : 'text-hive-rose'}`}>
                  {profitPositive ? '' : '−'}{formatCash(Math.abs(weeklyProfitCents), cur)}
                </p>
              </div>
            </div>
            <div className="mt-3 text-right">
              <Link href="/business/report" className="text-[11px] font-nunito font-extrabold text-hive-green hover:underline">
                Full report →
              </Link>
            </div>
          </div>

          {/* Quick actions */}
          <div className="grid grid-cols-3 gap-2 mb-4">
            <Link
              href="/business/sales/new"
              className="rounded-hive border border-hive-green/40 bg-[#E6F7EE] p-3 flex flex-col items-center gap-1 text-center no-underline text-inherit hover:border-hive-green transition-colors"
            >
              <span className="text-2xl">💼</span>
              <span className="font-nunito font-extrabold text-[12px] text-hive-green">Log Sale</span>
            </Link>
            <Link
              href="/business/costs/new"
              className="rounded-hive border border-hive-line bg-hive-paper p-3 flex flex-col items-center gap-1 text-center no-underline text-inherit hover:border-hive-muted transition-colors"
            >
              <span className="text-2xl">🧾</span>
              <span className="font-nunito font-extrabold text-[12px]">Log Cost</span>
            </Link>
            <Link
              href="/business/assets/new"
              className="rounded-hive border border-hive-line bg-hive-paper p-3 flex flex-col items-center gap-1 text-center no-underline text-inherit hover:border-hive-muted transition-colors"
            >
              <span className="text-2xl">🌱</span>
              <span className="font-nunito font-extrabold text-[12px]">Add Asset</span>
            </Link>
          </div>

          {/* Recent sales */}
          {recentSales.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-3">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-nunito font-extrabold text-[13px]">Recent sales</h3>
                <Link href="/business/sales" className="text-[11px] font-nunito font-extrabold text-hive-green hover:underline">See all →</Link>
              </div>
              <div className="space-y-2">
                {recentSales.map((s) => (
                  <div key={s.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold truncate">{s.buyerName}</p>
                      <p className="text-[11px] text-hive-muted">{s.items.length} item{s.items.length > 1 ? 's' : ''}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-nunito font-black text-[14px] text-hive-green">{formatCash(s.totalCents, cur)}</p>
                      <StatusPill status={s.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent costs */}
          {recentCosts.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 mb-3">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="font-nunito font-extrabold text-[13px]">Recent costs</h3>
                <Link href="/business/costs" className="text-[11px] font-nunito font-extrabold text-hive-green hover:underline">See all →</Link>
              </div>
              <div className="space-y-2">
                {recentCosts.map((c) => (
                  <div key={c.id} className="flex items-center justify-between">
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold truncate">{c.description}</p>
                      <p className="text-[11px] text-hive-muted">{c.fundingSource === 'float' ? '💰 float' : '👛 wallet'}</p>
                    </div>
                    <div className="text-right shrink-0 ml-2">
                      <p className="font-nunito font-black text-[14px] text-hive-rose">{formatCash(c.amountCents, cur)}</p>
                      <StatusPill status={c.status} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {recentSales.length === 0 && recentCosts.length === 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
              <p className="text-4xl mb-3">🌱</p>
              <p className="font-nunito font-extrabold text-[15px] mb-1">Your business is just getting started!</p>
              <p className="text-[12px] text-hive-muted">Log your first sale or add an asset to see your numbers here.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending_approval: { label: 'Pending', cls: 'text-hive-honey-dk bg-[#FFF3D9]' },
    approved:         { label: 'Approved', cls: 'text-hive-green bg-[#E6F7EE]' },
    rejected:         { label: 'Rejected', cls: 'text-hive-rose bg-[#FCEAEA]' },
  };
  const m = map[status] || { label: status, cls: 'text-hive-muted bg-hive-cream' };
  return (
    <span className={`inline-block text-[9px] font-nunito font-extrabold px-1.5 py-0.5 rounded-full ${m.cls}`}>
      {m.label}
    </span>
  );
}
