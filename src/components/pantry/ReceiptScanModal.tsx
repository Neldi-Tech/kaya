'use client';

// ReceiptScanModal — the "📷 Scan → 🤖 read → 📝 review → ✓ apply" flow.
//
// Given a picked receipt photo, it calls /api/receipt-scan, then shows an
// EDITABLE review (line items + total) the parent must confirm before
// anything is applied — the model never writes straight to a request.
// `onApply` hands the reviewed result back to the caller, which decides
// how to use it (fill line items, or just take the total for an
// amount-only log). Reusable across the dine-out log + the purchase
// post/reconcile screen.

import { useEffect, useMemo, useState } from 'react';
import { formatCents } from '@/components/pantry/format';
import { scanReceipt, type ScannedItem, type ScanResult } from '@/lib/receiptScan';

const DINE = '#C2562E';

type Phase = 'scanning' | 'review' | 'error';

export default function ReceiptScanModal({
  file, currency, existingItemNames = [], applyLabel = 'Apply', onApply, onClose,
}: {
  file: File;
  currency: string;
  /** Lowercased names of the request's current lines, to flag matched vs new. */
  existingItemNames?: string[];
  applyLabel?: string;
  onApply: (result: ScanResult) => void;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('scanning');
  const [errorMsg, setErrorMsg] = useState('');
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [totalCents, setTotalCents] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await scanReceipt(file, currency);
        if (cancelled) return;
        if (!res) { setErrorMsg('AI scanning isn’t enabled — enter the amounts manually.'); setPhase('error'); return; }
        setItems(res.items);
        setTotalCents(res.totalCents);
        setPhase('review');
      } catch (e) {
        if (cancelled) return;
        setErrorMsg(e instanceof Error ? e.message : 'Could not read that receipt.');
        setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [file, currency]);

  const existing = useMemo(() => new Set(existingItemNames.map((n) => n.toLowerCase())), [existingItemNames]);
  const lineSum = items.reduce((s, it) => s + it.unitPriceCents * it.qty, 0);
  const mismatch = totalCents > 0 && lineSum > 0 && Math.abs(lineSum - totalCents) > Math.max(100, totalCents * 0.02);

  const setItem = (idx: number, patch: Partial<ScannedItem>) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  const removeItem = (idx: number) => setItems((prev) => prev.filter((_, i) => i !== idx));

  const apply = () => {
    onApply({ items, totalCents, currency });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-hive-paper w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-hive-line shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-hive-paper border-b border-hive-line px-4 py-3 flex items-center justify-between z-10">
          <h2 className="font-nunito font-black text-base">📷 Scan receipt</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full bg-hive-cream text-hive-muted text-base font-black flex items-center justify-center">✕</button>
        </div>

        {phase === 'scanning' && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 px-4 text-center">
            <div className="w-16 h-20 rounded-lg border border-hive-line bg-white relative overflow-hidden">
              <div className="absolute left-1 right-1 h-0.5 animate-pulse" style={{ background: DINE, top: '50%' }} />
            </div>
            <p className="font-nunito font-black text-sm" style={{ color: DINE }}>🤖 Reading your receipt…</p>
            <p className="text-[11px] text-hive-muted">name · quantity · price</p>
          </div>
        )}

        {phase === 'error' && (
          <div className="px-4 py-10 text-center">
            <div className="text-3xl mb-2">🧾</div>
            <p className="text-sm text-hive-muted font-bold">{errorMsg}</p>
            <button type="button" onClick={onClose}
              className="mt-4 text-white rounded-hive px-4 py-2 font-nunito font-black text-sm" style={{ background: DINE }}>
              Enter manually
            </button>
          </div>
        )}

        {phase === 'review' && (
          <div className="p-4">
            <div className="flex items-baseline justify-between mb-1">
              <p className="font-nunito font-black text-sm">Review {items.length > 0 ? `· ${items.length} item${items.length === 1 ? '' : 's'}` : ''}</p>
              <p className="text-[11px] text-hive-muted">Tap any value to edit</p>
            </div>

            {items.length === 0 && totalCents === 0 ? (
              <p className="text-[12px] text-hive-muted italic py-3">Couldn’t read line items — type the amount manually, or try a clearer photo.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {items.map((it, idx) => {
                  const isNew = it.name && !existing.has(it.name.toLowerCase());
                  return (
                    <div key={idx} className="flex items-center gap-2 bg-white border border-hive-line rounded-hive p-2">
                      {existingItemNames.length > 0 && (
                        <span className={`text-[8px] font-nunito font-black uppercase tracking-wide px-1.5 py-0.5 rounded ${isNew ? 'text-[#9a6b12] bg-[#FFF3D9] border border-[#E8C3AE]' : 'text-pantry-leaf-dk bg-pantry-leaf-soft'}`}>
                          {isNew ? 'New' : '✓'}
                        </span>
                      )}
                      <input
                        type="text" value={it.name} onChange={(e) => setItem(idx, { name: e.target.value.slice(0, 60) })}
                        className="flex-1 min-w-0 bg-transparent text-[12.5px] font-bold focus:outline-none"
                        placeholder="Item"
                      />
                      <input
                        type="number" inputMode="numeric" min="1" value={it.qty}
                        onChange={(e) => setItem(idx, { qty: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })}
                        className="w-10 bg-transparent text-[12px] text-hive-muted text-center focus:outline-none"
                        aria-label="Quantity"
                      />
                      <div className="flex items-center gap-1 border border-hive-line rounded px-1.5 py-0.5">
                        <span className="text-[10px] text-hive-muted font-bold">{currency}</span>
                        <input
                          type="number" inputMode="decimal" min="0" value={it.unitPriceCents / 100}
                          onChange={(e) => setItem(idx, { unitPriceCents: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)) })}
                          className="w-16 bg-transparent text-[12px] font-nunito font-black text-right focus:outline-none"
                          aria-label="Unit price"
                        />
                      </div>
                      <button type="button" onClick={() => removeItem(idx)} aria-label="Remove" className="text-hive-muted text-sm font-black px-0.5">×</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Total + cross-check */}
            <div className="mt-3 flex items-center justify-between bg-hive-cream rounded-hive px-3 py-2">
              <span className="text-[11px] uppercase tracking-wider text-hive-muted font-bold">Total paid</span>
              <div className="flex items-center gap-1">
                <span className="text-[11px] text-hive-muted font-bold">{currency}</span>
                <input
                  type="number" inputMode="decimal" min="0" value={totalCents / 100}
                  onChange={(e) => setTotalCents(Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 100)))}
                  className="w-24 bg-transparent text-lg font-nunito font-black text-right focus:outline-none"
                  aria-label="Total"
                />
              </div>
            </div>
            {mismatch && (
              <p className="text-[11px] text-hive-rose font-bold mt-1.5">
                ⚠ Lines add to {formatCents(lineSum, currency)} but the total says {formatCents(totalCents, currency)} — check before applying.
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <button type="button" onClick={onClose}
                className="flex-1 rounded-hive py-2.5 font-nunito font-black text-sm bg-white border border-hive-line text-hive-muted">
                Discard
              </button>
              <button type="button" onClick={apply} disabled={totalCents === 0 && items.length === 0}
                className="flex-1 rounded-hive py-2.5 font-nunito font-black text-sm text-white disabled:opacity-50" style={{ background: DINE }}>
                ✓ {applyLabel}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
