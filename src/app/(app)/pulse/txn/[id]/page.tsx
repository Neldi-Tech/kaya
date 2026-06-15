'use client';

// /pulse/txn/[id] — Kaya Pulse · Purchase request (transaction) detail.
//
// Opens from a tap on a row inside /pulse/bucket/[module]. Shows the closed
// purchase request: header, who/when/amount, item lines (when present), and
// the receipt link. PR 3 will add the Smart Receipt AI insight + What-If
// simulator inside the dashed slot at the bottom. Parent-only.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, subscribeToRequest, subscribeToRecentRequests,
  MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { PulseHeader, PulseHero, PulseBreadcrumb } from '@/components/pulse/ui';
import { toDisplayDate } from '@/lib/dates';
import SmartReceipt from '@/components/pulse/SmartReceipt';

const monthKeyOf = (d: Date = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

export default function PulseTxnDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const txnId = (params?.id as string) ?? '';
  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const [req, setReq] = useState<PurchaseRequest | null>(null);
  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent' || !txnId) return;
    const u1 = subscribeToRequest(profile.familyId, txnId, (r) => { setReq(r); setLoading(false); });
    const u2 = subscribeToRecentRequests(profile.familyId, setRecent);
    return () => { u1(); u2(); };
  }, [profile?.familyId, profile?.role, txnId]);

  // Bucket context for the AI insight + What-If math: this-month sibling
  // txns in the same bucket + cap.
  const bucketContext = useMemo(() => {
    if (!req) return null;
    const thisMonth = monthKeyOf();
    const sibs: number[] = [];
    for (const r of recent) {
      if (r.status !== 'closed') continue;
      if ((r.module ?? 'pantry') !== req.module) continue;
      const at = r.closedAt?.toDate?.();
      if (!at || monthKeyOf(at) !== thisMonth) continue;
      sibs.push(r.actualTotalCents ?? r.estimatedTotalCents ?? 0);
    }
    const cap = ((family?.householdBudgets ?? {}) as Record<string, number | undefined>)[req.module] ?? 0;
    const mtdSpent = sibs.reduce((s, v) => s + v, 0);
    const avgCents = sibs.length > 0 ? Math.round(mtdSpent / sibs.length) : 0;
    const txnCents = req.actualTotalCents ?? req.estimatedTotalCents ?? 0;
    return { cap, mtdSpent, avgCents, txnCents, txnCount: sibs.length };
  }, [req, recent, family?.householdBudgets]);

  if (profile && profile.role !== 'parent') {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Redirecting…</div>;
  }

  if (loading) {
    return <div className="mx-auto max-w-md px-4 pt-16 text-center text-hive-muted text-sm">Loading…</div>;
  }

  if (!req) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-8 pb-32">
        <PulseBreadcrumb trail={[]} current="Not found" />
        <PulseHeader eyebrow="Transaction" title="Not found" subtitle="We couldn't find that purchase." />
        <div className="mt-4 bg-white border border-pulse-gold/30 rounded-2xl p-5 text-center">
          <p className="text-sm text-hive-muted mb-3">It may have been deleted, or you may not have access.</p>
          <Link href="/pulse" className="text-pulse-gold-dk font-bold underline">Back to Pulse</Link>
        </div>
      </div>
    );
  }

  const closedAt = req.closedAt?.toDate?.();
  const dateLbl = closedAt ? toDisplayDate(`${closedAt.getFullYear()}-${String(closedAt.getMonth() + 1).padStart(2, '0')}-${String(closedAt.getDate()).padStart(2, '0')}`) : '—';
  const totalCents = req.actualTotalCents ?? req.estimatedTotalCents ?? 0;
  const moduleLbl = `${MODULE_EMOJI[req.module]} ${MODULE_LABEL[req.module]}`;

  const itemLines = req.items?.filter((it) => (it.actualQty ?? it.qty) > 0) ?? [];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <PulseBreadcrumb
        trail={[{ href: `/pulse/bucket/${req.module}`, label: MODULE_LABEL[req.module] }]}
        current={req.name || dateLbl}
      />
      <PulseHeader
        eyebrow={`${moduleLbl} · ${req.status === 'closed' ? 'Closed' : req.status}`}
        title={req.name || 'Purchase'}
        subtitle={`${dateLbl}${req.createdByRole ? ' · ' + req.createdByRole : ''}`}
      />

      <div className="mt-4">
        <PulseHero>
          <div className="text-[10px] uppercase tracking-[1px] font-black opacity-85">Amount</div>
          <div className="text-3xl font-nunito font-black mt-1">{formatCentsBudgetNeat(totalCents, currency)}</div>
          {req.actualTotalCents !== undefined && req.estimatedTotalCents > 0 && req.actualTotalCents !== req.estimatedTotalCents && (
            <div className="text-[11px] opacity-90 mt-1">
              estimated {formatCentsBudgetNeat(req.estimatedTotalCents, currency)} · actual {formatCentsBudgetNeat(req.actualTotalCents, currency)}
            </div>
          )}
          <div className="text-[11px] opacity-80 mt-2">{moduleLbl} · {dateLbl}</div>
        </PulseHero>
      </div>

      {/* Meta facts */}
      <div className="bg-white border border-pulse-gold/30 rounded-2xl mt-3 px-3 py-2">
        <Row label="Submitted by" value={req.createdByRole === 'parent' ? 'Parent' : 'Helper'} />
        {req.closedAt && <Row label="Closed on" value={dateLbl} />}
        {req.paidByUid !== undefined && req.paidByUid !== null && <Row label="Paid by" value="Personal" />}
        {req.paidByUid === null && <Row label="Paid by" value="Shared" />}
        {req.receiptUrl && (
          <Row
            label="Receipt"
            value={
              <a href={req.receiptUrl} target="_blank" rel="noreferrer" className="text-pulse-gold-dk font-extrabold no-underline">🧾 View</a>
            }
          />
        )}
        {req.note && <Row label="Helper note" value={<span className="text-pulse-navy">{req.note}</span>} />}
        {req.closeApprovalNote && <Row label="Parent note" value={<span className="text-pulse-navy">{req.closeApprovalNote}</span>} />}
      </div>

      {/* Items */}
      {itemLines.length > 0 && (
        <div className="bg-white border border-pulse-gold/30 rounded-2xl mt-3 p-3">
          <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold-dk mb-2">Items · {itemLines.length}</div>
          <div className="flex flex-col">
            {itemLines.map((it) => {
              const qty = it.actualQty ?? it.qty;
              const lineCents = (it.actualCents ?? it.estimatedCents ?? 0) * qty;
              return (
                <div key={it.id} className="flex items-baseline gap-2 py-1.5 border-t border-dashed border-pulse-gold/30 first:border-t-0">
                  <span className="flex-1 text-[12px] font-bold text-pulse-navy truncate">{it.name}</span>
                  <span className="text-[10.5px] text-hive-muted font-bold">{qty} {it.unit}</span>
                  <span className="text-[12px] font-black text-pulse-navy w-20 text-right">{formatCents(lineCents, currency)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Smart Receipt — Kaya AI insight on this purchase (PR 3). */}
      {bucketContext && (
        <SmartReceipt
          txnId={req.id}
          bucketLabel={MODULE_LABEL[req.module]}
          currency={currency}
          facts={{
            'this purchase': formatCentsBudgetNeat(bucketContext.txnCents, currency),
            'bucket': MODULE_LABEL[req.module],
            'bucket cap (month)': bucketContext.cap > 0 ? formatCentsBudgetNeat(bucketContext.cap, currency) : 'no cap set',
            'bucket spent so far this month': formatCentsBudgetNeat(bucketContext.mtdSpent, currency),
            'this bucket: number of closed purchases this month': bucketContext.txnCount,
            'bucket average per purchase (this month)': bucketContext.avgCents > 0 ? formatCentsBudgetNeat(bucketContext.avgCents, currency) : 'n/a',
            'closed by role': req.createdByRole || 'parent',
            'items in this purchase': req.items?.length ?? 0,
            'date': dateLbl,
          }}
        />
      )}

      {/* What-If simulator — pure client math, no AI call. */}
      {bucketContext && bucketContext.cap > 0 && (
        <WhatIf
          txnCents={bucketContext.txnCents}
          cap={bucketContext.cap}
          mtdSpent={bucketContext.mtdSpent}
          currency={currency}
        />
      )}
    </div>
  );
}

function WhatIf({ txnCents, cap, mtdSpent, currency }: { txnCents: number; cap: number; mtdSpent: number; currency: string }) {
  const now = new Date();
  const dom = now.getDate();
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = Math.max(0, dim - dom);
  const remaining = Math.max(0, cap - mtdSpent);
  const skipRemaining = remaining + txnCents;
  const halveSavings = Math.round(txnCents / 2);
  const repeat4xTotal = mtdSpent + txnCents * 4;
  const repeat4xOver = repeat4xTotal > cap;
  // When does the cap hit if you repeat this 4× more? assume evenly spread.
  const daysToCap = (() => {
    if (!repeat4xOver) return null;
    const dailyAdd = txnCents * 4 / Math.max(1, daysLeft);
    const overage = repeat4xTotal - cap;
    const daysFromTodayToCap = Math.max(0, Math.round((cap - mtdSpent) / Math.max(1, dailyAdd)));
    void overage;
    return dom + daysFromTodayToCap;
  })();

  return (
    <div className="mt-3 bg-white border-2 border-dashed border-pulse-gold/50 rounded-2xl p-4">
      <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold-dk mb-2">🔮 What-if · simulator</div>
      <div className="flex flex-col gap-1.5">
        <Scenario label="Skip this purchase" outcome={`+ ${formatCentsBudgetNeat(txnCents, currency)} buffer`} tone="good" />
        <Scenario
          label="Repeat 4× more this month"
          outcome={repeat4xOver ? `⚠ cap hit by Day ${daysToCap ?? '?'}` : `still ${formatCentsBudgetNeat(skipRemaining, currency)} buffer`}
          tone={repeat4xOver ? 'bad' : 'good'}
        />
        <Scenario label="Halve the size" outcome={`+ ${formatCentsBudgetNeat(halveSavings, currency)} saved`} tone="good" />
      </div>
      <p className="text-[10px] text-hive-muted font-bold mt-2 leading-snug">Pure math · no AI · uses your cap + month-to-date spend.</p>
    </div>
  );
}

function Scenario({ label, outcome, tone }: { label: string; outcome: string; tone: 'good' | 'bad' }) {
  return (
    <div className="px-3 py-2 bg-pulse-cream rounded-xl flex justify-between items-center">
      <span className="text-[11.5px] font-extrabold text-pulse-navy">{label}</span>
      <span className={`text-[11.5px] font-black ${tone === 'good' ? 'text-pulse-green' : 'text-pulse-coral'}`}>{outcome}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-t border-dashed border-pulse-gold/30 first:border-t-0">
      <span className="text-[10.5px] font-extrabold text-hive-muted">{label}</span>
      <span className="text-[11.5px] font-black text-pulse-navy">{value}</span>
    </div>
  );
}
