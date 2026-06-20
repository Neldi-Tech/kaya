'use client';

// Time-range filter for Finances + Dashboard (2026-06-15).
//
// Controlled component: parent owns a TimeRange and we call onChange.
// Default is the current month; parents can switch to a Quarter (Q1-Q4),
// a full Year, or a Custom date span. Mirrors the approved design preview,
// rendered in the app's own tokens (pantry-leaf / hive-navy / hive-honey).

import {
  type TimeRange, type TimeRangeKind,
  rangeLabel, monthKeyOf, quarterOfMonth,
} from '@/lib/timeRange';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const KINDS: { k: TimeRangeKind; label: string }[] = [
  { k: 'month', label: 'This month' },
  { k: 'quarter', label: 'Quarter' },
  { k: 'year', label: 'Year' },
  { k: 'custom', label: 'Custom range' },
];

const isoOf = (y: number, m0: number, d: number) => `${y}-${String(m0 + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export default function TimeRangeFilter({
  value, onChange, countLabel,
}: {
  value: TimeRange;
  onChange: (r: TimeRange) => void;
  /** Optional trailing note, e.g. "13 closed requests". */
  countLabel?: string;
}) {
  const now = new Date();
  const setKind = (k: TimeRangeKind) => {
    if (k === value.kind) return;
    switch (k) {
      case 'month': onChange({ kind: 'month', year: now.getFullYear(), month: now.getMonth() }); break;
      case 'quarter': onChange({ kind: 'quarter', year: now.getFullYear(), quarter: quarterOfMonth(now.getMonth()) }); break;
      case 'year': onChange({ kind: 'year', year: now.getFullYear() }); break;
      case 'custom': onChange({
        kind: 'custom',
        year: now.getFullYear(),
        start: isoOf(now.getFullYear(), now.getMonth(), 1),
        end: isoOf(now.getFullYear(), now.getMonth(), now.getDate()),
      }); break;
    }
  };

  // Month stepper (kind = month)
  const stepMonth = (delta: number) => {
    const base = new Date(value.year, value.month ?? 0, 1);
    base.setMonth(base.getMonth() + delta);
    onChange({ kind: 'month', year: base.getFullYear(), month: base.getMonth() });
  };
  // Year stepper (kind = year)
  const stepYear = (delta: number) => onChange({ ...value, kind: 'year', year: value.year + delta });

  const segBtn = (active: boolean) =>
    `font-nunito font-extrabold text-[13px] px-3.5 py-2 rounded-[11px] transition-colors ${
      active ? 'bg-hive-navy text-white shadow-sm' : 'text-hive-muted hover:text-hive-ink'
    }`;

  return (
    <div className="rounded-hive">
      {/* Primary segmented control */}
      <div className="inline-flex flex-wrap gap-1 bg-hive-paper border border-hive-line rounded-[14px] p-1">
        {KINDS.map(({ k, label }) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={segBtn(value.kind === k)}>
            {label}
          </button>
        ))}
      </div>

      {/* Sub-filter row */}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {value.kind === 'month' && (
          <>
            <div className="inline-flex items-center gap-1 bg-hive-paper border border-hive-line rounded-[12px] p-1">
              <button type="button" onClick={() => stepMonth(-1)} aria-label="Previous month"
                className="w-8 h-8 rounded-[9px] bg-pantry-leaf-soft text-pantry-leaf-dk font-black">‹</button>
              <span className="font-nunito font-black px-3 min-w-[120px] text-center text-hive-ink">
                {rangeLabel(value)}
              </span>
              <button type="button" onClick={() => stepMonth(1)} aria-label="Next month"
                className="w-8 h-8 rounded-[9px] bg-pantry-leaf-soft text-pantry-leaf-dk font-black">›</button>
            </div>
            <select
              value={`${value.year}-${value.month ?? 0}`}
              onChange={(e) => {
                const [y, m] = e.target.value.split('-').map(Number);
                onChange({ kind: 'month', year: y, month: m });
              }}
              className="bg-hive-paper border border-hive-line rounded-[11px] px-3 py-2 font-nunito font-bold text-[13px] text-hive-ink"
            >
              {[value.year, value.year - 1].flatMap((y) =>
                MONTH_NAMES.map((name, m) => (
                  <option key={`${y}-${m}`} value={`${y}-${m}`}>{name} {y}</option>
                )),
              )}
            </select>
          </>
        )}

        {value.kind === 'quarter' && (
          <>
            {[1, 2, 3, 4].map((q) => {
              const months = MONTH_NAMES.slice((q - 1) * 3, (q - 1) * 3 + 3).map((m) => m.slice(0, 3)).join('–');
              const on = (value.quarter ?? 1) === q;
              return (
                <button key={q} type="button" onClick={() => onChange({ kind: 'quarter', year: value.year, quarter: q })}
                  className={`rounded-[11px] px-3 py-2 font-nunito font-extrabold text-[12.5px] border ${
                    on ? 'bg-hive-honey border-hive-honey text-[#3a2c06]' : 'bg-hive-paper border-hive-line text-hive-ink'
                  }`}>
                  Q{q} · {months}
                </button>
              );
            })}
            <span className="text-hive-muted font-bold text-[13px]">{value.year}</span>
          </>
        )}

        {value.kind === 'year' && (
          <div className="inline-flex items-center gap-1 bg-hive-paper border border-hive-line rounded-[12px] p-1">
            <button type="button" onClick={() => stepYear(-1)} aria-label="Previous year"
              className="w-8 h-8 rounded-[9px] bg-pantry-leaf-soft text-pantry-leaf-dk font-black">‹</button>
            <span className="font-nunito font-black px-4 text-hive-ink">{value.year}</span>
            <button type="button" onClick={() => stepYear(1)} aria-label="Next year"
              className="w-8 h-8 rounded-[9px] bg-pantry-leaf-soft text-pantry-leaf-dk font-black">›</button>
          </div>
        )}

        {value.kind === 'custom' && (
          <>
            <input type="date" value={value.start ?? ''} max={value.end || undefined}
              onChange={(e) => onChange({ ...value, kind: 'custom', start: e.target.value })}
              className="bg-hive-paper border border-hive-line rounded-[11px] px-2.5 py-2 font-nunito font-bold text-[13px] text-hive-ink" />
            <span className="text-hive-muted font-bold">→</span>
            <input type="date" value={value.end ?? ''} min={value.start || undefined}
              onChange={(e) => onChange({ ...value, kind: 'custom', end: e.target.value })}
              className="bg-hive-paper border border-hive-line rounded-[11px] px-2.5 py-2 font-nunito font-bold text-[13px] text-hive-ink" />
          </>
        )}
      </div>

      <p className="mt-2 text-[12px] text-hive-muted font-bold">
        📅 Showing <span className="text-hive-ink">{rangeLabel(value)}</span>
        {countLabel ? ` · ${countLabel}` : ''}
      </p>
    </div>
  );
}
