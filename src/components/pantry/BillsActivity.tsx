'use client';

// BillsActivity — shared "Bills activity" module (design approved 2026-06-06).
//
// Lives on BOTH /pantry/utilities (Bills) and /pantry/utility/setup (Setup).
// Two tabs:
//   🔔 This month — reminder-engine view: per active bill, has this period's
//      payment request gone out? Bills past their due day with NO request
//      (or blocked by a missing amount) are pulled up + flagged red so a
//      missed reminder never slips by. Optional one-tap "Send now" (confirmed,
//      emails parents) on a flagged bill.
//   📜 History — every utility payment request that's gone out (newest first):
//      date sent · bill · amount · status (paid / awaiting / rejected).
//
// All data is read from what the app already keeps — the bills (lastGenerated /
// lastPayment stamps + due-day) and the utility-module request ledger. Nothing
// new to type. Read-only register except the explicit, confirmed "Send now".

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import type { Timestamp } from 'firebase/firestore';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  type Utility, subscribeToUtilities, currentPeriodKey,
} from '@/lib/pantry';
import {
  type PurchaseRequest,
  subscribeToOpenRequestsByModule, subscribeToRecentRequestsByModule,
} from '@/lib/purchase';
import { sendUtilityBillNow } from '@/lib/utilityBills';
import { getFamilyMembers } from '@/lib/firestore';
import { formatCents } from '@/components/pantry/format';

type EngineKind = 'paid' | 'sent' | 'noamt' | 'missed' | 'scheduled' | 'manual';

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd']; const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const tsToDate = (ts?: Timestamp): Date | null => ts?.toDate?.() ?? null;
const dayMon = (d: Date) => ({ day: d.getDate(), mon: d.toLocaleDateString(undefined, { month: 'short' }) });
const shortDate = (d: Date) => `${d.getDate()} ${d.toLocaleDateString(undefined, { month: 'short' })}`;
const monthLabel = (d: Date) => d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
const monthBucket = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

function effectiveDuePast(dueDay: number, now: Date): boolean {
  if (!dueDay || dueDay <= 0) return false;
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() > Math.min(dueDay, lastDay);
}

function engineKind(u: Utility, monthKey: string, now: Date): EngineKind {
  if (u.lastPaymentPeriodKey === monthKey) return 'paid';
  if (u.lastGeneratedKey && u.lastGeneratedKey.startsWith(monthKey)) return 'sent';
  const noAmount = !u.amountCents || u.amountCents <= 0;
  if (u.autoRequest && noAmount) return 'noamt';
  if (effectiveDuePast(u.dueDay || 0, now)) return 'missed';
  if (u.autoRequest && !noAmount) return 'scheduled';
  return 'manual';
}

const CHIP: Record<string, string> = {
  sent:  'bg-[#E5EFF8] text-hive-blue',
  paid:  'bg-[#E1F3E8] text-pantry-leaf-dk',
  auto:  'bg-hive-cream text-hive-muted border border-dashed border-hive-line',
  miss:  'bg-[#FBE2E2] text-[#C0463A]',
  noamt: 'bg-[#FBEBCF] text-[#B07A1E]',
  rej:   'bg-[#F1ECE0] text-hive-muted',
};

export default function BillsActivity({ familyId, byUid, currency, isParent }: {
  familyId: string; byUid: string; currency: string; isParent: boolean;
}) {
  const confirmAction = useConfirm();
  const [bills, setBills] = useState<Utility[]>([]);
  const [openReqs, setOpenReqs] = useState<PurchaseRequest[]>([]);
  const [recentReqs, setRecentReqs] = useState<PurchaseRequest[]>([]);
  const [tab, setTab] = useState<'month' | 'history'>('month');
  const [showAll, setShowAll] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);

  useEffect(() => { if (familyId) return subscribeToUtilities(familyId, setBills); }, [familyId]);
  useEffect(() => { if (familyId) return subscribeToOpenRequestsByModule(familyId, 'utility', setOpenReqs); }, [familyId]);
  useEffect(() => { if (familyId) return subscribeToRecentRequestsByModule(familyId, 'utility', setRecentReqs); }, [familyId]);

  const now = new Date();
  const monthKey = currentPeriodKey();

  // ── Reminder-engine rows (active bills, gaps first) ──
  const engine = useMemo(() => {
    const order: Record<EngineKind, number> = { missed: 0, noamt: 1, sent: 2, scheduled: 3, manual: 4, paid: 5 };
    return bills
      .filter((b) => b.active)
      .map((b) => ({ bill: b, kind: engineKind(b, monthKey, now) }))
      .sort((a, x) => order[a.kind] - order[x.kind] || (x.bill.amountCents || 0) - (a.bill.amountCents || 0));
  }, [bills, monthKey, now]);

  const counts = useMemo(() => {
    let sent = 0, scheduled = 0, gaps = 0;
    for (const e of engine) {
      if (e.kind === 'sent' || e.kind === 'paid') sent++;
      else if (e.kind === 'scheduled') scheduled++;
      else if (e.kind === 'missed' || e.kind === 'noamt') gaps++;
    }
    return { sent, scheduled, gaps };
  }, [engine]);

  // ── History (every utility request, newest first) ──
  const history = useMemo(() => {
    const seen = new Set<string>();
    const all: PurchaseRequest[] = [];
    for (const r of [...openReqs, ...recentReqs]) { if (!seen.has(r.id)) { seen.add(r.id); all.push(r); } }
    const dated = all
      .map((r) => ({ r, at: tsToDate(r.closedAt) ?? tsToDate(r.createdAt) }))
      .filter((x): x is { r: PurchaseRequest; at: Date } => !!x.at)
      .sort((a, x) => x.at.getTime() - a.at.getTime());
    if (showAll) return dated;
    const cutoff = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime(); // last ~6 months
    return dated.filter((x) => x.at.getTime() >= cutoff);
  }, [openReqs, recentReqs, showAll, now]);

  const billName = (r: PurchaseRequest) =>
    (r.utilityId && bills.find((b) => b.id === r.utilityId)?.name) || r.items?.[0]?.name || 'Utility bill';

  const onSendNow = async (b: Utility) => {
    if (!isParent || sendingId) return;
    const ok = await confirmAction({
      title: `Send payment request for “${b.name}” now?`,
      message: `${b.amountCents > 0 ? formatCents(b.amountCents, currency) : 'No amount set'} · the parents will be emailed.`,
      confirmLabel: 'Send now',
    });
    if (!ok) return;
    setSendingId(b.id);
    try {
      const members = await getFamilyMembers(familyId);
      const parentEmails = members.filter((m) => m.role === 'parent' && m.email).map((m) => m.email as string);
      await sendUtilityBillNow(familyId, byUid, b, {
        parentEmails, currency, appUrl: typeof window !== 'undefined' ? window.location.origin : '',
      });
    } catch {
      await confirmAction({ title: 'Couldn’t send', message: 'Add an amount on the bill, then try again.', confirmLabel: 'OK' });
    } finally {
      setSendingId(null);
    }
  };

  if (bills.length === 0 && history.length === 0) return null;

  return (
    <div className="bg-hive-paper border border-hive-line rounded-hive p-3 mt-4">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.3px] text-pantry-leaf-dk">📨 Bills activity</span>
        <span className="text-[9px] font-black uppercase tracking-wide bg-hive-honey text-white rounded-md px-1.5 py-0.5">New</span>
      </div>

      {/* tabs */}
      <div className="flex bg-hive-cream border border-hive-line rounded-[11px] p-[3px] gap-[3px] mt-2.5">
        {([['month', '🔔 This month'], ['history', '📜 History']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`flex-1 text-center text-[12px] font-nunito font-extrabold py-1.5 rounded-[8px] transition-colors ${tab === k ? 'bg-pantry-leaf-dk text-white' : 'text-hive-muted'}`}>
            {lbl}
          </button>
        ))}
      </div>

      {/* ── THIS MONTH (reminder engine) ── */}
      {tab === 'month' && (
        <div className="mt-3">
          <div className="flex gap-2">
            <div className="flex-1 bg-hive-paper border border-hive-line rounded-xl px-2.5 py-2">
              <div className="text-[18px] font-nunito font-black text-pantry-leaf-dk leading-none">{counts.sent}</div>
              <div className="text-[10px] font-bold text-hive-muted mt-0.5">✓ sent</div>
            </div>
            <div className="flex-1 bg-hive-paper border border-hive-line rounded-xl px-2.5 py-2">
              <div className="text-[18px] font-nunito font-black text-hive-navy leading-none">{counts.scheduled}</div>
              <div className="text-[10px] font-bold text-hive-muted mt-0.5">⏳ scheduled</div>
            </div>
            <div className={`flex-1 rounded-xl px-2.5 py-2 border ${counts.gaps > 0 ? 'bg-[#FBE2E2] border-[#F2BEBE]' : 'bg-hive-paper border-hive-line'}`}>
              <div className={`text-[18px] font-nunito font-black leading-none ${counts.gaps > 0 ? 'text-[#C0463A]' : 'text-hive-navy'}`}>{counts.gaps}</div>
              <div className={`text-[10px] font-bold mt-0.5 ${counts.gaps > 0 ? 'text-[#C0463A]' : 'text-hive-muted'}`}>⚠ not gone through</div>
            </div>
          </div>

          <div className="mt-1.5">
            {engine.map(({ bill: b, kind }) => {
              const alert = kind === 'missed' || kind === 'noamt';
              return (
                <div key={b.id} className="flex items-center gap-2.5 py-2.5 border-t border-hive-line first:border-t-0">
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${alert ? 'bg-[#FBE2E2]' : 'bg-pantry-leaf-soft'}`}>
                    {alert ? '⚠️' : (kind === 'paid' ? '✅' : kind === 'sent' ? '📤' : '⏳')}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-nunito font-black text-hive-navy truncate">{b.name}</div>
                    <div className="text-[10px] text-hive-muted truncate">
                      {b.dueDay > 0 ? `due ${ordinal(b.dueDay)}` : 'no due day'}
                      {kind === 'missed' && <span className="text-[#C0463A] font-bold"> · past due, no request created</span>}
                      {kind === 'noamt' && <span className="text-[#B07A1E] font-bold"> · amount not set</span>}
                      {kind === 'paid' && <span> · paid this month</span>}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <StatusChip kind={kind} bill={b} currency={currency} />
                    {isParent && (kind === 'missed' || (kind === 'noamt' && b.amountCents > 0)) && (
                      <button onClick={() => onSendNow(b)} disabled={sendingId === b.id}
                        className="text-[10px] font-nunito font-extrabold text-white bg-pantry-leaf-dk rounded-full px-2.5 py-0.5 disabled:opacity-50">
                        {sendingId === b.id ? 'Sending…' : 'Send now'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
            {engine.length === 0 && <div className="text-center text-[12px] text-hive-muted italic py-4">No active bills yet.</div>}
          </div>
          <p className="text-[11px] text-hive-muted leading-relaxed mt-1.5">
            ⚠ Anything <b className="text-hive-navy">past its due day with no request</b> (or missing an amount) is pulled up + flagged, so a missed reminder never slips by.
          </p>
        </div>
      )}

      {/* ── HISTORY ── */}
      {tab === 'history' && (
        <div className="mt-3">
          {history.length === 0 ? (
            <div className="text-center text-[12px] text-hive-muted italic py-6">No requests sent yet — they'll appear here once a bill's request goes out.</div>
          ) : (
            <>
              {(() => {
                const out: ReactNode[] = [];
                let lastBucket = '';
                for (const { r, at } of history) {
                  const bucket = monthBucket(at);
                  if (bucket !== lastBucket) {
                    lastBucket = bucket;
                    out.push(<div key={`m-${bucket}`} className="text-[10.5px] font-nunito font-extrabold uppercase tracking-wide text-hive-muted mt-3 mb-0.5">{monthLabel(at)}</div>);
                  }
                  const { day, mon } = dayMon(tsToDate(r.createdAt) ?? at);
                  const amt = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
                  out.push(
                    <Link key={r.id} href={`/pantry/purchase/${r.id}`}
                      className="flex items-center gap-2.5 py-2 border-t border-hive-line no-underline">
                      <div className="w-[42px] flex-shrink-0 text-center">
                        <div className="text-[15px] font-nunito font-black text-hive-navy leading-none">{day}</div>
                        <div className="text-[9px] font-bold text-hive-muted uppercase">{mon}</div>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-nunito font-black text-hive-navy truncate">{billName(r)}</div>
                        <div className="text-[10px] text-hive-muted truncate">Sent {shortDate(tsToDate(r.createdAt) ?? at)}</div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-[12.5px] font-nunito font-black text-hive-navy">{formatCents(amt, currency)}</div>
                        <RequestChip r={r} />
                      </div>
                    </Link>,
                  );
                }
                return out;
              })()}
              {!showAll && (
                <button onClick={() => setShowAll(true)} className="block w-full text-center text-[11px] font-nunito font-extrabold text-pantry-leaf-dk mt-3">Show all history</button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function StatusChip({ kind, bill, currency }: { kind: EngineKind; bill: Utility; currency: string }) {
  if (kind === 'paid') return <span className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 ${CHIP.paid}`}>✓ Paid{bill.lastPaymentCents ? ` · ${formatCents(bill.lastPaymentCents, currency)}` : ''}</span>;
  if (kind === 'sent') return bill.lastGeneratedRequestId
    ? <Link href={`/pantry/purchase/${bill.lastGeneratedRequestId}`} className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 no-underline ${CHIP.sent}`}>📤 Sent · awaiting ›</Link>
    : <span className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 ${CHIP.sent}`}>📤 Sent · awaiting</span>;
  if (kind === 'noamt') return <span className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 ${CHIP.noamt}`}>⚠ No amount</span>;
  if (kind === 'missed') return <span className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 ${CHIP.miss}`}>⚠ Not gone through</span>;
  if (kind === 'scheduled') return <span className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 ${CHIP.auto}`}>⏳ Auto-sends on the {bill.dueDay > 0 ? ordinal(bill.dueDay) : 'due day'}</span>;
  return <span className={`text-[10.5px] font-nunito font-black rounded-full px-2 py-0.5 ${CHIP.auto}`}>✋ Manual</span>;
}

function RequestChip({ r }: { r: PurchaseRequest }) {
  if (r.status === 'closed') {
    const at = tsToDate(r.closedAt);
    return <span className={`inline-block text-[10px] font-nunito font-black rounded-full px-2 py-0.5 mt-0.5 ${CHIP.paid}`}>✓ Paid{at ? ` ${shortDate(at)}` : ''}</span>;
  }
  if (r.status === 'rejected') return <span className={`inline-block text-[10px] font-nunito font-black rounded-full px-2 py-0.5 mt-0.5 ${CHIP.rej}`}>✕ Rejected</span>;
  return <span className={`inline-block text-[10px] font-nunito font-black rounded-full px-2 py-0.5 mt-0.5 ${CHIP.sent}`}>📤 Awaiting payment</span>;
}
