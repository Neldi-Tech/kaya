// Time-range model for the Finances + Dashboard surfaces (2026-06-15).
//
// Budget data in Kaya is month-bucketed (`budgetMonthKeyFor` resolves a
// closed request to a single 'YYYY-MM'; ledger entries carry a day but
// roll up by month). So every range — month, quarter, year, or a custom
// date span — reduces to a SET of month keys. Membership tests stay a
// simple `set.has(monthKeyFor(entry))`, identical to the old single-month
// filter, which keeps the roll-ups honest and cheap.

export type TimeRangeKind = 'month' | 'quarter' | 'year' | 'custom';

export interface TimeRange {
  kind: TimeRangeKind;
  year: number;
  /** 0-11, for kind === 'month'. */
  month?: number;
  /** 1-4, for kind === 'quarter'. */
  quarter?: number;
  /** ISO 'YYYY-MM-DD', for kind === 'custom'. */
  start?: string;
  /** ISO 'YYYY-MM-DD', for kind === 'custom'. */
  end?: string;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
/** 'YYYY-MM' from a year + 0-based month. */
export const monthKeyOf = (y: number, m0: number) => `${y}-${pad2(m0 + 1)}`;
/** 'YYYY-MM' from a Date. */
export const monthKeyOfDate = (d: Date) => monthKeyOf(d.getFullYear(), d.getMonth());

/** The default view: the calendar month we're in. */
export function currentMonthRange(d: Date = new Date()): TimeRange {
  return { kind: 'month', year: d.getFullYear(), month: d.getMonth() };
}

/** Which quarter (1-4) a 0-based month falls in. */
export const quarterOfMonth = (m0: number) => (Math.floor(m0 / 3) + 1) as 1 | 2 | 3 | 4;

/** The set of 'YYYY-MM' month keys a range spans (inclusive). */
export function monthKeysInRange(r: TimeRange): string[] {
  switch (r.kind) {
    case 'month':
      return [monthKeyOf(r.year, r.month ?? 0)];
    case 'quarter': {
      const start = ((r.quarter ?? 1) - 1) * 3;
      return [0, 1, 2].map((i) => monthKeyOf(r.year, start + i));
    }
    case 'year':
      return Array.from({ length: 12 }, (_, i) => monthKeyOf(r.year, i));
    case 'custom': {
      if (!r.start || !r.end) return [];
      const [sy, sm] = r.start.split('-').map(Number);
      const [ey, em] = r.end.split('-').map(Number);
      if (!sy || !sm || !ey || !em) return [];
      const keys: string[] = [];
      let y = sy, m = sm; // m is 1-based here
      // Guard against a reversed range and runaway loops.
      let guard = 0;
      while ((y < ey || (y === ey && m <= em)) && guard++ < 240) {
        keys.push(`${y}-${pad2(m)}`);
        m += 1; if (m > 12) { m = 1; y += 1; }
      }
      return keys;
    }
  }
}

/** Number of months the range covers (≥1 for valid ranges). */
export const monthSpan = (r: TimeRange) => monthKeysInRange(r).length;

/** Headline label, e.g. "June 2026", "Q2 2026", "2026", "Apr–Jun 2026". */
export function rangeLabel(r: TimeRange): string {
  switch (r.kind) {
    case 'month':
      return new Date(r.year, r.month ?? 0, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'quarter':
      return `Q${r.quarter ?? 1} ${r.year}`;
    case 'year':
      return `${r.year}`;
    case 'custom': {
      const keys = monthKeysInRange(r);
      if (keys.length === 0) return 'Custom range';
      const first = keys[0], last = keys[keys.length - 1];
      const fmt = (k: string) => {
        const [y, m] = k.split('-').map(Number);
        return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      };
      return first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}`;
    }
  }
}

/** Plain-language period word for subtitles ("this month" / "this quarter"…). */
export function rangePeriodWord(r: TimeRange): string {
  switch (r.kind) {
    case 'month': return 'this month';
    case 'quarter': return 'this quarter';
    case 'year': return 'this year';
    case 'custom': return 'in this range';
  }
}
