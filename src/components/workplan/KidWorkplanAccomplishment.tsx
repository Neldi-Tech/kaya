// KidWorkplanAccomplishment — gamified "how's the workplan going" card
// for the kid profile. Shows this-week %, a 🔥 perfect-day streak, points
// earned + tasks done, a tappable 7-day strip, and a "jump to a day"
// picker so you can VIEW PREVIOUS DAYS (Elia's addition #2). Tapping a
// day opens that day's plan read-only (reuses KidWorkplanToday).
'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  type KidWorkplanItem, type KidWorkplanCompletion,
  listKidWorkplanItems, listKidCompletions, computeKidAccomplishment,
  todayDateString,
} from '@/lib/kidWorkplan';
import { toDisplayDate } from '@/lib/dates';
import KidWorkplanToday from '@/components/workplan/KidWorkplanToday';
import { X } from 'lucide-react';

const JOY = { purple: '#9B5DE5', green: '#6BCB77', coral: '#FF6B6B', yellow: '#FFD93D', ink: '#2D1B5E' };

/** Local Date from a YYYY-MM-DD key (avoids the UTC-parse off-by-one). */
function dateFromKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function pctColor(pct: number, active: boolean): string {
  if (!active) return '#EDE7DA';
  if (pct === 100) return JOY.green;
  if (pct >= 50) return JOY.yellow;
  return '#F2C0C0';
}

export default function KidWorkplanAccomplishment({ familyId, childId, childName }: {
  familyId: string;
  childId: string;
  childName: string;
}) {
  const [items, setItems] = useState<KidWorkplanItem[] | null>(null);
  const [completions, setCompletions] = useState<KidWorkplanCompletion[]>([]);
  const [openDate, setOpenDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [its, comps] = await Promise.all([
        listKidWorkplanItems(familyId, childId),
        listKidCompletions(familyId, childId),
      ]);
      if (cancelled) return;
      setItems(its);
      setCompletions(comps);
    })();
    return () => { cancelled = true; };
  }, [familyId, childId]);

  const acc = useMemo(
    () => (items ? computeKidAccomplishment(items, completions, 7) : null),
    [items, completions],
  );

  if (items === null) {
    return (
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
        <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-2">Workplan accomplishment</h3>
        <p className="text-xs text-kaya-sand">Loading…</p>
      </div>
    );
  }

  // No plan ever set up.
  if (items.length === 0) {
    return (
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4">
        <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-2">Workplan accomplishment</h3>
        <p className="text-xs text-kaya-sand">No workplan set up yet — once a grown-up adds tasks, {childName.split(' ')[0]}&apos;s streaks &amp; points show up here.</p>
      </div>
    );
  }

  const a = acc!;
  const todayStr = todayDateString();
  const maxDate = todayStr;

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider">Workplan accomplishment</h3>
        <span className="text-[10px] font-bold" style={{ color: JOY.purple }}>last 7 days</span>
      </div>

      {/* Gamified hero */}
      <div className="rounded-kaya p-3 mb-3 text-white" style={{ background: `linear-gradient(135deg, ${JOY.purple}, ${JOY.coral})` }}>
        <div className="grid grid-cols-4 gap-2 text-center">
          <Stat big={`${a.windowPct}%`} label="done" />
          <Stat big={`${a.streak}🔥`} label="streak" />
          <Stat big={`${a.totalPoints}`} label="points" />
          <Stat big={`${a.totalDone}`} label="tasks" />
        </div>
        {a.perfectDays > 0 && (
          <p className="text-center text-[11px] font-bold mt-2 opacity-95">
            🌟 {a.perfectDays} perfect day{a.perfectDays === 1 ? '' : 's'} this week!
          </p>
        )}
      </div>

      {/* 7-day strip — tap a day to view it */}
      <div className="flex justify-between gap-1">
        {a.days.map((d) => {
          const isToday = d.date === todayStr;
          const open = d.date === openDate;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setOpenDate(open ? null : d.date)}
              className="flex flex-col items-center gap-1 flex-1"
              title={`${toDisplayDate(d.date)} · ${d.isActive ? `${d.done}/${d.scheduled} · ${d.pct}%` : 'nothing planned'}`}
            >
              <div
                className="w-full max-w-[40px] aspect-square rounded-xl flex items-center justify-center text-[11px] font-black"
                style={{
                  background: pctColor(d.pct, d.isActive),
                  color: d.isActive && d.pct >= 50 ? '#fff' : '#7a7264',
                  boxShadow: open ? `0 0 0 2px #fff, 0 0 0 4px ${JOY.ink}` : 'none',
                }}
              >
                {d.isActive ? `${d.pct}` : '—'}
              </div>
              <span className={`text-[9px] font-bold uppercase ${isToday ? '' : 'text-kaya-sand'}`} style={isToday ? { color: JOY.purple } : {}}>
                {d.dow}
              </span>
            </button>
          );
        })}
      </div>

      {/* Jump to a day (view previous days further back) */}
      <div className="mt-3 flex items-center gap-2">
        <label className="text-[10px] font-bold text-kaya-sand uppercase tracking-wider">View a day</label>
        <input
          type="date"
          max={maxDate}
          value={openDate ?? ''}
          onChange={(e) => setOpenDate(e.target.value || null)}
          className="h-8 px-2 bg-kaya-cream rounded-kaya-sm text-[12px] font-bold border border-kaya-warm-dark focus:outline-none focus:ring-2 focus:ring-kaya-gold/40"
        />
      </div>

      {/* Open day — read-only plan for that date */}
      {openDate && (
        <div className="mt-3 rounded-kaya border border-kaya-warm-dark p-3" style={{ background: 'linear-gradient(180deg,#FFF8EC 0%,#F7EEFF 100%)' }}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-black" style={{ color: JOY.ink }}>{toDisplayDate(openDate)}</p>
            <button onClick={() => setOpenDate(null)} className="text-kaya-sand hover:text-kaya-chocolate" aria-label="Close day">
              <X size={16} />
            </button>
          </div>
          <KidWorkplanToday
            familyId={familyId}
            childId={childId}
            childName={childName}
            date={dateFromKey(openDate)}
            readOnly
          />
        </div>
      )}
    </div>
  );
}

function Stat({ big, label }: { big: string; label: string }) {
  return (
    <div>
      <p className="text-[18px] font-black leading-none">{big}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide opacity-90 mt-1">{label}</p>
    </div>
  );
}
