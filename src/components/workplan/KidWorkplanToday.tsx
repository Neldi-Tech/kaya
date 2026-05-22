// KidWorkplanToday — a kid's playful "My Workplan" for a day. A
// time-ordered timeline (school schedule first), tap-to-tick with a
// celebratory % bar + points. Ticks route through the server so points
// land (kids can't write awards). Realtime: a parent edit / award shows
// up live. Reused read-only by the profile accomplishment view (Phase 2b).
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type KidWorkplanItem, type KidWorkplanCompletion,
  subscribeKidWorkplanItems, subscribeKidCompletion, completeKidTask,
  kidItemsScheduledOn, partitionKidByTime, dailyKidPct,
  formatTimeLocal, categoryMeta, todayDateString,
} from '@/lib/kidWorkplan';

const JOY = { purple: '#9B5DE5', green: '#6BCB77', coral: '#FF6B6B', yellow: '#FFD93D', ink: '#2D1B5E', border: '#F0E8FF' };

export default function KidWorkplanToday({ familyId, childId, childName, date, readOnly = false }: {
  familyId: string;
  childId: string;
  childName?: string;
  date?: Date;
  readOnly?: boolean;
}) {
  const dateStr = todayDateString(date);
  const isToday = dateStr === todayDateString();

  const [items, setItems] = useState<KidWorkplanItem[] | null>(null);
  const [completion, setCompletion] = useState<KidWorkplanCompletion | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const unsubItems = subscribeKidWorkplanItems(familyId, childId, setItems);
    const unsubComp = subscribeKidCompletion(familyId, childId, dateStr, (c) => {
      setCompletion(c);
      setOptimistic({}); // server is now source of truth — drop in-flight guesses
    });
    return () => { unsubItems(); unsubComp(); };
  }, [familyId, childId, dateStr]);

  const scheduled = useMemo(() => (items ? kidItemsScheduledOn(items, date) : []), [items, date]);
  const { timed, anytime } = useMemo(() => partitionKidByTime(scheduled), [scheduled]);

  if (items === null) {
    return <div className="rounded-2xl bg-white/70 border-2 border-[#F0E8FF] p-6 text-center text-sm font-extrabold text-[#9B5DE5]">Loading your day…</div>;
  }

  const doneSet = new Set(completion?.completedItemIds ?? []);
  const isDone = (id: string) => optimistic[id] ?? doneSet.has(id);
  const doneCount = scheduled.filter((i) => isDone(i.id)).length;
  const total = scheduled.length;
  const pct = dailyKidPct(scheduled, completion);
  const pointsToday = scheduled
    .filter((i) => isDone(i.id))
    .reduce((s, i) => s + (i.pointsValue ?? 0), 0);
  const allDone = total > 0 && doneCount === total;

  const toggle = async (item: KidWorkplanItem) => {
    if (readOnly || !isToday) return;
    const next = !isDone(item.id);
    setOptimistic((o) => ({ ...o, [item.id]: next }));
    setBusy(item.id);
    try {
      const r = await completeKidTask({ familyId, childId, itemId: item.id, date: dateStr, on: next });
      if (!r.ok) setOptimistic((o) => ({ ...o, [item.id]: !next })); // revert on failure
    } finally {
      setBusy(null);
    }
  };

  if (total === 0) {
    return (
      <div className="rounded-2xl bg-white border-2 border-dashed border-[#F0E8FF] p-8 text-center">
        <div className="text-4xl mb-2">🗓️</div>
        <p className="font-extrabold text-[15px]" style={{ color: JOY.ink }}>Nothing planned {isToday ? 'today' : 'this day'}</p>
        <p className="text-[12px] text-[#5C6975] mt-1">When a grown-up adds tasks, they show up here.</p>
      </div>
    );
  }

  const Tile = ({ item }: { item: KidWorkplanItem }) => {
    const cat = categoryMeta(item.category);
    const done = isDone(item.id);
    const pts = item.pointsValue ?? 0;
    return (
      <button
        type="button"
        disabled={readOnly || !isToday || busy === item.id}
        onClick={() => toggle(item)}
        aria-pressed={done}
        className={`w-full flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all ${
          done ? 'bg-[#F1FBF2] border-[#6BCB77]' : 'bg-white border-[#F0E8FF]'
        } ${readOnly || !isToday ? 'cursor-default' : 'hover:shadow-sm active:scale-[0.99]'} ${busy === item.id ? 'opacity-60' : ''}`}
      >
        {/* check bubble */}
        <span
          className="flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0 text-white text-[14px] font-black"
          style={{ background: done ? JOY.green : '#fff', border: `2px solid ${done ? JOY.green : JOY.purple}`, color: done ? '#fff' : 'transparent' }}
        >
          ✓
        </span>
        <span className="text-2xl flex-shrink-0" aria-hidden>{item.icon || cat.icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`block font-extrabold text-[13px] leading-tight ${done ? 'line-through text-[#5C6975]' : ''}`} style={done ? {} : { color: JOY.ink }}>
            {item.label}
          </span>
          <span className="block text-[10px] font-bold mt-0.5" style={{ color: cat.color }}>
            <span className="inline-block w-2 h-2 rounded-full align-middle mr-1" style={{ background: cat.color }} />
            {cat.label}{item.note ? ` · ${item.note}` : ''}
          </span>
        </span>
        {pts > 0 && (
          <span
            className="flex-shrink-0 text-[10px] font-black px-2 py-1 rounded-lg text-white"
            style={{ background: done ? JOY.green : `linear-gradient(135deg, ${JOY.purple}, #6A4FCF)` }}
          >
            {done ? `+${pts} ✓` : `+${pts}`}
          </span>
        )}
      </button>
    );
  };

  return (
    <div>
      {/* Progress hero */}
      <div className="rounded-2xl p-4 mb-3 text-white" style={{ background: `linear-gradient(135deg, ${JOY.purple}, ${JOY.coral})` }}>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="font-black text-[16px] leading-tight">
              {allDone ? '🎉 All done!' : childName ? `Habari, ${childName.split(' ')[0]} 👋` : 'My day'}
            </p>
            <p className="text-[12px] font-bold opacity-90 mt-0.5">
              {doneCount} of {total} done{pointsToday > 0 ? ` · ⭐ ${pointsToday} pts` : ''}
            </p>
          </div>
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-white/20 font-black text-[16px] flex-shrink-0 border-2 border-white/40">
            {pct}%
          </div>
        </div>
        <div className="mt-3 h-2.5 w-full rounded-full bg-white/25 overflow-hidden">
          <div className="h-full rounded-full bg-white transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>

      {allDone && (
        <div className="rounded-2xl p-3 mb-3 text-center font-black text-[13px]" style={{ background: JOY.yellow, color: '#5A3D00' }}>
          🌟 You finished everything {isToday ? 'today' : 'this day'}! Amazing!
        </div>
      )}

      {/* Timeline (timed) */}
      {timed.length > 0 && (
        <div className="space-y-2">
          {timed.map((item) => (
            <div key={item.id} className="flex items-stretch gap-2">
              <div className="flex-shrink-0 w-14 pt-3 text-right">
                <span className="text-[11px] font-black" style={{ color: JOY.purple }}>{formatTimeLocal(item.timeLocal)}</span>
              </div>
              <div className="flex-1 min-w-0"><Tile item={item} /></div>
            </div>
          ))}
        </div>
      )}

      {/* Anytime */}
      {anytime.length > 0 && (
        <div className="mt-4">
          <p className="text-[10px] font-black uppercase tracking-wider mb-2" style={{ color: JOY.ink }}>⏰ Anytime</p>
          <div className="space-y-2">
            {anytime.map((item) => <Tile key={item.id} item={item} />)}
          </div>
        </div>
      )}
    </div>
  );
}
