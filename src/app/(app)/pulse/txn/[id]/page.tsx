'use client';

// /pulse/txn/[id] — Kaya Pulse · Purchase request (transaction) detail.
//
// Opens from a tap on a row inside /pulse/bucket/[module]. Shows the closed
// purchase request: header, who/when/amount, item lines (when present), and
// the receipt link. PR 3 will add the Smart Receipt AI insight + What-If
// simulator inside the dashed slot at the bottom. Parent-only.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, subscribeToRequest, MODULE_EMOJI, MODULE_LABEL,
} from '@/lib/purchase';
import { formatCents, formatCentsBudgetNeat } from '@/components/pantry/format';
import { PulseHeader, PulseHero, PulseBreadcrumb } from '@/components/pulse/ui';
import { toDisplayDate } from '@/lib/dates';

export default function PulseTxnDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const txnId = (params?.id as string) ?? '';
  const { profile } = useAuth();
  const { config } = useHive();
  const currency = config.currency;
  const [req, setReq] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (profile && profile.role !== 'parent') router.replace('/pulse/today');
  }, [profile, router]);

  useEffect(() => {
    if (!profile?.familyId || profile.role !== 'parent' || !txnId) return;
    const u = subscribeToRequest(profile.familyId, txnId, (r) => { setReq(r); setLoading(false); });
    return () => u();
  }, [profile?.familyId, profile?.role, txnId]);

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

      {/* PR 3 will fill this slot with Smart Receipt AI + What-If. */}
      <div className="mt-3 bg-pulse-cream border-2 border-dashed border-pulse-gold/50 rounded-2xl p-4 text-center">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.4px] text-pulse-gold-dk">🧠 Smart Receipt + 🔮 What-If</div>
        <p className="text-[11px] font-bold text-hive-muted mt-1.5">AI insight + scenario simulator land here in PR 3 (next ship).</p>
      </div>
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
