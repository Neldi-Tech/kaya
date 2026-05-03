'use client';

// DateSelect — three small select inputs (Day / Month / Year) for entering
// dates that may be far in the past. Native <input type="date"> is fine for
// recent dates but punishes adults entering a 1970s/1980s birthday because
// the native picker requires year-by-year scrolling on most mobile OSes.
//
// Output: YYYY-MM-DD when all three parts are picked; empty string otherwise.
//
// The Day options are recomputed when month/year changes so Feb 30 is
// impossible to pick. If the existing day is no longer valid (e.g. 31 →
// Apr) we clamp it to the last valid day of the new month.

import { useMemo, useEffect } from 'react';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function daysInMonth(year: number, month: number /* 1-12 */): number {
  // Date(y, m, 0) gives the last day of (m-1) — i.e. days in month (m-1+1) = m.
  return new Date(year, month, 0).getDate();
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface DateSelectProps {
  /** Current value in YYYY-MM-DD form, or empty string. */
  value: string;
  onChange: (next: string) => void;
  minYear?: number;
  maxYear?: number;
  /** Disable years/months/days after this ISO date (inclusive of the date). */
  maxDate?: string;
  /** Disable years/months/days before this ISO date. */
  minDate?: string;
  className?: string;
  /** Hide the year picker — useful for "month + day only" privacy. */
  hideYear?: boolean;
}

export default function DateSelect({
  value,
  onChange,
  minYear,
  maxYear,
  maxDate,
  minDate,
  className = '',
  hideYear = false,
}: DateSelectProps) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '') as RegExpExecArray | null;
  const year = m ? parseInt(m[1], 10) : NaN;
  const month = m ? parseInt(m[2], 10) : NaN;
  const day = m ? parseInt(m[3], 10) : NaN;

  const now = new Date();
  const resolvedMaxYear = maxYear ?? now.getFullYear();
  const resolvedMinYear = minYear ?? 1920;

  const years = useMemo(() => {
    const list: number[] = [];
    // Most recent first so adults don't have to scroll past 100 years to find
    // their birth year — but for an anniversary picker this is also fine.
    for (let y = resolvedMaxYear; y >= resolvedMinYear; y--) list.push(y);
    return list;
  }, [resolvedMinYear, resolvedMaxYear]);

  const days = useMemo(() => {
    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      // No year/month picked yet — show 31 days; we re-clamp once we know.
      return Array.from({ length: 31 }, (_, i) => i + 1);
    }
    return Array.from({ length: daysInMonth(year, month) }, (_, i) => i + 1);
  }, [year, month]);

  // Clamp day if the month/year change made it invalid (e.g. 31 → Apr).
  useEffect(() => {
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return;
    const max = daysInMonth(year, month);
    if (day > max) {
      onChange(`${year}-${pad2(month)}-${pad2(max)}`);
    }
  }, [year, month, day, onChange]);

  const set = (parts: { year?: number; month?: number; day?: number }) => {
    const y = parts.year ?? (Number.isFinite(year) ? year : undefined);
    const mo = parts.month ?? (Number.isFinite(month) ? month : undefined);
    const d = parts.day ?? (Number.isFinite(day) ? day : undefined);
    if (y === undefined || mo === undefined || d === undefined) {
      // Build a partial value that the parent can still hold onto. We store a
      // canonical YYYY-MM-DD only when all three are present, otherwise '' so
      // the consumer's "is this set?" check still works.
      onChange('');
      return;
    }
    let safeDay = d;
    const max = daysInMonth(y, mo);
    if (safeDay > max) safeDay = max;
    let next = `${y}-${pad2(mo)}-${pad2(safeDay)}`;
    if (maxDate && next > maxDate) next = maxDate;
    if (minDate && next < minDate) next = minDate;
    onChange(next);
  };

  const selectCls = 'h-11 px-3 bg-kaya-cream rounded-kaya-sm text-sm font-semibold text-kaya-chocolate focus:outline-none focus:ring-2 focus:ring-kaya-gold/40 appearance-none border border-kaya-warm-dark min-w-0';

  return (
    <div className={`grid ${hideYear ? 'grid-cols-2' : 'grid-cols-[1fr_1.4fr_1fr]'} gap-2 ${className}`}>
      <select
        aria-label="Day"
        value={Number.isFinite(day) ? day : ''}
        onChange={(e) => set({ day: e.target.value ? parseInt(e.target.value, 10) : undefined })}
        className={selectCls}
      >
        <option value="" disabled>Day</option>
        {days.map((d) => (
          <option key={d} value={d}>{d}</option>
        ))}
      </select>
      <select
        aria-label="Month"
        value={Number.isFinite(month) ? month : ''}
        onChange={(e) => set({ month: e.target.value ? parseInt(e.target.value, 10) : undefined })}
        className={selectCls}
      >
        <option value="" disabled>Month</option>
        {MONTHS.map((label, i) => (
          <option key={label} value={i + 1}>{label}</option>
        ))}
      </select>
      {!hideYear && (
        <select
          aria-label="Year"
          value={Number.isFinite(year) ? year : ''}
          onChange={(e) => set({ year: e.target.value ? parseInt(e.target.value, 10) : undefined })}
          className={selectCls}
        >
          <option value="" disabled>Year</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      )}
    </div>
  );
}
