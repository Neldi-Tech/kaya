'use client';

// Kaya Business · Sale/cost detail → a shareable RECEIPT.
//
// Opens from a History row. Shows the entry as a receipt, and lets the kid:
//   • Send via Kaya   — post the receipt IMAGE to a parent (or family chat)
//   • Send as text    — same details as a Kaya text message
//   • Copy as image   — receipt PNG to the clipboard (paste anywhere)
//   • Save            — download the receipt PNG
// Read-only on the books.

import { useEffect, useMemo, useState } from 'react';
import { formatCash } from '@/components/hive/format';
import type { Business, LedgerEntry } from '@/lib/business';
import {
  type ThreadMember, selfMember, messageableMembers,
  ensureDirectThread, ensureGroupThread, sendMessage, GROUP_THREAD_ID,
} from '@/lib/messaging';
import { uploadMessagePhoto } from '@/lib/messagingUpload';
import { renderReceiptPng, receiptText, type ReceiptData } from '@/lib/businessReceipt';

interface ViewerProfile { uid: string; displayName?: string; role: 'parent' | 'helper' | 'kid' | 'guest'; childId?: string; avatarPhoto?: string; photoURL?: string }

export default function SaleReceiptSheet({ familyId, business, entry, currency, profile, onClose }: {
  familyId: string; business: Business | null; entry: LedgerEntry; currency: string;
  profile: ViewerProfile; onClose: () => void;
}) {
  const [members, setMembers] = useState<ThreadMember[]>([]);
  const [busy, setBusy] = useState<string | null>(null);   // target uid / 'copy' / 'save' / 'group'
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let off = false;
    messageableMembers(familyId).then((m) => { if (!off) setMembers(m); }).catch(() => {});
    return () => { off = true; };
  }, [familyId]);

  const parents = useMemo(() => members.filter((m) => m.role === 'parent' && m.uid !== profile.uid), [members, profile.uid]);

  const data = useMemo<ReceiptData>(() => {
    const isSale = entry.kind === 'sale';
    const iou = entry.paymentStatus === 'unpaid';
    const totalStr = formatCash(entry.amountCents, currency);
    const d = entry.occurredAt?.toDate?.() ?? new Date();
    const dateLabel = `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    const loggedBy = members.find((m) => m.uid === entry.createdBy)?.name || (entry.createdBy === profile.uid ? (profile.displayName || 'you') : undefined);
    let potLabel = '', potStr = '', potTone: ReceiptData['potTone'] = 'in';
    if (isSale) {
      if (iou) { potLabel = 'To 🍯 Pot when paid'; potStr = totalStr; potTone = 'pending'; }
      else { potLabel = 'Went to 🍯 Pot'; potStr = totalStr; potTone = 'in'; }
    } else {
      potLabel = entry.fundedFromPot ? 'From 🍯 Pot' : 'Tracked (parent float)';
      potStr = entry.fundedFromPot ? totalStr : '—';
      potTone = 'out';
    }
    return {
      businessName: business?.name || 'My Business',
      businessEmoji: business?.emoji || (isSale ? '💵' : '🧾'),
      refNo: `${isSale ? 'SALE' : 'COST'}-${(entry.id || '').slice(-5).toUpperCase()}`,
      dateLabel,
      heading: isSale ? 'SALE RECEIPT' : 'COST RECEIPT',
      item: entry.productName || entry.description || (isSale ? 'Sale' : 'Cost'),
      qtyPriceStr: isSale && entry.qty && entry.unitPriceCents ? `${entry.qty} × ${formatCash(entry.unitPriceCents, currency)}` : undefined,
      customerLabel: entry.customerLabel || undefined,
      paymentLabel: isSale ? (iou ? 'IOU · unpaid' : `${entry.paymentMethod || 'Cash'} · paid ✓`) : undefined,
      totalStr, totalIsCost: !isSale,
      potLabel, potStr, potTone, loggedByName: loggedBy,
    };
  }, [entry, business, currency, members, profile]);

  const flash = (k: string) => { setDone(k); setTimeout(() => setDone((cur) => (cur === k ? null : cur)), 2200); };

  const makeFile = async () => {
    const blob = await renderReceiptPng(data);
    return new File([blob], `${data.refNo}.png`, { type: 'image/png' });
  };

  const onCopy = async () => {
    setErr(''); setBusy('copy');
    try {
      const blob = await renderReceiptPng(data);
      // ClipboardItem image write — supported in modern Safari/Chrome on a user gesture.
      const CI = (window as unknown as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
      if (CI && navigator.clipboard && 'write' in navigator.clipboard) {
        await navigator.clipboard.write([new CI({ 'image/png': blob })]);
        flash('copy');
      } else {
        downloadBlob(blob, `${data.refNo}.png`); flash('save'); // fallback: save
      }
    } catch { setErr('Copy isn’t supported here — saved the image instead.'); try { downloadBlob(await renderReceiptPng(data), `${data.refNo}.png`); } catch { /* noop */ } }
    finally { setBusy(null); }
  };

  const onSave = async () => {
    setErr(''); setBusy('save');
    try { downloadBlob(await renderReceiptPng(data), `${data.refNo}.png`); flash('save'); }
    catch { setErr('Couldn’t save the image.'); }
    finally { setBusy(null); }
  };

  const send = async (target: ThreadMember | 'group', asText: boolean) => {
    setErr(''); setBusy(target === 'group' ? 'group' : target.uid);
    try {
      const me = selfMember(profile as Parameters<typeof selfMember>[0]);
      const threadId = target === 'group' ? await ensureGroupThread(familyId, []) : await ensureDirectThread(familyId, me, target);
      const text = receiptText(data);
      if (asText) {
        await sendMessage(familyId, threadId, { text }, me);
      } else {
        const att = await uploadMessagePhoto(familyId, threadId, await makeFile());
        await sendMessage(familyId, threadId, { text, attachments: [att] }, me);
      }
      flash(`sent-${target === 'group' ? GROUP_THREAD_ID : target.uid}`);
    } catch { setErr('Couldn’t send — please try again.'); }
    finally { setBusy(null); }
  };

  const [textMode, setTextMode] = useState(false);
  const potCls = data.potTone === 'in' ? 'bg-[#E1F3E8] text-[#2F7D32]' : data.potTone === 'pending' ? 'bg-[#FBEBCF] text-hive-honey-dk' : 'bg-[#FBE2E2] text-[#B5403F]';

  return (
    <div className="fixed inset-0 z-[70] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-hive-cream w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.3px] text-hive-honey-dk">Receipt</span>
          <button onClick={onClose} className="text-hive-muted text-[13px] font-bold px-2">Close</button>
        </div>

        {/* The receipt (matches the shared image) */}
        <div className="mx-4 mb-3 bg-white border border-hive-line rounded-2xl overflow-hidden shadow-sm">
          <div className="text-center text-white px-4 py-3" style={{ background: 'linear-gradient(135deg,#1F2D3D,#33485f)' }}>
            <div className="font-nunito font-black text-[15px]">{data.businessEmoji} {data.businessName}</div>
            <div className="text-[10.5px] opacity-85">{data.heading}</div>
            <div className="text-[9px] opacity-70 mt-1 tracking-wide">No. {data.refNo} · {data.dateLabel}</div>
          </div>
          <div className="px-4 py-3">
            {[['Item', data.item], ['Qty × price', data.qtyPriceStr], ['Customer', data.customerLabel], ['Payment', data.paymentLabel]]
              .filter(([, v]) => v).map(([k, v]) => (
                <div key={k} className="flex justify-between text-[12.5px] py-1">
                  <span className="text-hive-muted font-bold">{k}</span><span className="text-hive-navy font-extrabold">{v}</span>
                </div>
              ))}
            <div className="border-t border-dashed border-hive-line my-2" />
            <div className="flex justify-between items-center"><span className="font-nunito font-black text-[15px] text-hive-navy">Total</span><span className={`font-nunito font-black text-[15px] ${data.totalIsCost ? 'text-hive-rose' : 'text-hive-navy'}`}>{data.totalIsCost ? '− ' : ''}{data.totalStr}</span></div>
            <div className={`mt-2 rounded-xl px-3 py-2 flex justify-between items-center ${potCls}`}>
              <span className="font-nunito font-black text-[12px]">{data.potLabel}</span>
              <span className="font-nunito font-black text-[14px]">{data.potStr}</span>
            </div>
          </div>
          <div className="text-center text-[10px] text-hive-muted py-2 border-t border-hive-line">{data.loggedByName ? `Logged by ${data.loggedByName} · ` : ''}Kaya Business</div>
        </div>

        {/* Actions */}
        <div className="px-4 pb-4">
          <div className="grid grid-cols-2 gap-2">
            <button onClick={onCopy} disabled={!!busy} className="rounded-xl border border-hive-line bg-white py-2.5 text-[12.5px] font-nunito font-black text-hive-navy disabled:opacity-60">{busy === 'copy' ? 'Copying…' : done === 'copy' ? '✓ Copied' : '📋 Copy as image'}</button>
            <button onClick={onSave} disabled={!!busy} className="rounded-xl border border-hive-line bg-white py-2.5 text-[12.5px] font-nunito font-black text-hive-navy disabled:opacity-60">{busy === 'save' ? 'Saving…' : done === 'save' ? '✓ Saved' : '⬇ Save image'}</button>
          </div>

          <div className="mt-3 bg-white border border-hive-line rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-nunito font-extrabold uppercase tracking-[1px] text-hive-muted">Send to parent via Kaya</span>
              <button onClick={() => setTextMode((v) => !v)} className="text-[10.5px] font-bold text-hive-honey-dk">{textMode ? '📷 image' : '💬 as text'}</button>
            </div>
            {parents.length === 0 && members.length === 0 && <div className="text-[11px] text-hive-muted">Loading…</div>}
            <div className="flex flex-wrap gap-2">
              {parents.map((p) => (
                <button key={p.uid} onClick={() => send(p, textMode)} disabled={!!busy}
                  className="inline-flex items-center gap-1.5 text-[12px] font-nunito font-extrabold bg-hive-cream border border-hive-line rounded-full px-3 py-1.5 disabled:opacity-60">
                  {busy === p.uid ? 'Sending…' : done === `sent-${p.uid}` ? '✓ Sent' : `📤 ${p.name}`}
                </button>
              ))}
              <button onClick={() => send('group', textMode)} disabled={!!busy}
                className="inline-flex items-center gap-1.5 text-[12px] font-nunito font-extrabold bg-hive-cream border border-hive-line rounded-full px-3 py-1.5 disabled:opacity-60">
                {busy === 'group' ? 'Sending…' : done === `sent-${GROUP_THREAD_ID}` ? '✓ Sent' : '👨‍👩‍👧 Family chat'}
              </button>
            </div>
            <div className="text-[10px] text-hive-muted mt-2">{textMode ? 'Sends the details as a Kaya text.' : 'Sends the receipt image into the chat.'}</div>
          </div>

          {err && <div className="text-[11.5px] text-hive-rose font-bold mt-2">{err}</div>}
        </div>
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
