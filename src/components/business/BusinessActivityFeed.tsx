'use client';

// All-businesses activity feed — a quick view shown on the main
// /business page below the Junior Investor / Kids Projects buttons.
// One row per business with today's stats (or yesterday's when today
// is empty). Subscribes to ledger + moves + takes per business, so a
// kid with 1-3 businesses sees ~3-9 light subscriptions.
//
// For each business: stock-take done? · sales count + total · costs ·
// stock movements · net. Empty businesses render with a muted "quiet
// today" line so the kid still sees they exist in the feed.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Business, LedgerEntry, StockMovement, StockTake,
  subscribeToLedger, subscribeToStockMovements, subscribeToStockTakes,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';

interface Props {
  familyId: string;
  businesses: Business[];
  currency: string;
}

interface BizActivity {
  ledger: LedgerEntry[];
  moves: StockMovement[];
  takes: StockTake[];
}

const EMPTY: BizActivity = { ledger: [], moves: [], takes: [] };

export default function BusinessActivityFeed({ familyId, businesses, currency }: Props) {
  const [activity, setActivity] = useState<Record<string, BizActivity>>({});

  // Subscribe to each business's ledger / moves / takes. When the
  // businesses list changes (added / removed), this effect re-runs
  // and re-wires the subscriptions.
  useEffect(() => {
    if (!familyId || businesses.length === 0) {
      setActivity({});
      return;
    }
    const unsubs: Array<() => void> = [];
    for (const b of businesses) {
      const bid = b.id;
      const apply = (patch: Partial<BizActivity>) => {
        setActivity((prev) => ({
          ...prev,
          [bid]: { ...(prev[bid] ?? EMPTY), ...patch },
        }));
      };
      unsubs.push(subscribeToLedger(familyId, bid, (ledger) => apply({ ledger }), 20));
      unsubs.push(subscribeToStockMovements(familyId, bid, (moves) => apply({ moves }), 20));
      unsubs.push(subscribeToStockTakes(familyId, bid, (takes) => apply({ takes }), 10));
    }
    return () => { for (const u of unsubs) u(); };
  }, [familyId, businesses.map((b) => b.id).join(',')]);

  if (businesses.length === 0) return null;

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mt-2.5">
      <div className="flex items-baseline justify-between mb-2">
        <h3 className="font-nunito font-extrabold text-[14px]">📡 Across all businesses</h3>
        <span className="text-[11px] text-hive-muted">today's snapshot</span>
      </div>
      <ul className="divide-y divide-dashed divide-hive-line">
        {businesses.map((b) => (
          <BusinessFeedRow
            key={b.id}
            business={b}
            activity={activity[b.id] ?? EMPTY}
            currency={currency}
          />
        ))}
      </ul>
    </div>
  );
}

function BusinessFeedRow({
  business, activity, currency,
}: {
  business: Business;
  activity: BizActivity;
  currency: string;
}) {
  const stats = useMemo(() => {
    const tzOffsetMs = new Date().getTimezoneOffset() * 60_000;
    const dayKey = (ms: number) => new Date(ms - tzOffsetMs).toISOString().slice(0, 10);
    const todayKey = dayKey(Date.now());
    const ydayKey = dayKey(Date.now() - 86_400_000);
    const inDay = (ts: any, key: string) => {
      const ms = ts?.toMillis?.();
      return typeof ms === 'number' && dayKey(ms) === key;
    };

    const statsFor = (key: string) => {
      const sales = activity.ledger.filter((e) => e.kind === 'sale' && inDay(e.occurredAt, key));
      const costs = activity.ledger.filter((e) => e.kind === 'cost' && inDay(e.occurredAt, key));
      const moves = activity.moves.filter((m) => inDay(m.occurredAt, key));
      const take = activity.takes.find((t) => t.date === key);
      const empty = sales.length === 0 && costs.length === 0 && moves.length === 0 && !take;
      return {
        empty, sales, costs, moves, take,
        salesTotal: sales.reduce((s, e) => s + e.amountCents, 0),
        costsTotal: costs.reduce((s, e) => s + e.amountCents, 0),
      };
    };

    const today = statsFor(todayKey);
    const useYesterday = today.empty;
    return { snap: useYesterday ? statsFor(ydayKey) : today, label: useYesterday ? 'yesterday' : 'today' };
  }, [activity]);

  const { snap, label } = stats;
  const net = snap.salesTotal - snap.costsTotal;

  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <Link
        href={`/business/${business.id}`}
        className="block no-underline text-hive-navy hover:opacity-90"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-nunito font-extrabold text-[13px] truncate">
            {business.name}
          </p>
          <span className="text-[10px] text-hive-muted shrink-0 font-bold uppercase tracking-wider">
            {label}
          </span>
        </div>
        {snap.empty ? (
          <p className="text-[11px] text-hive-muted mt-0.5">Quiet — no logs.</p>
        ) : (
          <div className="text-[11px] mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            {snap.take && (
              <span className="font-nunito font-bold">📋 stock-take ✓</span>
            )}
            {snap.sales.length > 0 && (
              <span className="font-nunito font-bold text-[#2F7D32]">
                💵 {snap.sales.length} · {formatCash(snap.salesTotal, currency)}
              </span>
            )}
            {snap.costs.length > 0 && (
              <span className="font-nunito font-bold text-hive-rose">
                🧾 {snap.costs.length} · {formatCash(snap.costsTotal, currency)}
              </span>
            )}
            {snap.moves.length > 0 && (
              <span className="font-nunito font-bold">
                📊 {snap.moves.length} change{snap.moves.length === 1 ? '' : 's'}
              </span>
            )}
            {(snap.sales.length > 0 || snap.costs.length > 0) && (
              <span className={`font-nunito font-black ${
                net > 0 ? 'text-[#2F7D32]' : net < 0 ? 'text-hive-rose' : 'text-hive-muted'
              }`}>
                Net {net > 0 ? '+' : net < 0 ? '−' : ''}{formatCash(Math.abs(net), currency)}
              </span>
            )}
          </div>
        )}
      </Link>
    </li>
  );
}
