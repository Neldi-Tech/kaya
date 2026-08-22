'use client';

// Sparks · 📚 Filled-days browser (PAST-1 · 2026-07-22).
//
// The past, drill-down style: Years ▸ Months ▸ Days — ONLY the days that
// were actually filled. Shared by the Diary and Reflection pages so a
// parent (or the kid) can drop straight into any page ever written.
// ⭐ marks days a parent starred / rated; 🔒 marks locked diary days.
// Newest year + month open by default; everything else one tap away.

import { useMemo, useState } from 'react';

export interface FilledDay {
  date: string;        // YYYY-MM-DD
  emoji?: string;      // feeling / mood shown on the chip
  starred?: boolean;   // a parent starred / rated something that day
  locked?: boolean;    // diary: at least one locked page that day
  count?: number;      // entries that day (>1 shows a small ×n)
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_SW = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ago', 'Sep', 'Okt', 'Nov', 'Des'];

export default function FilledDaysBrowser({
  days, onOpenDay, sw, title, starLabel, accent = '#7A2E5C', soft = '#FDF3F9', line = '#EBC2DC',
}: {
  days: FilledDay[];
  onOpenDay: (date: string) => void;
  sw: boolean;
  title?: string;
  /** Legend text for ⭐ (e.g. "starred by a parent" / "rated by a parent"). */
  starLabel?: string;
  accent?: string; soft?: string; line?: string;
}) {
  // Group: year → month → days (desc everywhere — newest first).
  const tree = useMemo(() => {
    const byYear = new Map<string, Map<string, FilledDay[]>>();
    for (const d of days) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date)) continue;
      const y = d.date.slice(0, 4), m = d.date.slice(5, 7);
      const months = byYear.get(y) ?? new Map<string, FilledDay[]>();
      months.set(m, [...(months.get(m) ?? []), d]);
      byYear.set(y, months);
    }
    return Array.from(byYear.entries())
      .sort((a, b) => (a[0] < b[0] ? 1 : -1))
      .map(([y, months]) => ({
        y,
        total: Array.from(months.values()).reduce((n, arr) => n + arr.length, 0),
        stars: Array.from(months.values()).reduce((n, arr) => n + arr.filter((x) => x.starred).length, 0),
        months: Array.from(months.entries())
          .sort((a, b) => (a[0] < b[0] ? 1 : -1))
          .map(([m, arr]) => ({
            m, days: arr.slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
            stars: arr.filter((x) => x.starred).length,
          })),
      }));
  }, [days]);

  const newestY = tree[0]?.y ?? '';
  const newestM = tree[0]?.months[0]?.m ?? '';
  const [openYears, setOpenYears] = useState<Set<string>>(() => new Set(newestY ? [newestY] : []));
  const [openMonths, setOpenMonths] = useState<Set<string>>(() => new Set(newestY && newestM ? [`${newestY}-${newestM}`] : []));

  if (tree.length === 0) return null;

  const toggle = (set: Set<string>, k: string) => { const n = new Set(set); if (n.has(k)) n.delete(k); else n.add(k); return n; };
  const MONTHS = sw ? MONTHS_SW : MONTHS_EN;

  return (
    <div className="mt-3 rounded-2xl border bg-white p-3" style={{ borderColor: line }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="text-[10px] font-nunito font-black uppercase tracking-[1.2px]" style={{ color: accent }}>
          {title ?? (sw ? '📚 Siku zilizojazwa' : '📚 Filled days')}
        </div>
        <div className="text-[10px] font-bold text-[#5A6488]">
          ⭐ {starLabel ?? (sw ? 'mzazi ameweka nyota' : 'starred by a parent')}
        </div>
      </div>

      <div className="space-y-1.5">
        {tree.map((yr) => {
          const yOpen = openYears.has(yr.y);
          return (
            <div key={yr.y} className="rounded-xl border" style={{ borderColor: line, background: yOpen ? soft : '#fff' }}>
              <button type="button" onClick={() => setOpenYears((s) => toggle(s, yr.y))}
                className="w-full flex items-center justify-between px-3 py-2 text-left">
                <span className="font-nunito font-black text-[13px] text-[#0F1F44]">
                  <span className="inline-block w-4 text-[#5A6488]">{yOpen ? '▾' : '▸'}</span>{yr.y}
                </span>
                <span className="text-[10.5px] font-extrabold text-[#5A6488]">
                  {yr.total} {sw ? 'siku' : yr.total === 1 ? 'day' : 'days'}{yr.stars > 0 ? ` · ⭐ ${yr.stars}` : ''}
                </span>
              </button>

              {yOpen && (
                <div className="px-2 pb-2 space-y-1">
                  {yr.months.map((mo) => {
                    const key = `${yr.y}-${mo.m}`;
                    const mOpen = openMonths.has(key);
                    return (
                      <div key={key} className="rounded-lg bg-white border" style={{ borderColor: line }}>
                        <button type="button" onClick={() => setOpenMonths((s) => toggle(s, key))}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 text-left">
                          <span className="font-nunito font-extrabold text-[12px] text-[#0F1F44]">
                            <span className="inline-block w-4 text-[#5A6488]">{mOpen ? '▾' : '▸'}</span>{MONTHS[Number(mo.m) - 1]}
                          </span>
                          <span className="text-[10px] font-extrabold text-[#5A6488]">
                            {mo.days.length}{mo.stars > 0 ? ` · ⭐ ${mo.stars}` : ''}
                          </span>
                        </button>
                        {mOpen && (
                          <div className="flex flex-wrap gap-1.5 px-2.5 pb-2">
                            {mo.days.map((d) => (
                              <button key={d.date} type="button" onClick={() => onOpenDay(d.date)}
                                title={d.date}
                                className="relative rounded-lg border px-2 py-1 text-[11.5px] font-extrabold text-[#0F1F44] hover:bg-[#FFFAEB]"
                                style={{ borderColor: d.starred ? '#D4A847' : line, background: d.starred ? '#FFFAEB' : '#fff' }}>
                                <span className="text-[#5A6488]">{Number(d.date.slice(8, 10))}</span>
                                {d.emoji && <span className="ml-1">{d.emoji}</span>}
                                {d.locked && <span className="ml-0.5 text-[10px]">🔒</span>}
                                {(d.count ?? 1) > 1 && <span className="ml-0.5 text-[9px] text-[#5A6488]">×{d.count}</span>}
                                {d.starred && <span className="absolute -top-1.5 -right-1 text-[10px]">⭐</span>}
                              </button>
                            ))}
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
    </div>
  );
}
