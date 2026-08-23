'use client';

// HP2 · Routine fill tab (Helper Performance 2.0, D3/D3b — approved
// 2026-08-23). "Did the kids get their morning & evening?" — one colour
// per day for a helper, built from the ratings they already log.
//
//   This week · Last week · Month   (period pills)
//   Fill % headline (Elia: "make the fill % visible")
//   Week strip (Mon–Sun, tap a day → that day's ratings on /rate)
//   Today line (☀️ morning ✓ · 🌙 evening ⏳)
//   Counters + legend · Per-kid rows · Month grid
//
// Pure reads — see lib/routineFill.ts + lib/routineFillCore.ts.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useFamily } from '@/contexts/FamilyContext';
import type { HelperLink } from '@/lib/firestore';
import { getRoutineFill } from '@/lib/routineFill';
import {
  addDays, mondayOf, parseYmd, ymdLocal, expectedPeriods,
  type DayFill, type FillStatus, type FillSummary,
} from '@/lib/routineFillCore';
import { toDisplayDate } from '@/lib/dates';

type Period = 'week' | 'lastweek' | 'month';

const DOW_SHORT = ['M', 'T', 'W', 'T', 'F', 'S', 'S']; // Mon-first

export function statusClasses(s: FillStatus): string {
  switch (s) {
    case 'green':  return 'bg-green-500 text-white';
    case 'amber':  return 'bg-amber-400 text-white';
    case 'red':    return 'bg-red-500 text-white';
    case 'off':    return 'bg-gray-200 text-gray-400';
    case 'na':     return 'bg-gray-100 text-gray-300';
    case 'today':  return 'bg-white border-2 border-dashed border-amber-400 text-amber-600';
    default:       return 'bg-gray-50 text-gray-300';
  }
}
const STATUS_WORD: Record<FillStatus, string> = {
  green: 'all slots filled', amber: 'some missed', red: 'none filled',
  off: 'off-day', na: 'not expected', today: 'today · live', future: 'coming up',
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function RoutineFillTab({
  familyId, helper, isParent,
}: {
  familyId: string;
  helper: HelperLink;
  isParent: boolean;
}) {
  const { children } = useFamily();
  const kidName = (id: string) => children.find((c) => c.id === id)?.name?.split(' ')[0] ?? 'Kid';
  const today = ymdLocal(new Date());
  const [period, setPeriod] = useState<Period>('week');
  // Month navigation — YYYY-MM, defaults to the current month.
  const [month, setMonth] = useState<string>(today.slice(0, 7));
  const [data, setData] = useState<FillSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [perKidOpen, setPerKidOpen] = useState(false);

  const range = useMemo(() => {
    if (period === 'week') { const m = mondayOf(today); return { from: m, to: addDays(m, 6) }; }
    if (period === 'lastweek') { const m = addDays(mondayOf(today), -7); return { from: m, to: addDays(m, 6) }; }
    const [y, mo] = month.split('-').map(Number);
    const first = `${y}-${String(mo).padStart(2, '0')}-01`;
    const last = ymdLocal(new Date(y, mo, 0, 12));
    return { from: first, to: last };
  }, [period, month, today]);

  useEffect(() => {
    let cancelled = false;
    setData(null); setError(null);
    (async () => {
      try {
        const d = await getRoutineFill(familyId, helper, range.from, range.to);
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load');
      }
    })();
    return () => { cancelled = true; };
  }, [familyId, helper, range.from, range.to]);

  const periods = expectedPeriods(helper.expectedFrequency);
  const expectLabel = periods === 'any' ? 'any fill each day'
    : periods.length === 2 ? 'morning + evening' : `${periods[0]} only`;
  const kids = helper.kidIds ?? [];
  const kidsLabel = kids.length ? kids.map(kidName).join(', ') : 'no kids assigned';
  const days = helper.workDays && helper.workDays.length > 0 ? helper.workDays : null;
  const daysLabel = !days || days.length === 7 ? 'Mon–Sun'
    : days.length === 6 && !days.includes('sun') ? 'Mon–Sat'
    : days.map((d) => d.charAt(0).toUpperCase() + d.slice(1)).join(' ');
  const first = helper.displayName.split(' ')[0];

  const todayFill = data?.days.find((d) => d.date === today);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="rounded-hive-lg bg-hive-navy text-white p-4">
        <p className="text-[10px] uppercase tracking-[2px] font-nunito font-extrabold opacity-80">{first} · Routine fill</p>
        <h3 className="font-nunito font-black text-lg leading-tight mt-0.5">Did the kids get their morning &amp; evening?</h3>
        <p className="text-[11px] opacity-90 mt-1">Expected: {expectLabel} · {kidsLabel} · {daysLabel}</p>
      </div>

      {/* Period pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {([['week', 'This week'], ['lastweek', 'Last week'], ['month', 'Month']] as [Period, string][]).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPeriod(id)}
            className={`h-8 px-3 rounded-hive-pill text-[11px] font-nunito font-extrabold border ${period === id ? 'bg-hive-navy text-white border-hive-navy' : 'bg-hive-paper border-hive-line text-hive-muted'}`}
          >
            {label}
          </button>
        ))}
        {period === 'month' && (
          <span className="inline-flex items-center gap-1 ml-auto">
            <button type="button" aria-label="Previous month" onClick={() => { const [y, m] = month.split('-').map(Number); setMonth(ymdLocal(new Date(y, m - 2, 1, 12)).slice(0, 7)); }} className="w-8 h-8 rounded-full border border-hive-line bg-hive-paper inline-flex items-center justify-center"><ChevronLeft size={14} /></button>
            <span className="text-[11px] font-nunito font-extrabold min-w-[110px] text-center">{monthLabel(month)}</span>
            <button type="button" aria-label="Next month" disabled={month >= today.slice(0, 7)} onClick={() => { const [y, m] = month.split('-').map(Number); setMonth(ymdLocal(new Date(y, m, 1, 12)).slice(0, 7)); }} className="w-8 h-8 rounded-full border border-hive-line bg-hive-paper inline-flex items-center justify-center disabled:opacity-40"><ChevronRight size={14} /></button>
          </span>
        )}
      </div>

      {error && <p className="text-[12px] text-hive-rose font-bold">{error}</p>}
      {!data && !error && (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 animate-pulse text-[12px] text-hive-muted">Loading routine fill…</div>
      )}

      {data && (
        <>
          {/* Fill % headline — visible, always (Elia 2026-08-23) */}
          <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4 flex items-center gap-4">
            <div>
              <p className="text-[10px] uppercase tracking-wider font-nunito font-extrabold text-hive-muted">Fill rate</p>
              <p className={`font-nunito font-black text-3xl leading-none mt-0.5 ${data.fillPct === null ? 'text-hive-muted' : data.fillPct >= 90 ? 'text-green-700' : data.fillPct >= 60 ? 'text-amber-600' : 'text-red-600'}`}>
                {data.fillPct === null ? '—' : `${data.fillPct}%`}
              </p>
              <p className="text-[10px] text-hive-muted mt-1">
                {data.expectedSlots > 0
                  ? `${data.filledSlots} of ${data.expectedSlots} slots · ${data.settledDays} settled day${data.settledDays === 1 ? '' : 's'}`
                  : kids.length === 0 ? 'assign kids in Settings → Helpers' : 'nothing settled yet'}
              </p>
            </div>
            <div className="flex-1 flex flex-wrap gap-1.5 justify-end">
              <Chip cls="bg-green-100 text-green-800">{data.green} 🟢</Chip>
              <Chip cls="bg-amber-100 text-amber-800">{data.amber} 🟡</Chip>
              <Chip cls="bg-red-100 text-red-800">{data.red} 🔴</Chip>
              {data.off > 0 && <Chip cls="bg-gray-100 text-gray-600">{data.off} ⚪</Chip>}
            </div>
          </div>

          {period !== 'month' ? (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
              <p className="font-nunito font-extrabold text-[13px] mb-2">
                {toDisplayDate(range.from).slice(0, 6)} – {toDisplayDate(range.to)}
              </p>
              <WeekStrip days={data.days} isParent={isParent} />
              {todayFill && period === 'week' && (
                <TodayLine day={todayFill} periods={periods} kidName={kidName} />
              )}
              <Legend />
            </div>
          ) : (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
              <p className="font-nunito font-extrabold text-[13px] mb-2">{monthLabel(month)}</p>
              <MonthGrid days={data.days} isParent={isParent} />
              <Legend />
            </div>
          )}

          {/* Per kid */}
          {kids.length > 0 && (
            <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-4">
              <button type="button" onClick={() => setPerKidOpen((v) => !v)} className="w-full flex items-center justify-between text-left">
                <span className="font-nunito font-extrabold text-[13px]">Per kid</span>
                <span className="text-[11px] text-hive-muted">{perKidOpen ? '▴ Hide' : '▾ Show'}</span>
              </button>
              {perKidOpen && (
                <div className="mt-2 space-y-2">
                  {kids.map((kid) => (
                    <KidRow key={kid} kid={kid} name={kidName(kid)} days={data.days} periods={periods} />
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="text-[10px] text-hive-muted italic">
            Tap any day → that day&apos;s ratings. Nothing new is written — this reads the ratings {first} already logs.
          </p>
        </>
      )}
    </div>
  );
}

function Chip({ children, cls }: { children: React.ReactNode; cls: string }) {
  return <span className={`inline-block text-[10px] font-nunito font-extrabold px-2 py-0.5 rounded-full ${cls}`}>{children}</span>;
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-nunito font-extrabold text-hive-muted">
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-green-500 align-[-1px] mr-1" />all slots filled</span>
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-400 align-[-1px] mr-1" />some missed</span>
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-red-500 align-[-1px] mr-1" />none</span>
      <span><i className="inline-block w-2.5 h-2.5 rounded-sm bg-gray-200 align-[-1px] mr-1" />off-day</span>
    </div>
  );
}

function dayHref(d: DayFill): string {
  return `/rate?date=${d.date}`;
}

function DayCell({ d, isParent, small }: { d: DayFill; isParent: boolean; small?: boolean }) {
  const label = parseYmd(d.date).getDate();
  const cls = `aspect-square rounded-xl flex items-center justify-center font-nunito font-black ${small ? 'text-[10px] rounded-lg' : 'text-[12px]'} ${statusClasses(d.status)}`;
  const title = `${toDisplayDate(d.date)} · ${STATUS_WORD[d.status]}${d.expected > 0 && (d.status === 'green' || d.status === 'amber' || d.status === 'red' || d.status === 'today') ? ` · ${d.filled}/${d.expected}` : ''}`;
  const tappable = isParent && d.status !== 'future' && d.status !== 'na';
  if (tappable) return <Link href={dayHref(d)} title={title} className={`${cls} no-underline`}>{label}</Link>;
  return <div title={title} className={cls}>{label}</div>;
}

function WeekStrip({ days, isParent }: { days: DayFill[]; isParent: boolean }) {
  return (
    <div className="grid grid-cols-7 gap-1.5">
      {DOW_SHORT.map((l, i) => <div key={i} className="text-center text-[9px] font-nunito font-black text-hive-muted">{l}</div>)}
      {days.map((d) => <DayCell key={d.date} d={d} isParent={isParent} />)}
    </div>
  );
}

function MonthGrid({ days, isParent }: { days: DayFill[]; isParent: boolean }) {
  // Leading blanks so the 1st sits under its weekday (Mon-first).
  const firstDow = days.length ? (days[0].dow + 6) % 7 : 0;
  return (
    <div className="grid grid-cols-7 gap-1">
      {DOW_SHORT.map((l, i) => <div key={i} className="text-center text-[9px] font-nunito font-black text-hive-muted">{l}</div>)}
      {Array.from({ length: firstDow }).map((_, i) => <div key={`b${i}`} />)}
      {days.map((d) => <DayCell key={d.date} d={d} isParent={isParent} small />)}
    </div>
  );
}

function TodayLine({ day, periods, kidName }: {
  day: DayFill;
  periods: ReturnType<typeof expectedPeriods>;
  kidName: (id: string) => string;
}) {
  const kids = Object.keys(day.perKid);
  const bit = (p: 'morning' | 'evening') => {
    const done = kids.filter((k) => day.perKid[k][p] === true);
    if (periods !== 'any' && !periods.includes(p)) return null;
    const icon = p === 'morning' ? '☀️' : '🌙';
    if (done.length === kids.length && kids.length > 0) return `${icon} ${p} ✓ ${kids.length > 1 ? 'all kids' : ''}`.trim();
    if (done.length === 0) return `${icon} ${p} ⏳ due`;
    return `${icon} ${p} ✓ ${done.map(kidName).join(', ')} · ⏳ ${kids.filter((k) => !done.includes(k)).map(kidName).join(', ')}`;
  };
  const parts = [bit('morning'), bit('evening')].filter(Boolean);
  return (
    <p className="text-[11px] text-hive-muted mt-2">
      <span className="font-nunito font-extrabold text-hive-ink">Today {toDisplayDate(day.date)}</span>
      {parts.length > 0 && <> · {parts.join(' · ')}</>}
    </p>
  );
}

function KidRow({ kid, name, days, periods }: {
  kid: string; name: string; days: DayFill[]; periods: ReturnType<typeof expectedPeriods>;
}) {
  // Per-kid status per day (same colour rules, one kid).
  const missedNotes: string[] = [];
  const cells = days.map((d) => {
    const k = d.perKid[kid];
    if (!k || d.status === 'off' || d.status === 'na' || d.status === 'future') return { date: d.date, s: d.status === 'future' ? 'future' : 'off' as FillStatus };
    if (d.status === 'today') return { date: d.date, s: 'today' as FillStatus };
    const exp = [k.morning, k.evening].filter((v) => v !== null).length;
    const got = [k.morning, k.evening].filter((v) => v === true).length;
    let s: FillStatus = got >= exp ? 'green' : got > 0 ? 'amber' : 'red';
    if (periods === 'any') s = got > 0 ? 'green' : 'red';
    if (s !== 'green' && missedNotes.length < 2) {
      const dow = parseYmd(d.date).toLocaleDateString('en-US', { weekday: 'short' });
      const missed = [k.morning === false ? 'morning' : null, k.evening === false ? 'evening' : null].filter(Boolean).join(' + ');
      missedNotes.push(`${dow}: ${missed || 'missed'}`);
    }
    return { date: d.date, s };
  });
  const shown = cells.length > 14 ? cells.slice(-14) : cells;
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-[12px] font-nunito font-extrabold min-w-[64px]">👧 {name}</span>
      <span className="inline-flex gap-[3px]">
        {shown.map((c) => (
          <i key={c.date} title={toDisplayDate(c.date)} className={`inline-block w-2.5 h-2.5 rounded-full ${c.s === 'today' ? 'border border-dashed border-amber-400 bg-white' : statusClasses(c.s).split(' ')[0]}`} />
        ))}
      </span>
      {missedNotes.length > 0 && <span className="text-[10px] text-hive-muted">{missedNotes.join(' · ')}{cells.length > 14 ? ' (last 14 days)' : ''}</span>}
    </div>
  );
}
