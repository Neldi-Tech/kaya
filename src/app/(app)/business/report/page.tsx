'use client';

// Weekly Business Report — rolling 7-day P&L, asset portfolio snapshot,
// and a full breakdown of approved sales and costs in the window.
// Read-only; the kid sees this as a "report card" for their business.

import { useMemo } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { useBusiness } from '@/contexts/BusinessContext';
import { assetType, assetValuationCents, COST_CATEGORIES } from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import KidSwitcher from '@/components/hive/KidSwitcher';
import BackButton from '@/components/ui/BackButton';

export default function BusinessReportPage() {
  const { children } = useFamily();
  const { activeKidId, config } = useHive();
  const {
    assets, sales, costs,
    totalAssetValueCents,
    weeklyRevenueCents, weeklyCostsCents, weeklyProfitCents,
    loading,
  } = useBusiness();

  const activeKid = children.find((c) => c.id === activeKidId);
  const cur = config.currency;
  const since = Date.now() - 7 * 24 * 60 * 60 * 1000;

  const weekSince = useMemo(() => {
    const d = new Date(since);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, [since]);

  const approvedSales = useMemo(
    () => sales.filter((s) => s.status === 'approved' && ((s.saleDate as any)?.toMillis?.() ?? (s.createdAt as any)?.toMillis?.() ?? 0) >= since),
    [sales, since],
  );
  const approvedCosts = useMemo(
    () => costs.filter((c) => c.status === 'approved' && ((c.costDate as any)?.toMillis?.() ?? (c.createdAt as any)?.toMillis?.() ?? 0) >= since),
    [costs, since],
  );
  const activeAssets = assets.filter((a) => !a.retiredAt && a.stage !== 'retired');
  const profitPositive = weeklyProfitCents >= 0;

  const catEmoji = (catId: string) =>
    COST_CATEGORIES.find((c) => c.id === catId)?.emoji || '•';

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden mb-1"><BackButton /></div>

      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-green">
          {activeKid ? `${activeKid.name}'s Business` : 'My Business'}
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1 leading-tight">
          Weekly Report 📊
        </h1>
        <p className="text-[12px] text-hive-muted mt-0.5">Last 7 days · since {weekSince}</p>
      </div>

      <KidSwitcher />

      {loading ? (
        <div className="py-12 text-center text-hive-muted text-sm">Loading…</div>
      ) : (
        <>
          {/* P&L summary */}
          <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 mb-4">
            <p className="font-nunito font-extrabold text-[11px] text-hive-muted uppercase tracking-[2px] mb-4">Profit & Loss</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-hive-green" />
                  <p className="font-bold text-[13px]">Revenue</p>
                </div>
                <p className="font-nunito font-black text-[18px] text-hive-green">{formatCash(weeklyRevenueCents, cur)}</p>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-hive-rose" />
                  <p className="font-bold text-[13px]">Costs</p>
                </div>
                <p className="font-nunito font-black text-[18px] text-hive-rose">−{formatCash(weeklyCostsCents, cur)}</p>
              </div>
              <div className="border-t border-hive-line pt-3 flex items-center justify-between">
                <p className="font-nunito font-extrabold text-[13px]">Net profit</p>
                <p className={`font-nunito font-black text-[22px] ${profitPositive ? 'text-hive-green' : 'text-hive-rose'}`}>
                  {profitPositive ? '' : '−'}{formatCash(Math.abs(weeklyProfitCents), cur)}
                </p>
              </div>
            </div>
          </div>

          {/* Asset portfolio */}
          {activeAssets.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 mb-4">
              <div className="flex items-baseline justify-between mb-3">
                <p className="font-nunito font-extrabold text-[11px] text-hive-muted uppercase tracking-[2px]">Asset Portfolio</p>
                <p className="font-nunito font-black text-[16px] text-hive-green">{formatCash(totalAssetValueCents, cur)}</p>
              </div>
              <div className="space-y-2">
                {activeAssets.map((a) => {
                  const type = assetType(a.typeKey);
                  const val  = assetValuationCents(a);
                  return (
                    <div key={a.id} className="flex items-center gap-2">
                      <span className="text-lg shrink-0">{type.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-bold truncate">{a.name}</p>
                        <p className="text-[10px] text-hive-muted">{a.count} {type.unit} · {a.stage}</p>
                      </div>
                      <p className="font-nunito font-bold text-[13px] shrink-0">{formatCash(val, cur)}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Approved sales this week */}
          {approvedSales.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 mb-4">
              <p className="font-nunito font-extrabold text-[11px] text-hive-muted uppercase tracking-[2px] mb-3">
                Sales this week ({approvedSales.length})
              </p>
              <div className="space-y-2">
                {approvedSales.map((s) => {
                  const dateMs = (s.saleDate as any)?.toMillis?.();
                  const dateStr = dateMs
                    ? new Date(dateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '';
                  return (
                    <div key={s.id} className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold truncate">{s.buyerName}</p>
                        <p className="text-[10px] text-hive-muted">{dateStr}</p>
                      </div>
                      <p className="font-nunito font-bold text-[13px] text-hive-green shrink-0 ml-2">
                        +{formatCash(s.totalCents, cur)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Approved costs this week */}
          {approvedCosts.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-5 mb-4">
              <p className="font-nunito font-extrabold text-[11px] text-hive-muted uppercase tracking-[2px] mb-3">
                Costs this week ({approvedCosts.length})
              </p>
              <div className="space-y-2">
                {approvedCosts.map((c) => {
                  const dateMs = (c.costDate as any)?.toMillis?.();
                  const dateStr = dateMs
                    ? new Date(dateMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                    : '';
                  return (
                    <div key={c.id} className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold truncate">
                          {catEmoji(c.category)} {c.description}
                        </p>
                        <p className="text-[10px] text-hive-muted">{dateStr}</p>
                      </div>
                      <p className="font-nunito font-bold text-[13px] text-hive-rose shrink-0 ml-2">
                        −{formatCash(c.amountCents, cur)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Blank state */}
          {approvedSales.length === 0 && approvedCosts.length === 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-8 text-center">
              <p className="text-4xl mb-3">📊</p>
              <p className="font-nunito font-extrabold text-[14px] mb-1">No activity this week</p>
              <p className="text-[12px] text-hive-muted">Log a sale or cost to see your numbers here once approved.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
