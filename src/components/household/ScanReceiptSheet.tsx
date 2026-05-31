'use client';

// Household → Subscriptions → "Add from receipt" (Phase 1 auto-detect).
//
// Parent pastes a receipt / billing email OR uploads a screenshot/PDF
// page. Claude parses it into subscription drafts; the parent ticks the
// ones to add + tweaks anything, and Kaya creates them. Nothing is
// written without an explicit confirm — auto-detect SUGGESTS only.
//
// Reuses scanReceiptText / scanReceiptImage from lib/subscriptions; each
// confirmed draft lands via createSubscription (Auto billing for store
// receipts, paidByUid = the parent doing the import by default).

import { useEffect, useState } from 'react';
import {
  scanReceiptText, scanReceiptImage, createSubscription,
  type ParsedSubscriptionDraft, type SubscriptionCategory, type SubscriptionFrequency,
} from '@/lib/subscriptions';

function newClientToken(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'tok_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** A draft to review, optionally tied to a stored Gmail suggestion so the
 *  page can mark it added/dismissed once the parent decides. */
export type ReviewDraft = ParsedSubscriptionDraft & { suggestionId?: string };

interface Props {
  open: boolean;
  onClose: () => void;
  onImported: (count: number) => void;
  familyId: string;
  uid: string;
  /** Family display currency — used as the parse hint + the storage
   *  currency when a receipt doesn't state its own. */
  currency: string;
  /** When provided, the sheet opens straight into the review checklist
   *  with these drafts (e.g. from a Gmail scan) instead of the paste/upload
   *  input. The parent still ticks + confirms each one. */
  initialDrafts?: ReviewDraft[] | null;
  /** Called after import when the drafts came from Gmail suggestions:
   *  addedIds = suggestions turned into subs, dismissedIds = the rest. */
  onResolve?: (addedIds: string[], dismissedIds: string[]) => void;
}

// A receipt rarely tells us a Kaya category; default by platform —
// store subs → mobile_apps, everything else → media (the most common
// direct sub). The parent can re-categorise on the row after import.
function defaultCategory(d: ParsedSubscriptionDraft): { category: SubscriptionCategory; subCategory: string } {
  if (d.platform === 'ios')     return { category: 'mobile_apps', subCategory: 'iOS App' };
  if (d.platform === 'android') return { category: 'mobile_apps', subCategory: 'Android App' };
  return { category: 'media', subCategory: 'Streaming Video' };
}

type Row = ParsedSubscriptionDraft & { picked: boolean; key: string; suggestionId?: string };

export default function ScanReceiptSheet({ open, onClose, onImported, familyId, uid, currency, initialDrafts, onResolve }: Props) {
  const [mode, setMode] = useState<'input' | 'review'>('input');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<Row[]>([]);

  const reset = () => {
    setMode('input'); setText(''); setBusy(false); setError(''); setNote(''); setRows([]);
  };
  const close = () => { reset(); onClose(); };

  // When opened with drafts already in hand (Gmail scan), jump straight to
  // the review checklist. Keyed on open so a fresh scan re-seeds the rows.
  useEffect(() => {
    if (open && initialDrafts && initialDrafts.length > 0) {
      setRows(initialDrafts.map((s, i) => ({ ...s, picked: true, key: `g-${i}-${s.name}`, suggestionId: s.suggestionId })));
      setMode('review');
      setError(''); setNote('');
    }
  }, [open, initialDrafts]);

  const handleResult = (subs: ParsedSubscriptionDraft[], skipped?: boolean, err?: string) => {
    if (skipped) { setError('AI is off in this preview — paste the details into "Add manually" instead.'); return; }
    if (err) { setError(err); return; }
    if (subs.length === 0) { setError("Couldn't spot a subscription in that — try a clearer receipt, or add it manually."); return; }
    setRows(subs.map((s, i) => ({ ...s, picked: true, key: `${i}-${s.name}` })));
    setMode('review');
  };

  const scanText = async () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError('');
    try {
      const out = await scanReceiptText(text.trim(), currency);
      handleResult(out.subscriptions, out.skipped, out.error);
    } finally { setBusy(false); }
  };

  const scanImage: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setBusy(true); setError('');
    try {
      const out = await scanReceiptImage(file, currency);
      handleResult(out.subscriptions, out.skipped, out.error);
    } finally { setBusy(false); }
  };

  const importPicked = async () => {
    const picked = rows.filter((r) => r.picked && r.name.trim() && r.amount > 0);
    if (picked.length === 0 || busy) return;
    setBusy(true); setError('');
    let ok = 0;
    const addedIds: string[] = [];          // Gmail suggestions turned into subs
    try {
      const today = new Date();
      const fallbackNext = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      for (const r of picked) {
        const { category, subCategory } = defaultCategory(r);
        const cur = r.currency || currency;
        try {
          await createSubscription({
            familyId,
            name: r.name.trim(),
            catalogueRef: null,
            category,
            subCategory,
            platform: r.platform,
            billingMode: 'auto',          // store receipts are auto-renew by nature
            status: 'active',
            amountOriginalCents: Math.round(r.amount * 100),
            currencyOriginal: cur,
            fxRate: 1,                     // same-currency default; parent can fix on the row
            frequency: r.cadence as SubscriptionFrequency,
            customMonths: null,
            nextBillingDateIso: r.nextBilling || fallbackNext,
            startedOnIso: fallbackNext,
            accountHolderUid: uid,
            beneficiaryUids: [],
            paidByUid: uid,                // importing parent owns it by default
            isProfessionalExpense: false,
            reminderDaysBefore: [7, 2, 0],
            createdByUid: uid,
            clientToken: newClientToken(),
          });
          ok += 1;
          if (r.suggestionId) addedIds.push(r.suggestionId);
        } catch { /* skip the one that failed; keep importing the rest */ }
      }
      // If these drafts came from Gmail suggestions, mark the outcome:
      // added = created OK; dismissed = unticked (so it won't nag again).
      // A picked row whose creation failed stays pending (neither bucket).
      const hasSuggestions = rows.some((r) => r.suggestionId);
      if (hasSuggestions && onResolve) {
        const dismissedIds = rows
          .filter((r) => r.suggestionId && !r.picked)
          .map((r) => r.suggestionId as string);
        onResolve(addedIds, dismissedIds);
      }
      onImported(ok);
      close();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-3 bg-black/40" onClick={close}>
      <div onClick={(e) => e.stopPropagation()} className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto bg-white rounded-3xl shadow-2xl p-5 space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="font-display font-extrabold text-[18px] text-pulse-navy">📩 Add from receipt</h3>
          <button type="button" onClick={close} className="text-xs font-bold text-pulse-navy/55">Close</button>
        </div>

        {mode === 'input' && (
          <>
            <p className="text-[12.5px] text-pulse-navy/65 leading-snug">
              Paste an App Store / Google Play / service receipt — or upload a screenshot. Kaya reads it and lists the subscriptions for you to confirm. Nothing is added until you tick + save.
            </p>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={6}
              placeholder="Paste the receipt email text here…"
              className="w-full bg-white border border-pulse-navy/15 rounded-kaya-sm px-3 py-2 text-[13px] text-pulse-navy focus:outline-none focus:border-pulse-gold resize-none"
            />
            {error && <div className="text-[12px] font-bold text-pulse-coral">{error}</div>}
            <div className="flex items-center gap-2">
              <label className="flex-1 cursor-pointer rounded-kaya-sm bg-white border border-pulse-navy/15 text-pulse-navy font-extrabold text-[13px] py-2.5 text-center hover:bg-pulse-navy/5 transition">
                📷 Upload screenshot
                <input type="file" accept="image/*" capture="environment" onChange={scanImage} className="hidden" />
              </label>
              <button
                type="button"
                onClick={scanText}
                disabled={!text.trim() || busy}
                className="flex-1 rounded-kaya-sm bg-pulse-gold text-pulse-navy font-extrabold text-[13px] py-2.5 disabled:opacity-40"
              >
                {busy ? 'Reading…' : '✨ Read receipt'}
              </button>
            </div>
          </>
        )}

        {mode === 'review' && (
          <>
            <p className="text-[12.5px] text-pulse-navy/65">
              Found {rows.length} subscription{rows.length === 1 ? '' : 's'}. Tick the ones to add — edit anything first.
            </p>
            <div className="space-y-2">
              {rows.map((r, idx) => (
                <div key={r.key} className={`rounded-kaya border p-3 ${r.picked ? 'border-pulse-gold bg-pulse-gold/8' : 'border-pulse-navy/15 bg-white opacity-70'}`}>
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => setRows((p) => p.map((x, i) => i === idx ? { ...x, picked: !x.picked } : x))}
                      aria-pressed={r.picked}
                      className={`w-5 h-5 rounded-md border-[1.5px] grid place-items-center text-[11px] font-black shrink-0 ${r.picked ? 'bg-pulse-gold border-pulse-gold text-pulse-navy' : 'border-pulse-navy/25 text-transparent'}`}
                    >✓</button>
                    <input
                      value={r.name}
                      onChange={(e) => setRows((p) => p.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))}
                      className="flex-1 min-w-0 bg-transparent font-bold text-[13.5px] text-pulse-navy focus:outline-none"
                    />
                    <span className="text-[10px] font-extrabold uppercase tracking-wide bg-pulse-navy/8 text-pulse-navy/60 px-1.5 py-0.5 rounded shrink-0">
                      {r.platform}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-2 pl-7">
                    <input
                      type="number" step="0.01" min="0"
                      value={r.amount}
                      onChange={(e) => setRows((p) => p.map((x, i) => i === idx ? { ...x, amount: Number(e.target.value) } : x))}
                      className="w-24 bg-white border border-pulse-navy/15 rounded px-2 py-1 text-[12.5px] font-bold focus:outline-none"
                    />
                    <span className="text-[11px] font-bold text-pulse-navy/55">{r.currency || currency}</span>
                    <select
                      value={r.cadence}
                      onChange={(e) => setRows((p) => p.map((x, i) => i === idx ? { ...x, cadence: e.target.value as SubscriptionFrequency } : x))}
                      className="bg-white border border-pulse-navy/15 rounded px-2 py-1 text-[12px] font-semibold focus:outline-none"
                    >
                      <option value="monthly">/month</option>
                      <option value="quarterly">/quarter</option>
                      <option value="semi_annual">/6 months</option>
                      <option value="annual">/year</option>
                      <option value="weekly">/week</option>
                    </select>
                  </div>
                </div>
              ))}
            </div>
            {error && <div className="text-[12px] font-bold text-pulse-coral">{error}</div>}
            <div className="flex items-center gap-2 pt-1">
              <button type="button" onClick={() => { setMode('input'); setRows([]); }} className="px-4 py-2.5 rounded-kaya-sm text-[13px] font-bold text-pulse-navy/65 hover:bg-pulse-navy/5">← Back</button>
              <button
                type="button"
                onClick={importPicked}
                disabled={busy || rows.every((r) => !r.picked)}
                className="flex-1 rounded-kaya-sm bg-pulse-gold text-pulse-navy font-extrabold text-[13px] py-2.5 disabled:opacity-40"
              >
                {busy ? 'Adding…' : `Add ${rows.filter((r) => r.picked).length} subscription${rows.filter((r) => r.picked).length === 1 ? '' : 's'}`}
              </button>
            </div>
            <p className="text-[10.5px] text-pulse-navy/45 leading-snug">
              Imported as Auto-billing · attributed to you · default reminders (7d / 2d / day-of). Edit any of that on the subscription afterward.
            </p>
          </>
        )}
        {note && <div className="text-[12px] font-bold text-pulse-green">{note}</div>}
      </div>
    </div>
  );
}
