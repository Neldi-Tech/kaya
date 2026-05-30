'use client';

// Kaya Business · Transaction history. The full books for a business — every
// sale, cost, and (from PR3) reinvestment — grouped by day, newest first, so
// the record persists and is visible every time you open the business. The
// dashboard "Recent activity" card shows the latest few + links here.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  Business, LedgerEntry, subscribeToBusiness, subscribeToLedger,
} from '@/lib/business';
import { formatCash } from '@/components/hive/format';
import { toDisplayDate } from '@/lib/dates';
import BackButton from '@/components/ui/BackButton';

const COST_LABEL: Record<string, string> = {
  supplies: 'Supplies', tools: 'Tools', help: 'Help', other: 'Other',
};

// Local-day YYYY-MM-DD key so entries bucket in the viewer's timezone and feed
// straight into toDisplayDate (which expects that shape).
function dayKey(ms: number): string {
  const d = new Date(ms);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function timeOf(ts: any): string {
  const ms = ts?.toMillis?.();
  if (typeof ms !== 'number') return '';
  return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export default function BusinessHistoryPage() {
  const params = useParams();
  const businessId = String(params?.id || '');
  const { profile } = useAuth();
  const { config } = useHive();
  const familyId = profile?.familyId;
  const currency = config.currency;

  const [business, setBusiness] = useState<Business | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId || !businessId) return;
    const u1 = subscribeToBusiness(familyId, businessId, setBusiness);
    const u2 = subscribeToLedger(familyId, businessId, (l) => { setLedger(l); setLoading(false); }, 500);
    return () => { u1(); u2(); };
  }, [familyId, businessId]);

  // Lifetime totals straight from the (non-voided) ledger so the summary always
  // matches what's listed below — independent of the denormalized stats.
  const totals = useMemo(() => {
    let revenue = 0, costs = 0, sales = 0;
    for (const e of ledger) {
      if (e.voided) continue;
      if (e.kind === 'sale') {
        if (e.paymentStatus === 'unpaid') continue; // IOU — not realised yet
        revenue += e.amountCents; sales += 1;
      } else if (e.kind === 'cost') {
        costs += e.amountCents;
      }
    }
    return { revenue, costs, net: revenue - costs, sales };
  }, [ledger]);

  // Group by LOCAL day (newest first). Entries are already occurredAt-desc from
  // the subscription; grouping preserves that order within each day.
  const groups = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    for (const e of ledger) {
      const ms = (e.occurredAt as any)?.toMillis?.();
      const key = typeof ms === 'number' ? dayKey(ms) : '—';
      const arr = map.get(key) || [];
      arr.push(e);
      map.set(key, arr);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [ledger]);

  const dayNet = (entries: LedgerEntry[]): number =>
    entries.reduce((s, e) => {
      if (e.voided) return s;
      if (e.kind === 'sale') return e.paymentStatus === 'unpaid' ? s : s + e.amountCents;
      return s - e.amountCents;
    }, 0);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>

      {/* Header */}
      <div className="rounded-hive p-3.5 mb-3 flex items-center gap-3 bg-hive-navy text-hive-cream">
        <div className="text-[22px]">📒</div>
        <div className="flex-1 min-w-0">
          <div className="font-nunito font-black text-[16px] truncate">Transaction history</div>
          <div className="text-[11px] text-hive-honey-soft/80 truncate">
            {business ? business.name : 'Every sale and cost, kept on the record'}
          </div>
        </div>
        {business && (
          <Link href={`/business/${businessId}`} className="text-[12px] font-nunito font-extrabold text-hive-honey-soft hover:underline shrink-0">
            Dashboard →
          </Link>
        )}
      </div>

      {/* Lifetime summary */}
      <div className="grid grid-cols-3 gap-2.5 mb-3">
        <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
          <div className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Money in</div>
          <div className="font-nunito font-black text-[15px] mt-0.5 text-[#2F7D32]">{formatCash(totals.revenue, currency)}</div>
        </div>
        <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
          <div className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Money out</div>
          <div className="font-nunito font-black text-[15px] mt-0.5 text-hive-rose">{formatCash(totals.costs, currency)}</div>
        </div>
        <div className="bg-hive-paper border border-hive-line rounded-hive p-3">
          <div className="text-[10px] font-nunito font-extrabold uppercase tracking-wider text-hive-muted">Net · sales</div>
          <div className="font-nunito font-black text-[15px] mt-0.5">{formatCash(totals.net, currency)}</div>
          <div className="text-[10px] text-hive-muted">{totals.sales} {totals.sales === 1 ? 'sale' : 'sales'}</div>
        </div>
      </div>

      {/* The books */}
      {loading ? (
        <p className="text-center text-hive-muted text-sm py-8">Loading…</p>
      ) : ledger.length === 0 ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-8 text-center">
          <div className="text-4xl mb-2">🧾</div>
          <p className="font-nunito font-extrabold text-[15px]">No transactions yet</p>
          <p className="text-hive-muted text-sm mt-1">Log a sale or a cost and it will show up here — and stay.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([key, entries]) => {
            const net = dayNet(entries);
            return (
              <div key={key} className="bg-hive-paper border border-hive-line rounded-hive p-4">
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="font-nunito font-extrabold text-[13px]">{key === '—' ? 'Undated' : toDisplayDate(key)}</h3>
                  <span className={`text-[11px] font-nunito font-extrabold ${net >= 0 ? 'text-[#2F7D32]' : 'text-hive-rose'}`}>
                    {net >= 0 ? '+' : '−'}{formatCash(Math.abs(net), currency)}
                  </span>
                </div>
                {entries.map((e) => {
                  const isSale = e.kind === 'sale';
                  const iou = e.paymentStatus === 'unpaid';
                  const bits: string[] = [];
                  if (isSale) {
                    if (typeof e.qty === 'number' && typeof e.unitPriceCents === 'number') bits.push(`${e.qty} × ${formatCash(e.unitPriceCents, currency)}`);
                    if (e.customerLabel) bits.push(e.customerLabel);
                    if (iou) bits.push('IOU · unpaid');
                  } else if (e.costType) {
                    bits.push(COST_LABEL[e.costType] || e.costType);
                  }
                  const t = timeOf(e.occurredAt);
                  if (t) bits.push(t);
                  return (
                    <div key={e.id} className={`flex items-center justify-between gap-2 py-2 border-b border-dashed border-hive-line last:border-0 ${e.voided ? 'opacity-50' : ''}`}>
                      <div className="min-w-0">
                        <div className={`text-[13px] truncate ${e.voided ? 'line-through' : ''}`}>
                          {isSale ? '💵' : '🧾'} {e.description}
                        </div>
                        {bits.length > 0 && (
                          <div className="text-[11px] text-hive-muted truncate">{bits.join(' · ')}</div>
                        )}
                        {e.voided && e.voidReason && (
                          <div className="text-[11px] text-hive-rose truncate">Voided — {e.voidReason}</div>
                        )}
                      </div>
                      <span className={`font-nunito font-extrabold text-[13px] shrink-0 ${e.voided ? 'text-hive-muted' : isSale ? (iou ? 'text-hive-muted' : 'text-[#2F7D32]') : 'text-hive-rose'}`}>
                        {isSale ? '+' : '−'}{formatCash(e.amountCents, currency)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <p className="mt-3 mb-2 text-center text-[11px] text-hive-muted">
        The full record stays here — sales, costs{business ? ` for ${business.name}` : ''}, and reinvestments.
      </p>
    </div>
  );
}
