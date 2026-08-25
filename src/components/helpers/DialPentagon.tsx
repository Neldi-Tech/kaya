'use client';

// ⬟ Pentagon (radar) view of the five recognition dials.
//
// Lifted out of ⚖️ Compare mode (2026-08-25, Elia) so a SINGLE helper's
// Recognition tab can offer the same shape — a parent picks ▤ Bars or
// ⬟ Pentagon and the two read identically because they are now one
// component. Compare passes 2–3 series; a single helper passes one.
//
// Why a parent might want it: bars answer "how high is each dial?",
// the pentagon answers "what shape is this person?" — a lopsided
// pentagon shows an imbalance (all Workplan, no Corrections) at a
// glance in a way five separate bars do not.

import { DIAL_META, type HelperDials } from '@/lib/helperRecognition';

export interface PentagonSeries {
  key: string;
  color: string;
  dials: HelperDials;
}

/** Polygon points for one series (or one grid ring). */
export function radarPoints(values: Array<number | null | undefined>, cx: number, cy: number, r: number): string {
  const n = values.length;
  return values.map((v, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const len = ((v ?? 0) / 100) * r;
    return `${(cx + Math.cos(angle) * len).toFixed(1)},${(cy + Math.sin(angle) * len).toFixed(1)}`;
  }).join(' ');
}

export default function DialPentagon({ series, size = 230, showValues = false }: {
  series: PentagonSeries[];
  size?: number;
  /** Single-helper view prints the number at each corner — with one
   *  series there is room for it, and it saves cross-referencing. */
  showValues?: boolean;
}) {
  const w = size;
  const h = Math.round(size * 0.91);
  const cx = w / 2;
  const cy = h / 2;
  const r = size * 0.34;

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mx-auto lg:mx-0 shrink-0"
      role="img" aria-label="Five recognition dials as a pentagon">
      {[100, 66, 33].map((ring) => (
        <polygon key={ring} points={radarPoints([ring, ring, ring, ring, ring], cx, cy, r)}
          fill="none" stroke="#E8E0D4" strokeWidth="1" />
      ))}
      {/* Spokes — make an empty dial readable as "zero", not "missing". */}
      {DIAL_META.map((m, i) => {
        const a = (Math.PI * 2 * i) / DIAL_META.length - Math.PI / 2;
        return (
          <line key={`spoke-${m.key}`} x1={cx} y1={cy}
            x2={cx + Math.cos(a) * r} y2={cy + Math.sin(a) * r}
            stroke="#F0EBE3" strokeWidth="1" />
        );
      })}
      {series.map((s) => (
        <polygon key={s.key}
          points={radarPoints(DIAL_META.map((m) => s.dials[m.key]), cx, cy, r)}
          fill={`${s.color}26`} stroke={s.color} strokeWidth="2" strokeLinejoin="round" />
      ))}
      {DIAL_META.map((m, i) => {
        const angle = (Math.PI * 2 * i) / DIAL_META.length - Math.PI / 2;
        const x = cx + Math.cos(angle) * (r * 1.24);
        const y = cy + Math.sin(angle) * (r * 1.22);
        const v = series.length === 1 ? series[0].dials[m.key] : null;
        return (
          <g key={m.key}>
            <text x={x} y={y} textAnchor="middle" fontSize={size * 0.037} fontWeight="800" fill="#9B8A72">
              {m.label.toUpperCase()}
            </text>
            {showValues && series.length === 1 && (
              <text x={x} y={y + size * 0.05} textAnchor="middle" fontSize={size * 0.05} fontWeight="900"
                fill={v === null || v === undefined ? '#C9BFAE' : '#1E120B'}>
                {v === null || v === undefined ? '—' : v}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
