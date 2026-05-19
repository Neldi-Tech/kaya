// TodaysWorkplanCard — helper's daily check-off view. Extracted from
// /helper/page.tsx on 2026-05-19 so /pantry/workplan can render the
// same daily view for helpers instead of the parent's WorkplanEditor.
'use client';

import { useEffect, useState } from 'react';
import type { WorkplanItem, WorkplanCompletion, WorkplanPeriod } from '@/lib/firestore';
import {
  listWorkplanItems, itemsScheduledOn, groupItemsByPeriod, partitionByKind,
  getCompletion, toggleItemCompletion, setEodNote, dailyCompletionPct,
} from '@/lib/workplan';
import { ClipboardList, Check } from 'lucide-react';

// ── Today's workplan card ─────────────────────────
// Icon-first checklist for the helper's day. Loads items + today's
// completion in parallel; tapping a tile toggles its presence in
// the day's completion doc. EoD note auto-saves on blur. Designed
// to work for low-literacy helpers — big emoji tiles, single tap
// to mark done, no nested menus.
export default function TodaysWorkplanCard({ familyId, helperUid }: {
  familyId: string;
  helperUid: string;
}) {
  const [items, setItems] = useState<WorkplanItem[] | null>(null);
  const [completion, setCompletion] = useState<WorkplanCompletion | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [its, comp] = await Promise.all([
        listWorkplanItems(familyId, helperUid),
        getCompletion(familyId, helperUid),
      ]);
      if (cancelled) return;
      setItems(its);
      setCompletion(comp);
      setNoteDraft(comp?.eodNote ?? '');
    })();
    return () => { cancelled = true; };
  }, [familyId, helperUid]);

  if (items === null) return null;
  const scheduled = itemsScheduledOn(items);
  if (scheduled.length === 0) return null; // nothing on today's plan

  // v4-final §04 Step 7 — partition adhoc one-offs out of the regular
  // morning/anytime/evening grid. Ad-hoc items render in their own
  // honey-tinted strip above the recurring sections so the helper
  // can't miss "the new thing the parent assigned today".
  const { adhoc: adhocToday, recurring: recurringToday } = partitionByKind(scheduled);
  const grouped = groupItemsByPeriod(recurringToday);
  const done = completion?.completedItemIds ?? [];
  // Percent + count include adhoc + recurring — they're equally weighted
  // since the helper has to do both.
  const pct = dailyCompletionPct(scheduled, completion);
  const doneCount = scheduled.filter((i) => done.includes(i.id)).length;

  const toggle = async (itemId: string) => {
    setBusyItem(itemId);
    try {
      await toggleItemCompletion(familyId, helperUid, itemId, helperUid);
      const next = await getCompletion(familyId, helperUid);
      setCompletion(next);
    } finally { setBusyItem(null); }
  };

  const saveNote = async () => {
    if (noteDraft === (completion?.eodNote ?? '')) return;
    setNoteSaving(true);
    try {
      await setEodNote(familyId, helperUid, noteDraft, helperUid);
      const next = await getCompletion(familyId, helperUid);
      setCompletion(next);
    } finally { setNoteSaving(false); }
  };

  return (
    <div className="mb-5 lg:mb-7 bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-kaya-sand inline-flex items-center gap-1.5">
            <ClipboardList size={13} /> Your workplan today
          </p>
          <p className="text-[11px] text-kaya-sand mt-0.5">
            {doneCount} of {scheduled.length} done · {pct}%
          </p>
        </div>
        {/* Big circular progress badge */}
        <div className={`flex items-center justify-center w-12 h-12 rounded-full font-display font-black text-sm flex-shrink-0 ${
          pct === 100
            ? 'bg-green-100 text-green-700 border-2 border-green-400'
            : pct >= 50
              ? 'bg-kaya-gold-light/40 text-kaya-chocolate border-2 border-kaya-gold'
              : 'bg-kaya-cream text-kaya-sand border-2 border-kaya-warm-dark'
        }`}>
          {pct}%
        </div>
      </div>

      {/* ── Ad-hoc one-offs ── parent-assigned tasks just for today,
          honey-tinted strip so the helper notices them. Each tile
          shows the optional note under the label. */}
      {adhocToday.length > 0 && (
        <div className="mb-3 -mx-1 px-3 py-2.5 bg-[#FFF3D9] border-2 border-hive-honey rounded-kaya">
          <p className="text-[10px] uppercase tracking-wider text-hive-honey-dk font-bold mb-2 inline-flex items-center gap-1.5">
            <span>✨ Ad-hoc · just for today</span>
            <span className="text-[9px] text-hive-muted normal-case font-normal">({adhocToday.length} one-off{adhocToday.length === 1 ? '' : 's'})</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {adhocToday.map((item) => {
              const isDone = done.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={busyItem === item.id}
                  onClick={() => toggle(item.id)}
                  className={`relative aspect-square flex flex-col items-center justify-center gap-0.5 p-2 rounded-kaya border-2 transition-all ${isDone
                    ? 'bg-green-50 border-green-400 hover:bg-green-100'
                    : 'bg-white border-hive-honey-dk hover:shadow-sm'
                  } ${busyItem === item.id ? 'opacity-50' : ''}`}
                  aria-pressed={isDone}
                >
                  <span className="absolute top-1 left-1 text-[8px] uppercase tracking-wider font-black bg-hive-honey-dk text-white px-1 rounded">
                    Ad-hoc
                  </span>
                  <span className="text-3xl lg:text-4xl mt-2">{item.icon}</span>
                  <span className={`text-[10px] lg:text-[11px] font-bold text-center leading-tight line-clamp-2 px-1 ${isDone ? 'text-green-800' : 'text-kaya-chocolate'}`}>
                    {item.label}
                  </span>
                  {item.note && (
                    <span className="text-[9px] italic text-kaya-sand text-center leading-tight line-clamp-2 px-1">
                      &ldquo;{item.note}&rdquo;
                    </span>
                  )}
                  {isDone && (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {(['morning', 'anytime', 'evening'] as WorkplanPeriod[]).map((period) => (
        grouped[period].length > 0 && (
          <div key={period} className="mb-3 last:mb-0">
            <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold mb-2">
              {period === 'morning' ? '☀️ Morning' : period === 'evening' ? '🌙 Evening' : '⏱️ Anytime'}
            </p>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
              {grouped[period].map((item) => {
                const isDone = done.includes(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busyItem === item.id}
                    onClick={() => toggle(item.id)}
                    className={`relative aspect-square flex flex-col items-center justify-center gap-1 p-2 rounded-kaya border-2 transition-all ${isDone
                      ? 'bg-green-50 border-green-400 hover:bg-green-100'
                      : 'bg-white border-kaya-warm-dark hover:border-kaya-chocolate hover:shadow-sm'
                    } ${busyItem === item.id ? 'opacity-50' : ''}`}
                    aria-pressed={isDone}
                  >
                    <span className="text-3xl lg:text-4xl">{item.icon}</span>
                    <span className={`text-[10px] lg:text-[11px] font-bold text-center leading-tight line-clamp-2 ${isDone ? 'text-green-800' : 'text-kaya-chocolate'}`}>
                      {item.label}
                    </span>
                    {isDone && (
                      <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )
      ))}

      {/* End-of-day note */}
      <div className="mt-4 pt-4 border-t border-kaya-warm-dark/40">
        <label className="block">
          <span className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1.5">
            📝 End-of-day note
            {noteSaving && <span className="text-amber-600 font-bold normal-case">· Saving…</span>}
            {!noteSaving && completion?.eodNote && noteDraft === completion.eodNote && (
              <span className="text-green-700 font-bold normal-case inline-flex items-center gap-0.5">· <Check size={10} /> Saved</span>
            )}
          </span>
          <textarea
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={saveNote}
            placeholder="Anything to flag from today? (optional)"
            rows={2}
            className="mt-1 w-full px-3 py-2 text-sm bg-kaya-cream border border-kaya-warm-dark rounded-kaya focus:outline-none focus:border-kaya-chocolate resize-none"
          />
        </label>
        <p className="text-[10px] text-kaya-sand mt-1">Saves when you tap outside the box.</p>
      </div>
    </div>
  );
}
