'use client';

// Sparks · Timeline 2.0 — Hit-map 2.0 (approved design v2, 2026-08-25).
//
// Four zoom levels so one sparse month never eats the screen:
//   Month     — the detailed tappable grid (day numbers, missed shading)
//   6 Months  — two columns of micro-dot mini-months
//   Year      — all 12 mini-months on one screen
//   All years — one row per year, 12 month-cells shaded by fill + count
// Tap always zooms DOWN one level: year-cell → month → day sheet.
//
// Three colour layers: ✅ Score (green ramp, reflection only) ·
// 🌈 Feelings (sunny/calm/stormy/angry — sadness is stormy blue, never
// alarm red; 😡 gets the only red) · 👣 Presence (calm single green).
// "Missed" shading needs `activeDays` (school-day rule) — the diary has
// no expected days, so it simply never shows misses.

import { useMemo, useState } from 'react';
import type { DayOfWeek } from '@/lib/firestore';
import type { TimelineDay } from '@/components/sparks/TimelineViews';

export type HitLayer = 'score' | 'feelings' | 'presence';
type HitZoom = 'month' | 'six' | 'year' | 'years';

const DOW: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SW = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];
const MONTHS_FULL_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_FULL_SW = ['Januari', 'Februari', 'Machi', 'Aprili', 'Mei', 'Juni', 'Julai', 'Agosti', 'Septemba', 'Oktoba', 'Novemba', 'Desemba'];

// Feeling → weather family. Sadness/tiredness = stormy blue (never an
// alarm colour); anger is the only red; everything bright = sunny.
const SUNNY = new Set(['😊', '😄', '🤩', '🥳', '😁', '😍', '🤗', '😎', '🥰', '😌', '💪', '🌟']);
const ANGRY = new Set(['😡', '😠', '🤬']);
const STORMY = new Set(['😢', '🙁', '😞', '😭', '😔', '😴', '😟', '😨', '😰', '🥺']);

const C = {
  off: '#F1ECE0', miss: '#FFE0DA', logged: '#DFF0E2',
  s85: '#1F7A44', s60: '#9AD9AD', sLow: '#CFE5D6',
  sunny: '#F5B301', calm: '#AEB8D0', stormy: '#6FA8DC', angry: '#E57373',
  presence: '#66BB6A',
};

function weatherOf(emoji: string | undefined): 'sunny' | 'calm' | 'stormy' | 'angry' | null {
  if (!emoji) return null;
  if (SUNNY.has(emoji)) return 'sunny';
  if (ANGRY.has(emoji)) return 'angry';
  if (STORMY.has(emoji)) return 'stormy';
  return 'calm';
}

function cellColor(d: TimelineDay | undefined, layer: HitLayer): string | null {
  if (!d) return null;
  if (layer === 'presence') return C.presence;
  if (layer === 'feelings') {
    const w = weatherOf(d.emoji);
    return w ? C[w] : C.logged;
  }
  // score
  if (typeof d.score !== 'number') return C.logged;
  return d.score >= 85 ? C.s85 : d.score >= 60 ? C.s60 : C.sLow;
}

function dayKeyOf(y: number, m: number, day: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function todayKey(): string {
  const t = new Date();
  return dayKeyOf(t.getFullYear(), t.getMonth(), t.getDate());
}
function dowOfKey(k: string): DayOfWeek {
  return DOW[new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10))).getDay()];
}

/** Monday-padded day keys for one month ('' = pad). */
function monthKeys(y: number, m: number): string[] {
  const first = new Date(y, m, 1);
  const last = new Date(y, m + 1, 0).getDate();
  const out: string[] = [];
  const lead = (first.getDay() + 6) % 7;
  for (let i = 0; i < lead; i++) out.push('');
  for (let d = 1; d <= last; d++) out.push(dayKeyOf(y, m, d));
  return out;
}

export default function TimelineHitMap({
  days, activeDays, onOpenDay, sw, layers = ['score', 'feelings', 'presence'], defaultLayer,
}: {
  days: TimelineDay[];
  /** Expected writing days — enables "missed" shading (reflection). */
  activeDays?: Set<DayOfWeek>;
  onOpenDay: (date: string) => void;
  sw: boolean;
  layers?: HitLayer[];
  defaultLayer?: HitLayer;
}) {
  const now = new Date();
  const tKey = todayKey();
  const [zoom, setZoom] = useState<HitZoom>('six');
  const [layer, setLayer] = useState<HitLayer>(defaultLayer ?? layers[0]);
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  // 6-months / year pagers (0 = the window ending now; -1 = earlier).
  const [sixPage, setSixPage] = useState(0);
  const [yearPage, setYearPage] = useState(0);

  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const earliestYear = useMemo(
    () => (days.length ? Math.min(...days.map((d) => Number(d.date.slice(0, 4)))) : now.getFullYear()),
    [days, now],
  );

  const MONTHS = sw ? MONTHS_SW : MONTHS_EN;
  const MONTHS_FULL = sw ? MONTHS_FULL_SW : MONTHS_FULL_EN;

  // ── the months a zoom level renders ──
  const renderedMonths = useMemo((): Array<{ y: number; m: number }> => {
    if (zoom === 'month') return [{ y: cursor.y, m: cursor.m }];
    if (zoom === 'six') {
      const end = now.getMonth() + sixPage * 6;
      return Array.from({ length: 6 }, (_, i) => {
        const d = new Date(now.getFullYear(), end - 5 + i, 1);
        return { y: d.getFullYear(), m: d.getMonth() };
      });
    }
    if (zoom === 'year') {
      const y = now.getFullYear() + yearPage;
      return Array.from({ length: 12 }, (_, m) => ({ y, m }));
    }
    // years — every month from earliestYear → now
    const out: Array<{ y: number; m: number }> = [];
    for (let y = earliestYear; y <= now.getFullYear(); y++) for (let m = 0; m < 12; m++) out.push({ y, m });
    return out;
  }, [zoom, cursor, sixPage, yearPage, earliestYear, now]);

  // ── stats over every real past day in the rendered range ──
  const stats = useMemo(() => {
    const keys = renderedMonths.flatMap(({ y, m }) => monthKeys(y, m)).filter(Boolean);
    let logged = 0, missed = 0, sum = 0, scored = 0, run = 0, best = 0;
    const sortedKeys = keys.slice().sort();
    for (const k of sortedKeys) {
      if (k > tKey) continue;
      const d = byDate.get(k);
      if (d) {
        logged++;
        if (typeof d.score === 'number') { sum += d.score; scored++; }
        run++; if (run > best) best = run;
      } else if (activeDays?.has(dowOfKey(k))) {
        missed++; run = 0;
      } else if (!activeDays) {
        run = 0;
      }
      // active-day rule: non-active empty days neither count nor break
    }
    return { logged, missed, avg: scored ? Math.round(sum / scored) : null, best };
  }, [renderedMonths, byDate, activeDays, tKey]);

  // ── 🌦 weather line for the month zoom ──
  const weather = useMemo(() => {
    if (zoom !== 'month') return '';
    const list = monthKeys(cursor.y, cursor.m).filter(Boolean)
      .map((k) => byDate.get(k)).filter(Boolean) as TimelineDay[];
    if (list.length === 0) return '';
    let sunny = 0, stormy = 0, angry = 0;
    for (const d of list) {
      const w = weatherOf(d.emoji);
      if (w === 'sunny') sunny++;
      else if (w === 'stormy') stormy++;
      else if (w === 'angry') angry++;
    }
    const bits: string[] = [];
    if (sunny >= Math.max(stormy, angry)) bits.push(sw ? 'Zaidi jua ☀️' : 'Mostly sunny ☀️');
    else if (stormy >= angry) bits.push(sw ? 'Zaidi mawingu 🌧' : 'Mostly stormy 🌧');
    else bits.push(sw ? 'Siku za radi ⛈' : 'A thundery month ⛈');
    if (bits[0].includes('☀️') && stormy > 0) bits.push(sw ? `siku ${stormy} za mvua 🌧` : `${stormy} stormy ${stormy === 1 ? 'day' : 'days'} 🌧`);
    if (angry > 0 && !bits[0].includes('⛈')) bits.push(sw ? `radi ${angry} ⛈` : `${angry} thundery ⛈`);
    return bits.join(' · ');
  }, [zoom, cursor, byDate, sw]);

  if (days.length === 0) return null;

  const layerLabel = (l: HitLayer) =>
    l === 'score' ? (sw ? '✅ Alama' : '✅ Score')
      : l === 'feelings' ? (sw ? '🌈 Hisia' : '🌈 Feelings')
        : (sw ? '👣 Uwepo' : '👣 Presence');

  const zoomLabel = (z: HitZoom) =>
    z === 'month' ? (sw ? 'Mwezi' : 'Month')
      : z === 'six' ? (sw ? 'Miezi 6' : '6 Months')
        : z === 'year' ? (sw ? 'Mwaka' : 'Year')
          : (sw ? 'Miaka yote' : 'All years');

  const openMonth = (y: number, m: number) => { setCursor({ y, m }); setZoom('month'); };

  // ── micro-dot mini-month card ──
  const MiniMonth = ({ y, m }: { y: number; m: number }) => {
    const keys = monthKeys(y, m);
    const filled = keys.filter((k) => k && byDate.has(k)).length;
    const total = new Date(y, m + 1, 0).getDate();
    return (
      <button type="button" onClick={() => openMonth(y, m)}
        className="rounded-xl border-[1.5px] border-[#EDE6DA] bg-white p-2 text-left hover:border-[#C05299]">
        <span className="flex items-center justify-between font-nunito font-black text-[11px] text-[#7A2E5C] mb-1">
          <span>{MONTHS[m]}{zoom === 'six' ? ` ${y}` : ''}</span>
          <span className="text-[#5A6488] font-extrabold">{filled}/{total}</span>
        </span>
        <span className="grid grid-cols-7 gap-[2.5px]">
          {keys.map((k, i) => {
            if (!k) return <span key={`p${i}`} className="aspect-square" />;
            const d = byDate.get(k);
            const future = k > tKey;
            const missedDay = !d && !future && activeDays?.has(dowOfKey(k));
            const bg = d ? cellColor(d, layer)! : missedDay ? C.miss : future ? 'transparent' : C.off;
            return (
              <span key={k} className="aspect-square rounded-[3.5px]"
                style={{ background: bg, ...(future ? { border: '1px dashed #E5DECF' } : {}) }} />
            );
          })}
        </span>
      </button>
    );
  };

  return (
    <div className="mt-3 rounded-2xl border-[1.5px] border-[#EDE6DA] bg-white p-3">
      {/* zoom pills */}
      <div className="flex gap-1.5">
        {(['month', 'six', 'year', 'years'] as HitZoom[]).map((z) => (
          <button key={z} type="button" onClick={() => setZoom(z)}
            className={`flex-1 rounded-full border-[1.5px] py-1.5 px-0.5 text-center font-nunito font-extrabold text-[11.5px] ${
              zoom === z ? 'border-[#7A2E5C] bg-[#7A2E5C] text-white' : 'border-[#EDE6DA] bg-white text-[#5A6488]'
            }`}>
            {zoomLabel(z)}
          </button>
        ))}
      </div>

      {/* colour layers */}
      {layers.length > 1 && (
        <div className="flex items-center gap-1.5 mt-2">
          <span className="text-[10.5px] font-bold text-[#5A6488]">{sw ? 'Rangi kwa' : 'Colour by'}</span>
          {layers.map((l) => (
            <button key={l} type="button" onClick={() => setLayer(l)}
              className={`rounded-full border-[1.5px] px-2.5 py-1 font-nunito font-extrabold text-[10.5px] ${
                layer === l ? 'border-[#C05299] bg-[#FBEAF4] text-[#7A2E5C]' : 'border-[#EDE6DA] bg-white text-[#5A6488]'
              }`}>
              {layerLabel(l)}
            </button>
          ))}
        </div>
      )}

      {/* stats chips */}
      <div className="grid grid-cols-4 gap-1.5 mt-2">
        {[
          { v: String(stats.logged), l: sw ? 'zimeandikwa' : 'logged' },
          { v: activeDays ? String(stats.missed) : '—', l: sw ? 'zimekoswa' : 'missed' },
          { v: stats.avg != null ? `${stats.avg}%` : '—', l: sw ? 'wastani' : 'avg score' },
          { v: `🔥 ${stats.best}`, l: sw ? 'mfululizo' : 'best run' },
        ].map((s) => (
          <div key={s.l} className="rounded-xl border-[1.5px] border-[#EDE6DA] bg-[#FFFBF5] py-1.5 text-center">
            <div className="font-nunito font-black text-[14px] text-[#0F1F44]">{s.v}</div>
            <div className="text-[9.5px] text-[#5A6488]">{s.l}</div>
          </div>
        ))}
      </div>

      {/* ── MONTH zoom — the detailed grid ── */}
      {zoom === 'month' && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <button type="button" aria-label="Previous month"
              onClick={() => setCursor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}
              disabled={cursor.y <= earliestYear && cursor.m === 0}
              className="px-2 font-nunito font-black text-[16px] text-[#5A6488] disabled:opacity-30">‹</button>
            <span className="font-nunito font-black text-[13.5px] text-[#0F1F44]">{MONTHS_FULL[cursor.m]} {cursor.y}</span>
            <button type="button" aria-label="Next month"
              onClick={() => setCursor(({ y, m }) => {
                if (y === now.getFullYear() && m === now.getMonth()) return { y, m };
                return m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
              })}
              disabled={cursor.y === now.getFullYear() && cursor.m === now.getMonth()}
              className="px-2 font-nunito font-black text-[16px] text-[#5A6488] disabled:opacity-30">›</button>
          </div>
          {weather && (
            <div className="text-[11px] font-bold text-[#5A6488] text-center mb-1.5">🌦 {weather}</div>
          )}
          <div className="grid grid-cols-7 gap-1 text-center">
            {(sw ? ['J2', 'J3', 'J4', 'J5', 'I', 'J', 'JP'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']).map((d, i) => (
              <span key={`${d}${i}`} className="text-[9.5px] font-extrabold text-[#5A6488]">{d}</span>
            ))}
            {monthKeys(cursor.y, cursor.m).map((k, i) => {
              if (!k) return <span key={`p${i}`} />;
              const d = byDate.get(k);
              const future = k > tKey;
              const missedDay = !d && !future && activeDays?.has(dowOfKey(k));
              const bg = d ? cellColor(d, layer)! : missedDay ? C.miss : future ? '#fff' : C.off;
              const dark = d && layer === 'score' && typeof d.score === 'number' && d.score >= 85;
              return (
                <button key={k} type="button" disabled={!d} onClick={() => d && onOpenDay(k)}
                  title={k}
                  className="aspect-square rounded-lg text-[10.5px] font-extrabold disabled:cursor-default"
                  style={{
                    background: bg,
                    color: dark ? '#fff' : '#0F1F44',
                    ...(future ? { border: '1.5px dashed #E5DECF' } : {}),
                  }}>
                  {layer === 'feelings' && d?.emoji
                    ? <span className="text-[13px]">{d.emoji}</span>
                    : Number(k.slice(8, 10))}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 6 MONTHS zoom ── */}
      {zoom === 'six' && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <button type="button" aria-label="Earlier"
              onClick={() => setSixPage((p) => p - 1)}
              className="px-2 font-nunito font-black text-[16px] text-[#5A6488]">‹</button>
            <span className="text-[11px] font-extrabold text-[#5A6488]">
              {sw ? 'Gusa mwezi kuukuza' : 'Tap a month to zoom in'}
            </span>
            <button type="button" aria-label="Later"
              onClick={() => setSixPage((p) => Math.min(0, p + 1))} disabled={sixPage >= 0}
              className="px-2 font-nunito font-black text-[16px] text-[#5A6488] disabled:opacity-30">›</button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {renderedMonths.map(({ y, m }) => <MiniMonth key={`${y}-${m}`} y={y} m={m} />)}
          </div>
        </div>
      )}

      {/* ── YEAR zoom ── */}
      {zoom === 'year' && (
        <div className="mt-2.5">
          <div className="flex items-center justify-between mb-1.5">
            <button type="button" aria-label="Previous year"
              onClick={() => setYearPage((p) => p - 1)}
              disabled={now.getFullYear() + yearPage <= earliestYear}
              className="px-2 font-nunito font-black text-[16px] text-[#5A6488] disabled:opacity-30">‹</button>
            <span className="font-nunito font-black text-[13.5px] text-[#0F1F44]">{now.getFullYear() + yearPage}</span>
            <button type="button" aria-label="Next year"
              onClick={() => setYearPage((p) => Math.min(0, p + 1))} disabled={yearPage >= 0}
              className="px-2 font-nunito font-black text-[16px] text-[#5A6488] disabled:opacity-30">›</button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {renderedMonths.map(({ y, m }) => <MiniMonth key={`${y}-${m}`} y={y} m={m} />)}
          </div>
        </div>
      )}

      {/* ── ALL YEARS zoom ── */}
      {zoom === 'years' && (
        <div className="mt-2.5 space-y-2">
          {Array.from({ length: now.getFullYear() - earliestYear + 1 }, (_, i) => now.getFullYear() - i).map((y) => {
            const counts = Array.from({ length: 12 }, (_, m) =>
              days.filter((d) => Number(d.date.slice(0, 4)) === y && Number(d.date.slice(5, 7)) === m + 1).length);
            const total = counts.reduce((a, b) => a + b, 0);
            return (
              <div key={y} className="rounded-xl border-[1.5px] border-[#EDE6DA] bg-white p-2.5">
                <div className="flex items-baseline justify-between font-nunito font-black text-[12.5px] text-[#0F1F44] mb-1.5">
                  <span>{y}</span>
                  <span className="text-[10.5px] text-[#5A6488] font-extrabold">
                    {total} {sw ? 'kumbukumbu' : total === 1 ? 'entry' : 'entries'}
                  </span>
                </div>
                <div className="grid grid-cols-12 gap-[3px]">
                  {counts.map((c, m) => {
                    const bg = c === 0 ? C.off : c < 3 ? '#E8F5E9' : c < 6 ? '#A5D6A7' : c < 10 ? '#66BB6A' : '#2E7D32';
                    const fg = c >= 6 ? '#fff' : '#0F1F44';
                    return (
                      <button key={m} type="button" onClick={() => openMonth(y, m)}
                        className="rounded-md flex flex-col items-center justify-center py-1"
                        style={{ background: bg }} title={`${MONTHS[m]} ${y}`}>
                        <span className="font-nunito font-black text-[9.5px]" style={{ color: fg }}>{c || ''}</span>
                        <span className="text-[7.5px]" style={{ color: c >= 6 ? 'rgba(255,255,255,.8)' : '#5A6488' }}>
                          {MONTHS[m][0]}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* legend */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2.5 text-[10px] text-[#5A6488]">
        <span className="inline-flex items-center gap-1">
          <span className="w-3 h-3 rounded-[3px]" style={{ background: C.off }} /> {sw ? 'tupu' : 'empty'}
        </span>
        {activeDays && (
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-[3px]" style={{ background: C.miss }} /> {sw ? 'imekoswa' : 'missed'}
          </span>
        )}
        {layer === 'score' && (
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-[3px]" style={{ background: C.sLow }} />
            <span className="w-3 h-3 rounded-[3px]" style={{ background: C.s60 }} />
            <span className="w-3 h-3 rounded-[3px]" style={{ background: C.s85 }} /> {sw ? 'alama →' : 'score →'}
          </span>
        )}
        {layer === 'feelings' && (
          <>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-[3px]" style={{ background: C.sunny }} /> ☀️</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-[3px]" style={{ background: C.calm }} /> 😐</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-[3px]" style={{ background: C.stormy }} /> 🌧</span>
            <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-[3px]" style={{ background: C.angry }} /> ⛈</span>
          </>
        )}
        {layer === 'presence' && (
          <span className="inline-flex items-center gap-1">
            <span className="w-3 h-3 rounded-[3px]" style={{ background: C.presence }} /> {sw ? 'imeandikwa' : 'written'}
          </span>
        )}
      </div>
    </div>
  );
}
