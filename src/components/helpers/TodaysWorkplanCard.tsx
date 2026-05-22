// TodaysWorkplanCard — helper's daily check-off view. Extracted from
// /helper/page.tsx on 2026-05-19 so /pantry/workplan can render the
// same daily view for helpers instead of the parent's WorkplanEditor.
//
// 2026-05-21 — day-stepper support. The card now takes an optional
// `date` (defaults to today) + `readOnly` flag so the Workplan page can
// point it at ANY day:
//   • today (default)  — live, tap-to-tick, editable EoD note.
//   • past (readOnly)  — settled record: the day's ticks + result %,
//                        no editing. Works for parent + helper.
//   • future (readOnly)— plan preview: the tasks that will fall on that
//                        day, dashed + un-ticked, no performance.
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { WorkplanItem, WorkplanCompletion, WorkplanPeriod } from '@/lib/firestore';
import {
  listWorkplanItems, itemsScheduledOn, groupItemsByPeriod, partitionByKind,
  getCompletion, toggleItemCompletion, setEodNote,
  todayDateString,
} from '@/lib/workplan';
import {
  subscribeToOwnerTasks, subscribeToTrackables,
  type PulseTask, type Trackable,
} from '@/lib/pulse';
import { toDisplayDate } from '@/lib/dates';
import { ClipboardList, Check, CalendarDays, Gauge, ChevronRight } from 'lucide-react';

// A Pulse reading task counts as "done" once it's been logged (or has
// since moved through review/closed in the reconcile loop).
const PULSE_DONE: ReadonlyArray<PulseTask['status']> = ['logged', 'review', 'closed'];
const isPulseDone = (t: PulseTask) => PULSE_DONE.includes(t.status);

// ── Today's workplan card ─────────────────────────
// Icon-first checklist for the helper's day. Loads items + the day's
// completion in parallel; tapping a tile toggles its presence in
// the day's completion doc. EoD note auto-saves on blur. Designed
// to work for low-literacy helpers — big emoji tiles, single tap
// to mark done, no nested menus.
export default function TodaysWorkplanCard({ familyId, helperUid, date, readOnly = false }: {
  familyId: string;
  helperUid: string;
  /** Which calendar day to show. Defaults to today. */
  date?: Date;
  /** Render as a settled record (past) / preview (future) — no
   *  tap-to-tick, no editable note. Used by the Workplan day-stepper. */
  readOnly?: boolean;
}) {
  // Local-time day keys (never UTC) so the helper's "day" matches their
  // phone clock — Kaya helpers span timezones worldwide.
  const dateStr = todayDateString(date);
  const todayStr = todayDateString();
  const isToday = dateStr === todayStr;
  const isFuture = dateStr > todayStr;

  const [items, setItems] = useState<WorkplanItem[] | null>(null);
  const [completion, setCompletion] = useState<WorkplanCompletion | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [busyItem, setBusyItem] = useState<string | null>(null);
  const [noteSaving, setNoteSaving] = useState(false);
  // Kaya Pulse reading tasks for this owner + day (2026-05-23). Surfaces
  // the helper's assigned utility/meter readings inside the same daily
  // card so "what do I have to do today" is one place. Realtime so a log
  // flips the tile to ✓ without a refresh. `trackById` resolves each
  // task's name + emoji for a friendly tile.
  const [pulseTasks, setPulseTasks] = useState<PulseTask[] | null>(null);
  const [trackById, setTrackById] = useState<Record<string, Trackable>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [its, comp] = await Promise.all([
        listWorkplanItems(familyId, helperUid),
        getCompletion(familyId, helperUid, dateStr),
      ]);
      if (cancelled) return;
      setItems(its);
      setCompletion(comp);
      setNoteDraft(comp?.eodNote ?? '');
    })();
    return () => { cancelled = true; };
  }, [familyId, helperUid, dateStr]);

  useEffect(() => {
    const unsubTasks = subscribeToOwnerTasks(familyId, helperUid, dateStr, setPulseTasks);
    const unsubTr = subscribeToTrackables(familyId, (list) => {
      setTrackById(Object.fromEntries(list.map((t) => [t.id, t])));
    });
    return () => { unsubTasks(); unsubTr(); };
  }, [familyId, helperUid, dateStr]);

  // Wait for BOTH stores so a readings-only helper (no workplan items)
  // doesn't flash an empty card before their Pulse tasks arrive.
  if (items === null || pulseTasks === null) return null;
  const scheduled = itemsScheduledOn(items, date);
  const pulseForDay = pulseTasks;
  const pulseDoneCount = pulseForDay.filter(isPulseDone).length;
  if (scheduled.length === 0 && pulseForDay.length === 0) {
    // Today / helper-home: render nothing rather than an empty card.
    // Read-only day views DO show a friendly note so the card doesn't
    // silently vanish when you step to a day with nothing scheduled.
    if (!readOnly) return null;
    return (
      <div className="mb-5 lg:mb-7 bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-5">
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-kaya-sand inline-flex items-center gap-1.5">
          {isFuture ? <CalendarDays size={13} /> : <ClipboardList size={13} />}
          {isFuture ? 'Planned' : 'Workplan'} · {toDisplayDate(dateStr)}
        </p>
        <p className="text-[12px] text-kaya-sand mt-2">Nothing scheduled for this day.</p>
      </div>
    );
  }

  // v4-final §04 Step 7 — partition adhoc one-offs out of the regular
  // morning/anytime/evening grid. Ad-hoc items render in their own
  // honey-tinted strip above the recurring sections so the helper
  // can't miss "the new thing the parent assigned".
  const { adhoc: adhocToday, recurring: recurringToday } = partitionByKind(scheduled);
  const grouped = groupItemsByPeriod(recurringToday);
  const done = completion?.completedItemIds ?? [];
  // Combined progress — workplan items (adhoc + recurring) AND Pulse
  // readings are equally weighted, since the helper has to do both. This
  // is the day's single % progress (Elia's addition #1).
  const workplanDone = scheduled.filter((i) => done.includes(i.id)).length;
  const totalCount = scheduled.length + pulseForDay.length;
  const doneCount = workplanDone + pulseDoneCount;
  const pct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  const toggle = async (itemId: string) => {
    if (readOnly) return;
    setBusyItem(itemId);
    try {
      await toggleItemCompletion(familyId, helperUid, itemId, helperUid, dateStr);
      const next = await getCompletion(familyId, helperUid, dateStr);
      setCompletion(next);
    } finally { setBusyItem(null); }
  };

  const saveNote = async () => {
    if (readOnly) return;
    if (noteDraft === (completion?.eodNote ?? '')) return;
    setNoteSaving(true);
    try {
      await setEodNote(familyId, helperUid, noteDraft, helperUid, dateStr);
      const next = await getCompletion(familyId, helperUid, dateStr);
      setCompletion(next);
    } finally { setNoteSaving(false); }
  };

  return (
    <div className="mb-5 lg:mb-7 bg-white border border-kaya-warm-dark rounded-kaya-lg p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-kaya-sand inline-flex items-center gap-1.5">
            {isFuture ? <CalendarDays size={13} /> : <ClipboardList size={13} />}
            {isToday ? 'Your workplan today' : `${isFuture ? 'Planned' : 'Workplan'} · ${toDisplayDate(dateStr)}`}
          </p>
          <p className="text-[11px] text-kaya-sand mt-0.5">
            {isFuture
              ? `${totalCount} task${totalCount === 1 ? '' : 's'} planned · nothing done yet`
              : `${doneCount} of ${totalCount} done · ${pct}%`}
            {pulseForDay.length > 0 && (
              <span className="text-kaya-sand"> · 📊 {pulseDoneCount}/{pulseForDay.length} readings</span>
            )}
          </p>
        </div>
        {/* Progress badge — % for today/past; calendar glyph for a future
            preview (a 0% there would read as a failing day). */}
        {isFuture ? (
          <div className="flex items-center justify-center w-12 h-12 rounded-full flex-shrink-0 bg-kaya-cream text-kaya-sand border-2 border-kaya-warm-dark">
            <CalendarDays size={18} />
          </div>
        ) : (
          <div className={`flex items-center justify-center w-12 h-12 rounded-full font-display font-black text-sm flex-shrink-0 ${
            pct === 100
              ? 'bg-green-100 text-green-700 border-2 border-green-400'
              : pct >= 50
                ? 'bg-kaya-gold-light/40 text-kaya-chocolate border-2 border-kaya-gold'
                : 'bg-kaya-cream text-kaya-sand border-2 border-kaya-warm-dark'
          }`}>
            {pct}%
          </div>
        )}
      </div>

      {/* Slim progress bar — a quick visual of the day's % (Elia's
          addition #1). Hidden on a future preview (nothing done yet). */}
      {!isFuture && totalCount > 0 && (
        <div className="mb-3 h-2 w-full rounded-full bg-kaya-cream overflow-hidden" aria-hidden>
          <div
            className={`h-full rounded-full transition-all ${
              pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-kaya-gold' : 'bg-kaya-warm-dark'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* ── Kaya Pulse readings ── the helper's assigned meter/utility
          readings for this day. Navy-tinted strip (Pulse brand) so it
          reads as distinct from the warm workplan tiles. Pending tiles
          link to Quick Entry; logged tiles show ✓; missed tiles flag.
          Closes the gap Elia flagged: utility records now live in the
          helper's daily plan, not a separate tab. */}
      {pulseForDay.length > 0 && (
        <div className="mb-3 -mx-1 px-3 py-2.5 bg-[#0F1F44]/[0.04] border-2 border-[#0F1F44]/15 rounded-kaya">
          <p className="text-[10px] uppercase tracking-wider font-bold mb-2 inline-flex items-center gap-1.5 text-[#0F1F44]">
            <Gauge size={12} /> <span>Readings to log</span>
            <span className="text-[9px] text-kaya-sand normal-case font-normal">
              ({pulseDoneCount}/{pulseForDay.length} done)
            </span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {pulseForDay.map((t) => {
              const tr = trackById[t.trackableId];
              const emoji = tr?.emoji ?? '📊';
              const name = tr?.name ?? 'Reading';
              const isDone = isPulseDone(t);
              const isMissed = t.status === 'missed';
              const canLog = isToday && !readOnly && !isDone;
              const inner = (
                <>
                  <span className="text-3xl lg:text-4xl">{emoji}</span>
                  <span className={`text-[10px] lg:text-[11px] font-bold text-center leading-tight line-clamp-2 px-1 ${
                    isDone ? 'text-green-800' : isMissed ? 'text-red-700' : 'text-[#0F1F44]'
                  }`}>
                    {name}
                  </span>
                  {isDone ? (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-green-500 text-white flex items-center justify-center">
                      <Check size={12} strokeWidth={3} />
                    </span>
                  ) : isMissed ? (
                    <span className="absolute top-1 right-1 text-[8px] uppercase tracking-wider font-black bg-red-500 text-white px-1 rounded">
                      Missed
                    </span>
                  ) : canLog ? (
                    <span className="absolute top-1 right-1 text-[#D4A847]"><ChevronRight size={14} strokeWidth={3} /></span>
                  ) : null}
                  {canLog && (
                    <span className="text-[9px] font-bold text-[#D4A847] uppercase tracking-wide">Tap to log</span>
                  )}
                </>
              );
              const tileBase = 'relative aspect-square flex flex-col items-center justify-center gap-0.5 p-2 rounded-kaya border-2 transition-all';
              const tileTone = isDone
                ? 'bg-green-50 border-green-400'
                : isMissed
                  ? 'bg-red-50 border-red-300'
                  : isFuture
                    ? 'bg-[#FCFAF4] border-dashed border-[#0F1F44]/30'
                    : 'bg-white border-[#0F1F44]/25';
              return canLog ? (
                <Link
                  key={t.id}
                  href={`/pulse/log/${t.id}`}
                  className={`${tileBase} ${tileTone} hover:shadow-sm no-underline`}
                >
                  {inner}
                </Link>
              ) : (
                <div key={t.id} className={`${tileBase} ${tileTone} cursor-default`} aria-disabled>
                  {inner}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Ad-hoc one-offs ── parent-assigned tasks for this day,
          honey-tinted strip so the helper notices them. Each tile
          shows the optional note under the label. */}
      {adhocToday.length > 0 && (
        <div className="mb-3 -mx-1 px-3 py-2.5 bg-[#FFF3D9] border-2 border-hive-honey rounded-kaya">
          <p className="text-[10px] uppercase tracking-wider text-hive-honey-dk font-bold mb-2 inline-flex items-center gap-1.5">
            <span>✨ Ad-hoc · {isToday ? 'just for today' : 'this day'}</span>
            <span className="text-[9px] text-hive-muted normal-case font-normal">({adhocToday.length} one-off{adhocToday.length === 1 ? '' : 's'})</span>
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            {adhocToday.map((item) => {
              const isDone = done.includes(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={readOnly || busyItem === item.id}
                  onClick={() => toggle(item.id)}
                  className={`relative aspect-square flex flex-col items-center justify-center gap-0.5 p-2 rounded-kaya border-2 transition-all ${isDone
                    ? 'bg-green-50 border-green-400' + (readOnly ? '' : ' hover:bg-green-100')
                    : isFuture
                      ? 'bg-[#FCFAF4] border-dashed border-hive-honey-dk'
                      : 'bg-white border-hive-honey-dk' + (readOnly ? '' : ' hover:shadow-sm')
                  } ${readOnly ? 'cursor-default' : ''} ${busyItem === item.id ? 'opacity-50' : ''}`}
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
                    disabled={readOnly || busyItem === item.id}
                    onClick={() => toggle(item.id)}
                    className={`relative aspect-square flex flex-col items-center justify-center gap-1 p-2 rounded-kaya border-2 transition-all ${isDone
                      ? 'bg-green-50 border-green-400' + (readOnly ? '' : ' hover:bg-green-100')
                      : isFuture
                        ? 'bg-[#FCFAF4] border-dashed border-kaya-warm-dark'
                        : 'bg-white border-kaya-warm-dark' + (readOnly ? '' : ' hover:border-kaya-chocolate hover:shadow-sm')
                    } ${readOnly ? 'cursor-default' : ''} ${busyItem === item.id ? 'opacity-50' : ''}`}
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

      {/* End-of-day note — editable today, read-only record on past days,
          hidden on a future preview (nothing to note yet). */}
      {!readOnly ? (
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
      ) : completion?.eodNote ? (
        <div className="mt-4 pt-4 border-t border-kaya-warm-dark/40">
          <p className="text-[10px] uppercase tracking-wider text-kaya-sand font-bold inline-flex items-center gap-1.5">
            📝 End-of-day note
          </p>
          <p className="mt-1 text-sm text-kaya-chocolate italic whitespace-pre-wrap">&ldquo;{completion.eodNote}&rdquo;</p>
        </div>
      ) : null}
    </div>
  );
}
