'use client';

// Printable & downloadable purchase form (2026-07-04, Elia-approved design).
//
// A share-with-the-buyer sheet for any APPROVED purchase request. Three
// modes flip what the same sheet shows:
//   • shop   — Shopping list for whoever goes to buy (est. prices +
//              blank "actual" column + tick boxes + running tally)
//   • quote  — Request for quote for a supplier: items + qty only, with
//              blank price columns. Estimates + cap are STRIPPED so a
//              supplier can't price up to our ceiling.
//   • record — Approved order: the clean official copy (approved figures,
//              actuals if reconciled), no blanks, no cap.
//
// PDF/print is browser-native (window.print → "Save as PDF"): zero deps.
// The parent-only budget cap is screen-only and NEVER prints/exports
// (Elia #3). Currency is shown once, in the column headers (Elia #1).
// Share-by-email + send-via-Kaya + the scan-back QR land in later PRs.

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import { getFamilyMembers } from '@/lib/firestore';
import BudgetBalanceMeter from '@/components/pantry/BudgetBalanceMeter';
import {
  subscribeToRequest, sumEstimated, sumActual,
  formatRequestSeq, MODULE_LABEL, MODULE_EMOJI,
  type PurchaseRequest,
} from '@/lib/purchase';
import { STAPLE_CATEGORIES } from '@/lib/pantry';
import { currencyDecimals } from '@/lib/hive';
import { toDisplayDate } from '@/lib/dates';

type Mode = 'shop' | 'quote' | 'record';

const MODE_META: Record<Mode, { kind: string; sub: string; badge: string }> = {
  shop:   { kind: 'Shopping List',    sub: 'Take me to the market',      badge: '✓ APPROVED' },
  quote:  { kind: 'Request for Quote', sub: 'Please quote your best price', badge: '📋 FOR QUOTE' },
  record: { kind: 'Approved Order',    sub: 'Official record',            badge: '✓ APPROVED' },
};

const SHAREABLE_STATUSES = ['approved', 'reconciling', 'pending_close', 'closed'];

function isoOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function catEmoji(category?: string): string {
  return STAPLE_CATEGORIES.find((c) => c.id === category)?.emoji ?? '🧺';
}

export default function PurchasePrintPage() {
  const params = useParams();
  const requestId = String(params?.id ?? '');

  const { profile } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;

  const [req, setReq] = useState<PurchaseRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<{ uid: string; displayName?: string; role?: string }[]>([]);

  const [mode, setMode] = useState<Mode>('shop');

  // Honour a ?mode= deep link without useSearchParams (which would force a
  // Suspense boundary at build). Read it client-side after mount.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('mode');
    if (q === 'quote' || q === 'record' || q === 'shop') setMode(q);
  }, []);

  useEffect(() => {
    if (!profile?.familyId || !requestId) { setLoading(false); return; }
    const unsub = subscribeToRequest(profile.familyId, requestId, (r) => {
      setReq(r);
      setLoading(false);
    });
    return () => unsub();
  }, [profile?.familyId, requestId]);

  useEffect(() => {
    if (!profile?.familyId) return;
    getFamilyMembers(profile.familyId)
      .then((m) => setMembers(m as { uid: string; displayName?: string; role?: string }[]))
      .catch(() => {});
  }, [profile?.familyId]);

  const nameOf = useMemo(() => {
    const map = new Map(members.map((m) => [m.uid, m.displayName || 'Family member']));
    return (uid?: string | null) => (uid ? map.get(uid) || 'Family member' : null);
  }, [members]);

  // Number without the currency symbol — currency is shown once in the
  // column header instead (Elia #1: align the columns cleanly).
  const money = (cents: number | undefined): string => {
    const dec = currencyDecimals(currency);
    const amt = (cents ?? 0) / 100;
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: dec === 0 || amt % 1 === 0 ? 0 : 2,
      maximumFractionDigits: dec === 0 ? 0 : 2,
    }).format(amt);
  };

  const dateStr = (ts?: { toDate?: () => Date } | null): string => {
    const d = ts?.toDate?.();
    return d ? toDisplayDate(isoOf(d)) : '';
  };

  const role = profile?.role;
  const isParent = role === 'parent';

  if (loading) {
    return <div className="mx-auto max-w-3xl px-4 py-16 text-center text-hive-muted font-nunito">Loading…</div>;
  }
  if (!req) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="font-nunito font-black text-xl text-hive-ink">Purchase not found</p>
        <Link href="/pantry/purchase" className="text-pantry-leaf-dk font-bold text-sm">‹ Back to Purchase</Link>
      </div>
    );
  }
  if (!SHAREABLE_STATUSES.includes(req.status)) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-4xl mb-3">🧾</p>
        <p className="font-nunito font-black text-xl text-hive-ink">Printable once approved</p>
        <p className="text-hive-muted text-sm mt-1">This purchase is still <b>{req.status.replace('_', ' ')}</b>. You can print or share it the moment it&apos;s approved.</p>
        <Link href={`/pantry/purchase/${req.id}`} className="inline-block mt-4 text-pantry-leaf-dk font-bold text-sm">‹ Back to the purchase</Link>
      </div>
    );
  }

  const m = MODE_META[mode];
  const showEst = mode !== 'quote';
  const showTick = mode === 'shop';
  const priceIsBlank = mode !== 'record';
  const showCap = mode === 'shop' && isParent;
  const priceHeader = mode === 'quote' ? `Your quote (${currency})` : `Actual (${currency})`;
  const familyName = (family as { name?: string } | null)?.name || 'Your Family';
  const approvedByUid = req.approvedBy?.[0] || req.createdBy;

  return (
    <div className="mx-auto max-w-3xl w-full px-4 lg:px-8 pt-4 lg:pt-8 pb-24">
      <style>{`
        @media print {
          body { visibility: hidden !important; }
          #purchase-print-sheet, #purchase-print-sheet * { visibility: visible !important; }
          #purchase-print-sheet {
            position: absolute; left: 0; top: 0; width: 100%;
            box-shadow: none !important; border: none !important; border-radius: 0 !important;
          }
          .no-print { display: none !important; }
          @page { size: A4; margin: 12mm; }
        }
        #purchase-print-sheet { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        #purchase-print-sheet .writein { border-bottom: 1.6px dotted #b9ac8b; display: inline-block; min-width: 76px; height: 15px; }
        #purchase-print-sheet input.tickbox { width: 20px; height: 20px; border: 1.8px solid #c3b791; border-radius: 6px; -webkit-appearance: none; appearance: none; cursor: pointer; background: #fff; margin: 0; vertical-align: middle; position: relative; }
        #purchase-print-sheet input.tickbox:checked { background: #3E7C4B; border-color: #3E7C4B; }
        #purchase-print-sheet input.tickbox:checked::after { content: "✓"; position: absolute; inset: 0; display: grid; place-items: center; color: #fff; font-size: 13px; font-weight: 900; }
      `}</style>

      {/* ── Action bar (screen only) ─────────────────────────────── */}
      <div className="no-print mb-4">
        <div className="flex items-center justify-between mb-3">
          <Link href={`/pantry/purchase/${req.id}`} className="text-hive-muted text-sm no-underline">‹ Back to purchase</Link>
          <div className="flex gap-2">
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-xs font-nunito font-extrabold px-3.5 py-2 rounded-hive-pill bg-white border border-hive-line text-hive-ink">⬇︎ Download PDF</button>
            <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 text-xs font-nunito font-extrabold px-3.5 py-2 rounded-hive-pill bg-[#17223C] text-white">🖨 Print</button>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {(['shop', 'quote', 'record'] as Mode[]).map((mk) => (
            <button
              key={mk}
              onClick={() => setMode(mk)}
              className={`inline-flex items-center gap-1.5 text-xs font-nunito font-extrabold px-3.5 py-2 rounded-hive-pill border transition ${mode === mk ? 'bg-[#17223C] text-white border-[#17223C]' : 'bg-white text-hive-muted border-hive-line'}`}
            >
              {mk === 'shop' ? '🛒 Shopping list' : mk === 'quote' ? '📋 Request for quote' : '🧾 Approved order'}
            </button>
          ))}
        </div>
      </div>

      {/* ── The printable sheet ──────────────────────────────────── */}
      <div id="purchase-print-sheet" className="bg-white border border-hive-line rounded-hive overflow-hidden shadow-sm">
        {/* Head band */}
        <div className="flex items-start justify-between gap-4 px-6 py-5" style={{ background: '#17223C', color: '#fff' }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl grid place-items-center font-nunito font-black text-xl" style={{ background: '#D2A63E', color: '#2a2205' }}>K</div>
            <div>
              <div className="font-nunito font-extrabold text-lg leading-none">Kaya</div>
              <div className="text-[12px] mt-1" style={{ color: '#c7cfdd' }}>{familyName} · {MODULE_EMOJI[req.module]} {MODULE_LABEL[req.module]}</div>
            </div>
          </div>
          <div className="text-right">
            <span className="inline-block text-[11px] font-extrabold tracking-wider px-3 py-1 rounded-full" style={{ background: 'rgba(255,255,255,.14)', border: '1px solid rgba(255,255,255,.28)' }}>{m.badge}</span>
            <div className="font-nunito font-extrabold text-xl mt-2 leading-tight">{m.kind}</div>
            <div className="text-[12px]" style={{ color: '#c7cfdd' }}>{m.sub}</div>
          </div>
        </div>

        {/* Meta grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 border-b border-hive-line">
          {[
            { k: 'Reference', v: typeof req.seq === 'number' ? formatRequestSeq(req.module, req.seq) : req.name },
            { k: 'Approved', v: dateStr(req.approvedAt) || dateStr(req.createdAt) || '—' },
            { k: 'Approved by', v: nameOf(approvedByUid) || '—' },
            { k: mode === 'quote' ? 'Prepared by' : 'Paid by', v: mode === 'quote' ? (nameOf(profile?.uid) || familyName) : (nameOf(req.paidByUid) || 'Shared') },
          ].map((cell, i) => (
            <div key={i} className="px-4 py-3 border-r border-hive-line last:border-r-0">
              <div className="text-[10px] uppercase tracking-wider text-hive-muted font-extrabold">{cell.k}</div>
              <div className="text-sm font-bold text-hive-ink mt-0.5 break-words">{cell.v}</div>
            </div>
          ))}
        </div>

        {/* Parent-only cap — screen only, NEVER prints/exports (Elia #3) */}
        {showCap && (
          <div className="no-print px-4 pt-4">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-extrabold uppercase tracking-wider" style={{ color: '#2E6B39' }}>Budget cap · this month</span>
              <span className="text-[10px] font-extrabold uppercase tracking-wide px-2 py-0.5 rounded-full" style={{ background: 'rgba(46,107,57,.12)', color: '#2E6B39' }}>👁 Parent-only · not printed</span>
            </div>
            <BudgetBalanceMeter
              module={req.module}
              pendingAmountCents={req.status === 'closed' ? 0 : (req.actualTotalCents ?? req.estimatedTotalCents ?? 0)}
            />
          </div>
        )}

        {/* Items table */}
        <div className="px-2 sm:px-4 pt-3 overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="text-left">
                <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2 w-7">#</th>
                <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2">Item</th>
                <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2 text-right w-12">Qty</th>
                {showEst && <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2 text-right">Est. unit<br /><span className="text-hive-muted">{currency}</span></th>}
                {showEst && <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2 text-right">Est. total<br /><span className="text-hive-muted">{currency}</span></th>}
                <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2 text-right">{mode === 'quote' ? 'Your quote' : 'Actual'}<br /><span className="text-hive-muted">{currency}</span></th>
                {showTick && <th className="text-[10px] uppercase tracking-wide text-hive-muted font-extrabold py-2 px-2 text-center w-14">✓ Got</th>}
              </tr>
            </thead>
            <tbody>
              {req.items.map((it, i) => {
                const estTotal = (it.estimatedCents ?? 0) * (it.qty ?? 0);
                const actual = (it.actualCents != null && it.actualQty != null) ? it.actualCents * it.actualQty : undefined;
                return (
                  <tr key={it.id} className="border-t border-hive-line align-middle">
                    <td className="py-2.5 px-2 text-hive-muted font-bold text-sm">{i + 1}</td>
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-lg grid place-items-center text-base shrink-0" style={{ background: '#EEF4E9' }}>{catEmoji(it.category)}</span>
                        <div>
                          <div className="font-bold text-sm text-hive-ink leading-tight">{it.name}</div>
                          {it.name2 && <div className="text-[12px] italic text-hive-muted leading-tight">{it.name2}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-2 text-right text-sm font-bold tabular-nums">{it.qty}×</td>
                    {showEst && <td className="py-2.5 px-2 text-right text-sm font-bold tabular-nums">{money(it.estimatedCents)}</td>}
                    {showEst && <td className="py-2.5 px-2 text-right text-sm font-bold tabular-nums">{money(estTotal)}</td>}
                    <td className="py-2.5 px-2 text-right text-sm font-bold tabular-nums">
                      {priceIsBlank ? <span className="writein" /> : (actual != null ? money(actual) : <span className="text-hive-muted">—</span>)}
                    </td>
                    {showTick && <td className="py-2.5 px-2 text-center"><input type="checkbox" className="tickbox" aria-label={`Got ${it.name}`} /></td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="flex justify-end gap-8 px-6 py-4 mt-1" style={{ borderTop: '2px solid #E4DAC3' }}>
          {showEst && (
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-hive-muted font-extrabold">Estimated total · {currency}</div>
              <div className="text-xl font-nunito font-black text-hive-ink mt-0.5 tabular-nums">{money(sumEstimated(req.items))}</div>
            </div>
          )}
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-hive-muted font-extrabold">{mode === 'quote' ? 'Quoted total' : 'Actual total'} · {currency}</div>
            {mode === 'record' && sumActual(req.items) > 0
              ? <div className="text-xl font-nunito font-black text-hive-ink mt-0.5 tabular-nums">{money(sumActual(req.items))}</div>
              : <div className="text-xl font-nunito font-black mt-0.5" style={{ color: '#b9ac8b', borderBottom: '1.8px dotted #b9ac8b', minWidth: 120, display: 'inline-block' }}>&nbsp;</div>}
          </div>
        </div>

        {/* Footer — signatures + running tally + notes */}
        <div className="grid sm:grid-cols-[1.4fr_.9fr] gap-5 p-6 border-t border-hive-line" style={{ background: '#FFFDF7' }}>
          <div>
            <div className="flex gap-6">
              <div className="flex-1">
                <div style={{ borderBottom: '1.6px solid #cabf9f', height: 32 }} />
                <div className="text-[12px] text-hive-muted font-bold mt-1.5">{mode === 'quote' ? 'Supplier (name + sign)' : 'Bought / supplied by (name + sign)'}</div>
              </div>
              <div className="flex-1">
                <div style={{ borderBottom: '1.6px solid #cabf9f', height: 32 }} />
                <div className="text-[12px] text-hive-muted font-bold mt-1.5">{mode === 'quote' ? 'Date quoted' : 'Date returned'}</div>
              </div>
            </div>
            <div className="text-[12px] text-hive-muted mt-3.5">
              {req.note ? <span><b>Note:</b> {req.note}<br /></span> : null}
              {mode === 'quote'
                ? 'Please quote your best price per item. Thank you. 🙏'
                : 'Prices are estimates for guidance — write the real price next to each item and bring the receipt back for reconcile. 🙏'}
            </div>
          </div>
          {mode !== 'record' && (
            <div className="rounded-hive p-3.5" style={{ background: '#fff', border: '1px dashed #E4DAC3' }}>
              <div className="text-[10px] uppercase tracking-wider text-hive-muted font-extrabold mb-2">🧮 Running tally</div>
              {[0, 1, 2, 3, 4].map((r) => (<div key={r} style={{ height: 20, borderBottom: r === 4 ? 'none' : '1px dotted #d8cdac' }} />))}
            </div>
          )}
        </div>

        <div className="text-center text-[11px] text-hive-muted py-3">
          Generated by Kaya · ourkaya.com{typeof req.seq === 'number' ? ` · ${formatRequestSeq(req.module, req.seq)}` : ''} · {req.items.length} items
        </div>
      </div>

      <p className="no-print text-center text-[12px] text-hive-muted mt-4">
        Tip: “Download PDF” opens your print dialog — choose <b>Save as PDF</b> as the destination. The parent-only cap never appears in the printed/exported sheet.
      </p>
    </div>
  );
}
