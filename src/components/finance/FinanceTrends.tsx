'use client';

// Trends view for Finances + Dashboard (2026-06-15) — PR 2.
//
// Two SVG charts over a trailing month window:
//   • By category  — multi-line trendline, tap legend chips to focus.
//   • Compare months — stacked bars + a "biggest movers" delta list.
// Charts are hand-built inline SVG (the repo has no chart lib); the markup
// is computed to a string and injected, matching the approved design
// preview. Y-axis is #,### with a "<CCY> '000" title.

import { useMemo, useState } from 'react';
import { type PurchaseModule, MODULE_EMOJI, MODULE_LABEL } from '@/lib/purchase';
import { type ModuleSeries, lastTwoDeltas } from '@/lib/financeSeries';
import { shortMonthLabel } from '@/lib/timeRange';
import { formatCents } from '@/components/pantry/format';

// Per-module stroke/fill hex (SVG needs hex, not Tailwind classes).
const MODULE_HEX: Record<PurchaseModule, string> = {
  pantry: '#4A7C59', outdoor: '#7BA05B', drivers: '#4A6FA5', utility: '#C99A3A',
  payroll: '#8A6FBF', dineOut: '#C2562E', home: '#9B6B3F',
  subscriptions: '#1C2B49', contributions: '#C9A227',
};

type View = 'lines' | 'compare';

// cents → thousands of the major unit (e.g. 499,000 cents TZS → 4.99 → "5").
const toThousands = (cents: number) => Math.round(cents / 100 / 1000);
const fmtAxis = (v: number) => v.toLocaleString('en-US');
// Compact bar-top label: 4.1M / 320k / 0.
const compact = (cents: number) => {
  const major = cents / 100;
  if (major >= 1e6) return `${(major / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
  if (major >= 1e3) return `${Math.round(major / 1e3)}k`;
  return `${Math.round(major)}`;
};

export default function FinanceTrends({
  series, modules, currency,
}: {
  series: ModuleSeries;
  modules: PurchaseModule[];
  currency: string;
}) {
  const [view, setView] = useState<View>('lines');
  const [hidden, setHidden] = useState<Set<PurchaseModule>>(new Set());
  const active = modules.filter((m) => !hidden.has(m));
  const toggle = (m: PurchaseModule) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });

  const deltas = useMemo(() => lastTwoDeltas(series, modules), [series, modules]);
  const months = series.months;
  const W = 720, padR = 16, padT = 16, padB = 34, padL = 62;

  const axisTitle = (H: number) => {
    const cy = (padT + (H - padB)) / 2;
    return `<text transform="rotate(-90 13 ${cy})" x="13" y="${cy}" text-anchor="middle" fill="#8C8775" font-size="11" font-weight="900" letter-spacing=".6">${currency} ’000</text>`;
  };
  const gridAndYAxis = (H: number, maxV: number, y: (v: number) => number) => {
    let s = '';
    for (let g = 0; g <= 4; g++) {
      const gv = maxV * g / 4, yy = y(gv);
      s += `<line x1="${padL}" y1="${yy}" x2="${W - padR}" y2="${yy}" stroke="#EADFC8"/>`;
      s += `<text x="${padL - 9}" y="${yy + 4}" text-anchor="end" fill="#A79E89" font-size="11" font-weight="800">${fmtAxis(toThousands(gv))}</text>`;
    }
    return s + axisTitle(H);
  };

  // ---- line chart ----
  const lineSvg = useMemo(() => {
    const H = 300;
    const vals = active.flatMap((m) => series.perModule[m] ?? [0]);
    const maxV = Math.max(1, ...vals) * 1.12;
    const x = (i: number) => padL + (i * (W - padL - padR) / Math.max(1, months.length - 1));
    const y = (v: number) => H - padB - (v / maxV) * (H - padT - padB);
    let s = gridAndYAxis(H, maxV, y);
    months.forEach((k, i) => {
      s += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle" fill="#A79E89" font-size="11" font-weight="800">${shortMonthLabel(k, months.length > 6)}</text>`;
    });
    for (const m of active) {
      const arr = series.perModule[m] ?? [];
      const pts = arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
      s += `<polyline fill="none" stroke="${MODULE_HEX[m]}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
      arr.forEach((v, i) => { s += `<circle cx="${x(i)}" cy="${y(v)}" r="3.4" fill="#fff" stroke="${MODULE_HEX[m]}" stroke-width="2.4"/>`; });
    }
    return s;
  }, [active, series, months, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- stacked bars ----
  const barSvg = useMemo(() => {
    const H = 320;
    const totals = months.map((_, i) => active.reduce((a, m) => a + (series.perModule[m]?.[i] ?? 0), 0));
    const maxV = Math.max(1, ...totals) * 1.16;
    const slot = (W - padL - padR) / months.length;
    const bw = slot * 0.56;
    const cx = (i: number) => padL + (i + 0.5) * slot;
    const y = (v: number) => H - padB - (v / maxV) * (H - padT - padB);
    let s = gridAndYAxis(H, maxV, y);
    months.forEach((k, i) => {
      let acc = 0;
      for (const m of active) {
        const v = series.perModule[m]?.[i] ?? 0;
        if (v <= 0) continue;
        const y0 = y(acc), y1 = y(acc + v);
        s += `<rect x="${cx(i) - bw / 2}" y="${y1}" width="${bw}" height="${Math.max(0, y0 - y1)}" fill="${MODULE_HEX[m]}" rx="2"/>`;
        acc += v;
      }
      if (acc > 0) s += `<text x="${cx(i)}" y="${y(acc) - 7}" text-anchor="middle" fill="#16243F" font-size="11" font-weight="900">${compact(acc)}</text>`;
      s += `<text x="${cx(i)}" y="${H - 12}" text-anchor="middle" fill="#A79E89" font-size="11" font-weight="800">${shortMonthLabel(k, months.length > 6)}</text>`;
    });
    return s;
  }, [active, series, months, currency]); // eslint-disable-line react-hooks/exhaustive-deps

  const subBtn = (on: boolean) =>
    `font-nunito font-extrabold text-[13px] px-3.5 py-2 rounded-[10px] ${on ? 'bg-pantry-leaf-dk text-white' : 'text-hive-muted'}`;

  if (months.length === 0 || modules.length === 0) {
    return (
      <div className="bg-hive-paper border border-hive-line rounded-hive p-6 text-center text-hive-muted text-sm">
        Not enough history yet — trends appear once a couple of months have closed requests.
      </div>
    );
  }

  return (
    <div>
      <div className="inline-flex gap-1 bg-hive-paper border border-hive-line rounded-[12px] p-1 mb-3">
        <button type="button" className={subBtn(view === 'lines')} onClick={() => setView('lines')}>📈 By category</button>
        <button type="button" className={subBtn(view === 'compare')} onClick={() => setView('compare')}>📊 Compare months</button>
      </div>

      {/* Legend — tap to focus a category */}
      <div className="flex flex-wrap gap-2 mb-3">
        {modules.map((m) => {
          const off = hidden.has(m);
          return (
            <button key={m} type="button" onClick={() => toggle(m)}
              className={`inline-flex items-center gap-1.5 bg-hive-paper border border-hive-line rounded-full px-3 py-1.5 font-nunito font-extrabold text-[12px] ${off ? 'opacity-40' : ''}`}>
              <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: MODULE_HEX[m] }} />
              {MODULE_LABEL[m]}
            </button>
          );
        })}
      </div>

      <div className="bg-hive-paper border border-hive-line rounded-hive p-4">
        <div className="flex items-baseline justify-between mb-1">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">
            {view === 'lines' ? 'Spend by category' : 'Month vs month · total spend'}
          </p>
          <span className="text-[11px] text-hive-muted font-bold">{currency} ’000</span>
        </div>
        <svg viewBox={`0 0 ${W} ${view === 'lines' ? 300 : 320}`} className="w-full h-auto"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: view === 'lines' ? lineSvg : barSvg }} />
      </div>

      {/* Biggest movers — last two months in the window */}
      {deltas.length > 0 && (
        <div className="bg-hive-paper border border-hive-line rounded-hive p-4 mt-3">
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted mb-1">
            Biggest movers · {shortMonthLabel(months[months.length - 2])} → {shortMonthLabel(months[months.length - 1])}
          </p>
          <div className="divide-y divide-hive-line">
            {deltas.slice(0, 5).map((d) => {
              const up = d.deltaCents > 0;
              return (
                <div key={d.module} className="flex items-center justify-between gap-3 py-2">
                  <span className="font-nunito font-bold text-[13px] text-hive-ink inline-flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: MODULE_HEX[d.module] }} />
                    {MODULE_EMOJI[d.module]} {MODULE_LABEL[d.module]}
                  </span>
                  <span className={`font-nunito font-black text-[12.5px] tabular-nums ${up ? 'text-hive-rose' : 'text-pantry-leaf-dk'}`}>
                    {up ? '▲' : '▼'} {formatCents(Math.abs(d.deltaCents), currency)}
                    {d.deltaPct != null ? <span className="text-hive-muted font-bold"> · {up ? '+' : ''}{d.deltaPct}%</span> : null}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
