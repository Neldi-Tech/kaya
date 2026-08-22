'use client';

// Kaya Sparks · 📅 Week Planner (QF-3 · 2026-07-22).
//
// Planning the week ahead, activated and easy — at the TOP of every
// quest for the parent: one Mon→Sun strip + one tap.
//   · each day: done ✅ · today · planned · empty (+ add) · 😴 rest
//   · tap an empty day → pick an approved activity, or let Kaya write
//     one for that day (it still needs the parent's tick — D5)
//   · tap a planned day → move it to another day / take it off
//   · ✨ Plan next week → Kaya writes one per active day → review list
//     (all ticked) → ✅ Approve all & put on the days — ONE tap, where
//     it used to be four screens. Parents still approve; nothing reaches
//     a kid unticked.
// The kid gets a read-only "This week" strip (today doable, rest 🔒).

import { useMemo, useState } from 'react';
import {
  approveActivities, generateLibrary, scheduleLibrary, scheduleOnDate,
  unscheduleActivity, removeActivities, libraryBuckets, scheduledSteps,
  todayKey, addDays, weekStartOf, dowForDate, isDueOn,
  type Quest, type QuestStep,
} from '@/lib/sparks/quests';
import { toDisplayDate } from '@/lib/dates';

const DOW_SHORT = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

function weekDays(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function fmtRange(weekStart: string): string {
  const a = toDisplayDate(weekStart), b = toDisplayDate(addDays(weekStart, 6));
  return `${a.slice(0, 6)} – ${b}`;
}

type DayCell = {
  date: string;
  rest: boolean;
  today: boolean;
  past: boolean;
  step: (QuestStep & { date: string }) | null;
};

function buildCells(quest: Quest, steps: QuestStep[], weekStart: string, today: string): DayCell[] {
  const byDate = new Map<string, QuestStep & { date: string }>();
  for (const s of scheduledSteps(steps)) if (!byDate.has(s.date)) byDate.set(s.date, s);
  return weekDays(weekStart).map((date) => ({
    date,
    rest: !quest.activeDays.includes(dowForDate(date)),
    today: date === today,
    past: date < today,
    step: byDate.get(date) ?? null,
  }));
}

// ── Parent planner ───────────────────────────────────────────────────

export default function WeekPlanner({ familyId, kidId, kidName, quest, steps }: {
  familyId: string; kidId: string; kidName: string; quest: Quest; steps: QuestStep[];
}) {
  const today = todayKey();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(today));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [daySheet, setDaySheet] = useState<DayCell | null>(null);
  const [moveFrom, setMoveFrom] = useState<(QuestStep & { date: string }) | null>(null);
  const [review, setReview] = useState<{ items: QuestStep[]; from: string; ticked: Set<string> } | null>(null);

  const cells = useMemo(() => buildCells(quest, steps, weekStart, today), [quest, steps, weekStart, today]);
  const { approved } = useMemo(() => libraryBuckets(steps), [steps]);
  const activeCells = cells.filter((c) => !c.rest);
  const planned = activeCells.filter((c) => c.step).length;
  const nextMonday = addDays(weekStartOf(today), 7);
  const isCurrentWeek = weekStart === weekStartOf(today);
  const nextWeekEmpty = useMemo(() => {
    const cs = buildCells(quest, steps, nextMonday, today);
    return cs.filter((c) => !c.rest).every((c) => !c.step);
  }, [quest, steps, nextMonday, today]);

  async function planNextWeek() {
    setBusy('plan'); setError(''); setNote('');
    try {
      const need = buildCells(quest, steps, nextMonday, today).filter((c) => !c.rest && !c.step).length || 5;
      const { items } = await generateLibrary(quest.id, Math.min(7, Math.max(1, need)));
      if (!items.length) { setError('Kaya didn’t come back with activities — try again in a moment.'); }
      else setReview({ items, from: nextMonday, ticked: new Set(items.map((i) => i.id)) });
    } catch (e) {
      const err = e as Error & { hint?: string };
      setError(err.hint || 'Kaya couldn’t write next week just now. Try again in a moment.');
    }
    setBusy('');
  }

  async function approveAndPlace() {
    if (!review) return;
    setBusy('place'); setError('');
    const ids = review.items.filter((i) => review.ticked.has(i.id)).map((i) => i.id);
    const dropped = review.items.filter((i) => !review.ticked.has(i.id)).map((i) => i.id);
    try {
      if (ids.length) {
        await approveActivities(familyId, kidId, quest.id, ids);
        const r = await scheduleLibrary(familyId, kidId, quest.id, ids, review.from);
        setNote(`${r.scheduled} activit${r.scheduled === 1 ? 'y' : 'ies'} on the days ${toDisplayDate(r.from ?? review.from)} → ${toDisplayDate(r.to ?? review.from)}. ${kidName} sees them 🔒 until each day comes.`);
      }
      if (dropped.length) await removeActivities(familyId, kidId, quest.id, dropped).catch(() => {});
      setReview(null);
      setWeekStart(review.from);
    } catch { setError('Couldn’t put those on the days. Try again.'); }
    setBusy('');
  }

  async function pin(stepId: string, date: string) {
    setBusy('pin'); setError('');
    const r = await scheduleOnDate(familyId, kidId, quest.id, stepId, date);
    if (!r.ok) {
      setError(r.error === 'day-taken' ? 'That day already has an activity — move that one first.'
        : r.error === 'past-day' ? 'That day has passed.'
        : r.error === 'not-approved' ? 'Tick that activity first — it’s still waiting for approval.'
        : 'Couldn’t put it there. Try again.');
    }
    setDaySheet(null); setMoveFrom(null);
    setBusy('');
  }

  async function kayaForDay(date: string) {
    setBusy('day-gen'); setError('');
    try {
      const { items } = await generateLibrary(quest.id, 1);
      const it = items[0];
      if (!it) { setError('Kaya didn’t come back with an activity — try again.'); }
      else {
        await approveActivities(familyId, kidId, quest.id, [it.id]);
        await pin(it.id, date);
        setNote(`Kaya wrote “${it.title}” for ${toDisplayDate(date)} — approved and placed.`);
      }
    } catch { setError('Kaya couldn’t write one just now.'); }
    setBusy('');
  }

  return (
    <div className="mt-3 rounded-[18px] border-2 border-[#DFE3FB] bg-white p-3.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
          📅 {isCurrentWeek ? 'This week' : weekStart === nextMonday ? 'Next week' : 'Week'} · {fmtRange(weekStart)}
        </div>
        <span className={`text-[10.5px] font-extrabold px-2 py-0.5 rounded-full ${planned === activeCells.length && activeCells.length ? 'bg-[#E7F5EC] text-[#2E7D34]' : 'bg-[#FFF1C9] text-[#8A6800]'}`}>
          {planned} of {activeCells.length} day{activeCells.length === 1 ? '' : 's'} planned
        </span>
      </div>

      {/* the strip */}
      <div className="grid grid-cols-7 gap-1 mt-2.5">
        {cells.map((c, i) => {
          const fill = c.step;
          const bg = c.rest ? 'bg-[#E7F5EC] border-[#cfe8d4]'
            : fill?.done ? 'bg-[#E7F5EC] border-[#cfe8d4]'
            : c.today ? 'bg-[#F2F4FE] border-[#5A3CB8]'
            : fill ? 'bg-white border-[#ECE4D3]'
            : 'bg-[#FBF7EE] border-dashed border-[#ECE4D3]';
          const clickable = !c.rest && !c.past && !(fill?.done);
          return (
            <button key={c.date} type="button" disabled={!clickable || !!busy}
              onClick={() => { setError(''); if (moveFrom) { void pin(moveFrom.id, c.date); } else setDaySheet(c); }}
              className={`rounded-[10px] border px-1 py-1.5 text-center min-h-[60px] ${bg} ${clickable ? '' : 'cursor-default'} ${moveFrom && clickable && !fill ? 'ring-2 ring-[#D4A847]' : ''}`}
              title={c.date}>
              <div className="font-display font-black text-[9.5px] text-[#5A6488]">{DOW_SHORT[i]}<span className="block text-[8.5px] font-bold">{Number(c.date.slice(8, 10))}</span></div>
              <div className="text-[9.5px] leading-[1.2] mt-0.5 text-[#0F1F44] font-bold line-clamp-3">
                {c.rest ? <span className="text-[#2E7D34]">😴 rest</span>
                  : fill ? <>{fill.done ? '✅ ' : ''}{fill.tone === 'fun' ? '🎈 ' : ''}{fill.title}</>
                  : c.past ? <span className="text-[#9B8A72] font-normal">—</span>
                  : <span className="text-[#9B8A72] font-normal">+ add</span>}
              </div>
            </button>
          );
        })}
      </div>

      {moveFrom && (
        <div className="mt-2 text-[11.5px] font-bold text-[#8A6800]">
          Moving “{moveFrom.title}” — tap an empty day. <button type="button" onClick={() => setMoveFrom(null)} className="underline">Cancel</button>
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap mt-2.5">
        <button type="button" onClick={planNextWeek} disabled={!!busy}
          className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold text-white disabled:opacity-50" style={{ background: '#5A3CB8' }}>
          {busy === 'plan' ? 'Kaya is writing…' : '✨ Plan next week'}
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))}
            className="px-2.5 py-2 rounded-xl border border-[#ECE4D3] bg-white text-[12px] font-extrabold text-[#5A6488]" aria-label="Previous week">‹</button>
          <button type="button" onClick={() => setWeekStart(weekStartOf(today))}
            className="px-2.5 py-2 rounded-xl border border-[#ECE4D3] bg-white text-[11.5px] font-extrabold text-[#5A6488]">This week</button>
          <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))}
            className="px-2.5 py-2 rounded-xl border border-[#ECE4D3] bg-white text-[12px] font-extrabold text-[#5A6488]" aria-label="Next week">›</button>
        </div>
        {nextWeekEmpty && isCurrentWeek && (
          <span className="text-[10.5px] font-extrabold px-2 py-0.5 rounded-full bg-[#FFF1C9] text-[#8A6800]">Next week is empty</span>
        )}
      </div>
      <p className="text-[10.5px] text-[#8A8471] mt-1.5 m-0 leading-snug">
        Tap an empty day to add · tap a planned day to move or take it off. {kidName} only ever sees approved activities — and can only do today&apos;s.
      </p>

      {note && <div className="mt-2 rounded-xl bg-[#E7F5EC] px-3 py-2 text-[12px] text-[#2E7D34] font-bold">{note}</div>}
      {error && <div className="mt-2 rounded-xl bg-[#FDE8E8] border border-[#F5C6C6] px-3 py-2 text-[12px] text-[#8B2130]">{error}</div>}

      {/* ── day sheet ── */}
      {daySheet && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" onClick={() => setDaySheet(null)}>
          <div className="w-full max-w-md rounded-3xl bg-white p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">
              📅 {toDisplayDate(daySheet.date)}{daySheet.today ? ' · today' : ''}
            </div>
            {daySheet.step ? (
              <>
                <div className="mt-2 rounded-xl bg-[#F7F9FF] border border-[#DFE3FB] px-3 py-2.5">
                  <div className="text-[13px] font-bold text-[#0F1F44]">{daySheet.step.tone === 'fun' ? '🎈 ' : ''}{daySheet.step.title}</div>
                  {daySheet.step.how && <div className="text-[11.5px] text-[#5A6488] mt-0.5 leading-snug">{daySheet.step.how}</div>}
                  <div className="text-[10.5px] text-[#5A6488] mt-1">{daySheet.step.minutes} min</div>
                </div>
                <div className="flex gap-2 mt-3 flex-wrap">
                  <button type="button" onClick={() => { setMoveFrom(daySheet.step); setDaySheet(null); }}
                    className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold text-white" style={{ background: '#5A3CB8' }}>↔ Move to another day</button>
                  <button type="button" disabled={!!busy}
                    onClick={async () => { setBusy('un'); await unscheduleActivity(familyId, kidId, quest.id, daySheet.step!.id).catch(() => setError('Couldn’t take that off.')); setBusy(''); setDaySheet(null); }}
                    className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold border border-[#ECE4D3] bg-white text-[#5A6488]">Take off this day</button>
                  <button type="button" onClick={() => setDaySheet(null)} className="px-3.5 py-2 rounded-xl text-[12.5px] font-extrabold text-[#5A6488]">Close</button>
                </div>
              </>
            ) : (
              <>
                <p className="text-[12px] text-[#5A6488] mt-1 leading-snug">Nothing planned yet. Pick an approved activity, or let Kaya write one for this day.</p>
                <button type="button" disabled={!!busy} onClick={() => kayaForDay(daySheet.date)}
                  className="mt-3 w-full px-3.5 py-2.5 rounded-xl text-[12.5px] font-extrabold text-white disabled:opacity-50" style={{ background: 'linear-gradient(135deg,#A66CFF,#4ECDC4)' }}>
                  {busy === 'day-gen' ? 'Kaya is writing…' : '✨ Ask Kaya for this day'}
                </button>
                {approved.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-extrabold tracking-[1px] uppercase text-[#5A6488] mb-1.5">Approved &amp; waiting · {approved.length}</div>
                    <div className="space-y-1.5 max-h-60 overflow-y-auto">
                      {approved.map((s) => (
                        <button key={s.id} type="button" disabled={!!busy} onClick={() => pin(s.id, daySheet.date)}
                          className="w-full text-left rounded-xl border border-[#ECE4D3] bg-white px-3 py-2 hover:border-[#D4A847]">
                          <div className="text-[12.5px] font-bold text-[#0F1F44]">{s.tone === 'fun' ? '🎈 ' : ''}{s.title}</div>
                          <div className="text-[10.5px] text-[#5A6488]">{s.minutes} min{s.kindTag ? ` · ${s.kindTag}` : ''}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button type="button" onClick={() => setDaySheet(null)} className="mt-3 text-[12px] font-extrabold text-[#5A6488]">Close</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── ✨ Plan next week — review sheet ── */}
      {review && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 max-h-[85vh] overflow-y-auto">
            <div className="font-display font-extrabold text-[15px] text-[#0F1F44]">✨ Kaya wrote {review.items.length} for {fmtRange(review.from)}</div>
            <p className="text-[11.5px] text-[#5A6488] mt-1 leading-snug">Untick any line to leave that day open. They go on the active days in order, one a day.</p>
            <div className="space-y-1.5 mt-3">
              {review.items.map((it) => {
                const on = review.ticked.has(it.id);
                return (
                  <label key={it.id} className={`flex items-start gap-2.5 rounded-xl border px-3 py-2 cursor-pointer ${on ? 'border-[#DFE3FB] bg-[#F7F9FF]' : 'border-[#ECE4D3] bg-white opacity-70'}`}>
                    <input type="checkbox" checked={on} className="mt-1"
                      onChange={() => setReview((r) => { if (!r) return r; const t = new Set(r.ticked); if (t.has(it.id)) t.delete(it.id); else t.add(it.id); return { ...r, ticked: t }; })} />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-bold text-[#0F1F44]">{it.tone === 'fun' ? '🎈 ' : ''}{it.title}</span>
                      {it.how && <span className="block text-[11px] text-[#5A6488] leading-snug">{it.how}</span>}
                      <span className="block text-[10.5px] text-[#5A6488] mt-0.5">{it.minutes} min{it.kindTag ? ` · ${it.kindTag}` : ''}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex gap-2 mt-4 flex-wrap">
              <button type="button" disabled={!!busy || review.ticked.size === 0} onClick={approveAndPlace}
                className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold text-white disabled:opacity-50" style={{ background: '#2E7D34' }}>
                {busy === 'place' ? 'Placing…' : `✅ Approve ${review.ticked.size} & put on the days`}
              </button>
              <button type="button" disabled={!!busy}
                onClick={async () => { const ids = review.items.map((i) => i.id); setReview(null); await removeActivities(familyId, kidId, quest.id, ids).catch(() => {}); }}
                className="px-4 py-2.5 rounded-xl text-[13px] font-extrabold border border-[#ECE4D3] bg-white text-[#5A6488]">Discard all</button>
              <button type="button" onClick={() => setReview(null)}
                className="px-3 py-2.5 rounded-xl text-[12.5px] font-extrabold text-[#5A6488]">Keep in library, decide later</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Kid strip — readable, not doable ─────────────────────────────────

export function KidWeekStrip({ quest, steps }: { quest: Quest; steps: QuestStep[] }) {
  const today = todayKey();
  const weekStart = weekStartOf(today);
  const cells = useMemo(() => buildCells(quest, steps, weekStart, today).filter((c) => !c.rest), [quest, steps, weekStart, today]);
  if (cells.length === 0) return null;
  return (
    <div className="mt-2 rounded-[16px] border border-[#ECE4D3] bg-white px-3 py-2.5">
      <div className="text-[10px] font-extrabold tracking-[1px] uppercase text-[#5A6488] mb-1.5">📅 This week</div>
      <div className="flex gap-1.5">
        {cells.map((c) => {
          const i = (new Date(Number(c.date.slice(0, 4)), Number(c.date.slice(5, 7)) - 1, Number(c.date.slice(8, 10))).getDay() + 6) % 7;
          const cls = c.step?.done ? 'bg-[#E7F5EC] border-[#cfe8d4]'
            : c.today ? 'bg-[#F2F4FE] border-[#5A3CB8]'
            : 'bg-white border-[#ECE4D3]';
          return (
            <div key={c.date} className={`flex-1 rounded-[10px] border px-1 py-1.5 text-center ${cls}`} title={c.date}>
              <div className="font-display font-black text-[9.5px] text-[#5A6488]">{DOW_SHORT[i]}</div>
              <div className="text-[12px] mt-0.5">
                {c.step?.done ? '✅' : c.today ? (c.step ? '▶' : '—') : c.step ? (c.past ? '⚪️' : '🔒') : '—'}
              </div>
            </div>
          );
        })}
      </div>
      <div className="text-[10px] text-[#8A8471] mt-1.5 italic">Today is the only day you can do — the rest is there to look forward to.</div>
    </div>
  );
}
