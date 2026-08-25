'use client';

// Sparks · Timeline 2.0 (2026-08-25) — the shared Years ▸ Months ▸ Days
// navigation for Reflection + Diary, parents + kids.
//
// Approved design v2: navigate by the days that EXIST, never render an
// empty month grid.
//  • TimelineList  — collapsible Year cards ▸ Month rows (the exact
//    Home-Projects MonthGroup header: label · count pill · rotating ▾)
//    ▸ day cards. Latest year open with its two newest months expanded;
//    long months truncate to the newest 5 + "＋ n more".
//  • TimelineBrowse — the approved Year/Month dropdown pair (only
//    years/months with entries; empty months ghosted) + the same day
//    cards. ⚡ Latest jumps to the newest entry; 🎲 opens a random day.
//  • MemoryLane — "On this day": resurfaces what was written one month
//    and one year ago today (never locked pages).
//  • ViewSwitcher + useRememberedView — the 📋/🗂/🔥/🗓 pills; each
//    person's last choice is remembered per surface (localStorage).

import { useMemo, useState } from 'react';
import { toDisplayDate } from '@/lib/dates';

// ─── data contract ─────────────────────────────────────────────────

/** One calendar day in the timeline — both surfaces map into this. */
export interface TimelineDay {
  date: string;          // YYYY-MM-DD (local)
  emoji?: string;        // feeling / mood
  preview?: string;      // first line of the day's writing ('' = none)
  score?: number | null; // reflection 0–100 (parent avg, else AI) — chip
  locked?: boolean;      // diary: the day's pages are locked for this viewer
  starred?: boolean;     // a parent starred / rated the day
  count?: number;        // entries that day (>1 shows ×n)
}

export type TimelineView = 'list' | 'browse' | 'hitmap' | 'calendar';

// ─── locale bits ───────────────────────────────────────────────────

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SW = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_FULL_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];
const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_SW = ['JPL', 'JTT', 'JNN', 'JTN', 'ALH', 'IJM', 'JMS'];

function dowLabel(date: string, sw: boolean): string {
  const d = new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return (sw ? DOW_SW : DOW_EN)[d.getDay()] ?? '';
}

const VIEW_LABELS: Record<TimelineView, { en: string; sw: string }> = {
  list:     { en: '📋 List',     sw: '📋 Orodha' },
  browse:   { en: '🗂 Browse',   sw: '🗂 Vinjari' },
  hitmap:   { en: '🔥 Hit-map',  sw: '🔥 Ramani' },
  calendar: { en: '🗓 Calendar', sw: '🗓 Kalenda' },
};

// ─── remembered view (per person, per surface) ─────────────────────

export function useRememberedView(
  surface: string, available: TimelineView[], fallback: TimelineView,
): [TimelineView, (v: TimelineView) => void] {
  const key = `kaya.tl2.${surface}`;
  const [view, setView] = useState<TimelineView>(() => {
    try {
      if (typeof window !== 'undefined') {
        const stored = window.localStorage.getItem(key) as TimelineView | null;
        if (stored && available.includes(stored)) return stored;
      }
    } catch { /* private mode */ }
    return fallback;
  });
  const set = (v: TimelineView) => {
    setView(v);
    try { window.localStorage.setItem(key, v); } catch { /* private mode */ }
  };
  return [view, set];
}

// ─── view switcher pills ───────────────────────────────────────────

export function ViewSwitcher({ view, views, onChange, sw }: {
  view: TimelineView; views: TimelineView[];
  onChange: (v: TimelineView) => void; sw: boolean;
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-[#F3EDE3] p-1 mt-3" role="tablist">
      {views.map((v) => (
        <button key={v} type="button" role="tab" aria-selected={view === v}
          onClick={() => onChange(v)}
          className={`flex-1 rounded-lg py-1.5 px-0.5 font-nunito font-extrabold text-[11.5px] transition-colors ${
            view === v ? 'bg-white text-[#7A2E5C] shadow-[0_1px_4px_rgba(15,31,68,0.12)]' : 'text-[#5A6488]'
          }`}>
          {sw ? VIEW_LABELS[v].sw : VIEW_LABELS[v].en}
        </button>
      ))}
    </div>
  );
}

// ─── shared day card ───────────────────────────────────────────────

function scoreChip(score: number | null | undefined) {
  if (typeof score !== 'number') return null;
  return (
    <span className="shrink-0 rounded-full px-2 py-0.5 font-nunito font-black text-[11.5px] text-white"
      style={{ background: score >= 85 ? '#2E7D32' : '#66BB6A' }}>
      {score}%
    </span>
  );
}

function DayCard({ d, onOpen, onShare, sw }: {
  d: TimelineDay; onOpen: (date: string) => void;
  onShare?: (date: string) => void; sw: boolean;
}) {
  const lockedLine = sw ? 'Ukurasa umefungwa — bisha kuomba' : 'Locked page — knock to ask';
  const preview = d.locked && !d.preview ? lockedLine : (d.preview ?? '');
  return (
    <div className="flex items-center gap-2.5 rounded-2xl border border-[#EDE6DA] bg-white px-3 py-2.5">
      <button type="button" onClick={() => onOpen(d.date)} className="flex items-center gap-2.5 flex-1 min-w-0 text-left">
        <span className="text-[22px] leading-none shrink-0" aria-hidden>{d.emoji || '📝'}</span>
        <span className="min-w-0">
          <span className="block font-nunito font-black text-[11.5px] text-[#7A2E5C]">
            {dowLabel(d.date, sw)} · {toDisplayDate(d.date)}
            {d.starred ? ' ⭐' : ''}
            {(d.count ?? 1) > 1 ? <span className="text-[#5A6488]"> ×{d.count}</span> : null}
          </span>
          {preview && (
            <span className={`block text-[12.5px] mt-0.5 truncate ${d.locked && !d.preview ? 'text-[#5A6488]' : 'text-[#0F1F44]'}`}>
              {d.locked && !d.preview ? preview : `“${preview}”`}
            </span>
          )}
        </span>
      </button>
      <span className="shrink-0 flex flex-col items-end gap-1">
        {d.locked ? <span className="text-[15px]" aria-label="locked">🔒</span> : scoreChip(d.score)}
        {onShare && !d.locked && (
          <button type="button" onClick={() => onShare(d.date)}
            className="font-nunito font-black text-[11.5px] text-[#C05299]">
            ↗ {sw ? 'Shiriki' : 'Share'}
          </button>
        )}
      </span>
    </div>
  );
}

// ─── grouping (year ▸ month, newest first) ─────────────────────────

interface MonthBucket { key: string; m: number; days: TimelineDay[] }
interface YearBucket { y: string; total: number; months: MonthBucket[] }

function buildTree(days: TimelineDay[]): YearBucket[] {
  const byYear = new Map<string, Map<string, TimelineDay[]>>();
  for (const d of days) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
    const y = d.date.slice(0, 4), m = d.date.slice(5, 7);
    const months = byYear.get(y) ?? new Map<string, TimelineDay[]>();
    months.set(m, [...(months.get(m) ?? []), d]);
    byYear.set(y, months);
  }
  return Array.from(byYear.entries())
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([y, months]) => ({
      y,
      total: Array.from(months.values()).reduce((n, arr) => n + arr.length, 0),
      months: Array.from(months.entries())
        .sort((a, b) => (a[0] < b[0] ? 1 : -1))
        .map(([m, arr]) => ({
          key: `${y}-${m}`, m: Number(m) - 1,
          days: arr.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
        })),
    }));
}

/** A month's two most-seen feelings — shown on the collapsed header. */
function topFeelings(days: TimelineDay[]): string {
  const counts = new Map<string, number>();
  for (const d of days) if (d.emoji) counts.set(d.emoji, (counts.get(d.emoji) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([e]) => e).join('');
}

const LIST_DAY_CAP = 5;

// ─── 📋 List — the new default ─────────────────────────────────────

export function TimelineList({ days, onOpenDay, onShareDay, sw }: {
  days: TimelineDay[];
  onOpenDay: (date: string) => void;
  onShareDay?: (date: string) => void;
  sw: boolean;
}) {
  const tree = useMemo(() => buildTree(days), [days]);

  // Default open: latest year + its two newest months (Home-Projects rule).
  const newestY = tree[0]?.y ?? '';
  const defaultMonths = (tree[0]?.months ?? []).slice(0, 2).map((mo) => mo.key);
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set(newestY ? [newestY] : []));
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set(defaultMonths));
  const [fullMonths, setFullMonths] = useState<Set<string>>(() => new Set());

  if (tree.length === 0) return null;

  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const MONTHS_FULL = sw ? MONTHS_FULL_SW : MONTHS_FULL_EN;

  return (
    <div className="mt-3 space-y-2">
      {tree.map((yr) => {
        const yOpen = openYears.has(yr.y);
        return (
          <div key={yr.y}>
            <button type="button" onClick={() => setOpenYears((s) => toggle(s, yr.y))}
              aria-expanded={yOpen}
              className="w-full grid items-center gap-2 rounded-xl border-[1.5px] border-[#EDE6DA] bg-white px-3 py-2.5 text-left"
              style={{ gridTemplateColumns: '1fr 56px 18px' }}>
              <span className="font-nunito font-black text-[15px] text-[#0F1F44] flex items-center gap-1.5">
                <span aria-hidden>🗓</span>{yr.y}
              </span>
              <span className="justify-self-end rounded-full bg-[#FBEAF4] px-2.5 py-[2px] text-center text-[10.5px] font-nunito font-extrabold text-[#7A2E5C] tabular-nums" style={{ minWidth: 48 }}>
                {yr.total}
              </span>
              <span className="justify-self-end inline-block w-[18px] text-center text-[11px] text-[#5A6488] transition-transform"
                style={{ transform: yOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} aria-hidden>▾</span>
            </button>

            {yOpen && (
              <div className="pl-2.5">
                {yr.months.map((mo, moIdx) => {
                  const mOpen = openMonths.has(mo.key);
                  const feelings = topFeelings(mo.days);
                  const shown = fullMonths.has(mo.key) ? mo.days : mo.days.slice(0, LIST_DAY_CAP);
                  const hidden = mo.days.length - shown.length;
                  return (
                    <div key={mo.key}>
                      <button type="button" onClick={() => setOpenMonths((s) => toggle(s, mo.key))}
                        aria-expanded={mOpen}
                        className={`w-full grid items-center gap-2 py-2 px-1 text-left ${moIdx === 0 ? '' : 'border-t border-[#ECE4D3]'}`}
                        style={{ gridTemplateColumns: '1fr 56px 18px' }}>
                        <span className="text-[13px] font-nunito font-extrabold text-[#0F1F44] flex items-center gap-1.5 min-w-0 truncate">
                          <span aria-hidden>📅</span>
                          <span className="truncate">{MONTHS_FULL[mo.m]}</span>
                          {feelings && <span className="text-[12px]" aria-hidden>{feelings}</span>}
                        </span>
                        <span className="justify-self-end rounded-full bg-[#F4ECDB] px-2.5 py-[2px] text-center text-[10.5px] font-nunito font-extrabold text-[#5A6488] tabular-nums" style={{ minWidth: 48 }}>
                          {mo.days.length}
                        </span>
                        <span className="justify-self-end inline-block w-[18px] text-center text-[11px] text-[#5A6488] transition-transform"
                          style={{ transform: mOpen ? 'rotate(0deg)' : 'rotate(-90deg)' }} aria-hidden>▾</span>
                      </button>
                      {mOpen && (
                        <div className="space-y-1.5 pb-2 pl-2">
                          {shown.map((d) => (
                            <DayCard key={d.date} d={d} onOpen={onOpenDay} onShare={onShareDay} sw={sw} />
                          ))}
                          {hidden > 0 && (
                            <button type="button" onClick={() => setFullMonths((s) => toggle(s, mo.key))}
                              className="w-full py-1 text-center font-nunito font-black text-[11.5px] text-[#C05299]">
                              ＋ {sw ? `siku ${hidden} zaidi` : `${hidden} more ${hidden === 1 ? 'day' : 'days'}`}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── 🗂 Browse — the approved dropdown pair (kept from v1) ──────────

export function TimelineBrowse({ days, onOpenDay, onShareDay, sw }: {
  days: TimelineDay[];
  onOpenDay: (date: string) => void;
  onShareDay?: (date: string) => void;
  sw: boolean;
}) {
  const tree = useMemo(() => buildTree(days), [days]);
  const [selYear, setSelYear] = useState<string>(() => tree[0]?.y ?? '');
  const [selMonth, setSelMonth] = useState<string>(() => tree[0]?.months[0]?.key ?? '');
  const [panel, setPanel] = useState<'year' | 'month' | null>(null);

  if (tree.length === 0) return null;

  // Selections can go stale when the data refreshes — snap back to newest.
  const yearBucket = tree.find((t) => t.y === selYear) ?? tree[0];
  const monthBucket = yearBucket.months.find((m) => m.key === selMonth) ?? yearBucket.months[0];

  const MONTHS = sw ? MONTHS_SW : MONTHS_EN;
  const MONTHS_FULL = sw ? MONTHS_FULL_SW : MONTHS_FULL_EN;
  const monthsWith = new Set(yearBucket.months.map((m) => m.m));

  const jumpLatest = () => {
    const y = tree[0]; const m = y.months[0];
    setSelYear(y.y); setSelMonth(m.key); setPanel(null);
    if (m.days[0]) onOpenDay(m.days[0].date);
  };
  const surprise = () => {
    const all = tree.flatMap((y) => y.months.flatMap((m) => m.days));
    if (all.length === 0) return;
    onOpenDay(all[Math.floor(Math.random() * all.length)].date);
  };

  return (
    <div className="mt-3">
      <div className="flex gap-2 mb-2">
        <button type="button" onClick={jumpLatest}
          className="rounded-full bg-[#7A2E5C] px-3 py-1.5 font-nunito font-extrabold text-[11.5px] text-white">
          ⚡ {sw ? 'Za karibuni' : 'Latest'}
        </button>
        <button type="button" onClick={surprise}
          className="rounded-full border-[1.5px] border-[#EDE6DA] bg-white px-3 py-1.5 font-nunito font-extrabold text-[11.5px] text-[#7A2E5C]">
          🎲 {sw ? 'Nishangaze' : 'Surprise me'}
        </button>
      </div>

      <div className="flex gap-2">
        <button type="button" onClick={() => setPanel(panel === 'year' ? null : 'year')}
          className="flex-1 flex items-center justify-between rounded-xl border-[1.5px] border-[#EDE6DA] bg-white px-3 py-2 font-nunito font-extrabold text-[13.5px] text-[#0F1F44]">
          <span>{yearBucket.y}
            <span className="ml-1.5 rounded-full bg-[#C05299] px-1.5 py-[1px] text-[10.5px] text-white">{yearBucket.total}</span>
          </span>
          <span className="text-[12px] text-[#C05299]" aria-hidden>▾</span>
        </button>
        <button type="button" onClick={() => setPanel(panel === 'month' ? null : 'month')}
          className="flex-1 flex items-center justify-between rounded-xl border-[1.5px] border-[#EDE6DA] bg-white px-3 py-2 font-nunito font-extrabold text-[13.5px] text-[#0F1F44]">
          <span>{monthBucket ? MONTHS_FULL[monthBucket.m] : '—'}
            {monthBucket && <span className="ml-1.5 rounded-full bg-[#C05299] px-1.5 py-[1px] text-[10.5px] text-white">{monthBucket.days.length}</span>}
          </span>
          <span className="text-[12px] text-[#C05299]" aria-hidden>▾</span>
        </button>
      </div>

      {panel === 'year' && (
        <div className="mt-2 rounded-2xl border-[1.5px] border-[#EDE6DA] bg-white p-2.5 shadow-[0_8px_20px_rgba(15,31,68,0.08)]">
          <div className="text-[10.5px] text-[#5A6488] mb-1.5 px-0.5">{sw ? 'Miaka yenye kumbukumbu tu' : 'Only years with entries appear'}</div>
          <div className="flex flex-wrap gap-1.5">
            {tree.map((y) => (
              <button key={y.y} type="button"
                onClick={() => { setSelYear(y.y); setSelMonth(y.months[0]?.key ?? ''); setPanel(null); }}
                className={`flex items-center gap-1.5 rounded-xl border-[1.5px] px-2.5 py-1.5 font-nunito font-extrabold text-[12.5px] ${
                  y.y === yearBucket.y ? 'border-[#C05299] bg-[#FBEAF4] text-[#7A2E5C]' : 'border-[#EDE6DA] bg-[#FFFBF5] text-[#0F1F44]'
                }`}>
                {y.y} <span className="rounded-full bg-[#66BB6A] px-1.5 text-[10px] text-white">{y.total}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {panel === 'month' && (
        <div className="mt-2 rounded-2xl border-[1.5px] border-[#EDE6DA] bg-white p-2.5 shadow-[0_8px_20px_rgba(15,31,68,0.08)]">
          <div className="text-[10.5px] text-[#5A6488] mb-1.5 px-0.5">
            {sw ? 'Miezi yenye kumbukumbu · isiyo nayo imefifishwa' : 'Months with entries · empty months ghosted'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 12 }, (_, m) => {
              const bucket = yearBucket.months.find((x) => x.m === m);
              if (!monthsWith.has(m)) {
                return (
                  <span key={m} className="rounded-xl border-[1.5px] border-dashed border-[#EDE6DA] px-2.5 py-1.5 font-nunito font-extrabold text-[12.5px] text-[#0F1F44] opacity-40">
                    {MONTHS[m]}
                  </span>
                );
              }
              return (
                <button key={m} type="button"
                  onClick={() => { setSelMonth(bucket!.key); setPanel(null); }}
                  className={`flex items-center gap-1.5 rounded-xl border-[1.5px] px-2.5 py-1.5 font-nunito font-extrabold text-[12.5px] ${
                    bucket!.key === monthBucket?.key ? 'border-[#C05299] bg-[#FBEAF4] text-[#7A2E5C]' : 'border-[#EDE6DA] bg-[#FFFBF5] text-[#0F1F44]'
                  }`}>
                  {MONTHS[m]} <span className="rounded-full bg-[#66BB6A] px-1.5 text-[10px] text-white">{bucket!.days.length}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-2 space-y-1.5">
        {(monthBucket?.days ?? []).map((d) => (
          <DayCard key={d.date} d={d} onOpen={onOpenDay} onShare={onShareDay} sw={sw} />
        ))}
      </div>
    </div>
  );
}

// ─── 🎞 Memory Lane — "On this day" ────────────────────────────────

function backDateKey(monthsBack: number, yearsBack: number): string {
  const t = new Date();
  const d = new Date(t.getFullYear() - yearsBack, t.getMonth() - monthsBack, t.getDate());
  // Clamped months (e.g. 31-Mar minus 1 month → 03-Mar) are not "the same
  // day" — skip when the day-of-month drifted.
  if (d.getDate() !== t.getDate()) return '';
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function MemoryLane({ days, onOpenDay, sw }: {
  days: TimelineDay[]; onOpenDay: (date: string) => void; sw: boolean;
}) {
  const hits = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const out: Array<{ d: TimelineDay; label: string }> = [];
    const yearAgo = backDateKey(0, 1);
    const monthAgo = backDateKey(1, 0);
    const ya = yearAgo ? byDate.get(yearAgo) : undefined;
    const ma = monthAgo ? byDate.get(monthAgo) : undefined;
    if (ya && !ya.locked) out.push({ d: ya, label: sw ? 'mwaka mmoja uliopita' : 'one year ago' });
    if (ma && !ma.locked) out.push({ d: ma, label: sw ? 'mwezi mmoja uliopita' : 'one month ago' });
    return out;
  }, [days, sw]);

  if (hits.length === 0) return null;

  return (
    <div className="mt-3 rounded-2xl border-[1.5px] border-[#F3D9A5] p-3"
      style={{ background: 'linear-gradient(120deg,#FFF3D6,#FFE9F5)' }}>
      <div className="font-nunito font-black text-[11px] tracking-wide text-[#8A6100]">
        🎞 {sw ? 'SIKU KAMA YA LEO' : 'ON THIS DAY'}
      </div>
      <div className="space-y-1.5 mt-1">
        {hits.map(({ d, label }) => (
          <button key={d.date} type="button" onClick={() => onOpenDay(d.date)} className="block w-full text-left">
            <span className="block text-[11px] font-bold text-[#8A6100]">{label} · {toDisplayDate(d.date)}</span>
            <span className="block text-[12.5px] italic text-[#0F1F44] truncate">
              {d.preview ? `“${d.preview}”` : (d.emoji ?? '📝')}
              <span className="not-italic font-nunito font-black text-[#7A2E5C]"> → {sw ? 'fungua' : 'open'}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── mapping helpers (page-side sugar) ─────────────────────────────

/** First non-empty line of a note, trimmed for the card preview. */
export function previewLine(text: string | undefined | null, max = 90): string {
  if (!text) return '';
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** "MON · 04-Aug-2026" — the day-card label, shared with Note Studio. */
export function timelineDayLabel(date: string, sw: boolean): string {
  return `${dowLabel(date, sw)} · ${toDisplayDate(date)}`;
}

/** "August 2026" from a YYYY-MM-DD key — month-book covers etc. */
export function timelineMonthLabel(date: string, sw: boolean): string {
  const m = Number(date.slice(5, 7)) - 1;
  return `${(sw ? MONTHS_FULL_SW : MONTHS_FULL_EN)[m] ?? ''} ${date.slice(0, 4)}`;
}
