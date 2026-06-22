// Time-range model for the Finances + Dashboard surfaces (2026-06-15).
//
// Budget data in Kaya is month-bucketed (`budgetMonthKeyFor` resolves a
// closed request to a single 'YYYY-MM'; ledger entries carry a day but
// roll up by month). So every range — month, quarter, year, or a custom
// date span — reduces to a SET of month keys. Membership tests stay a
// simple `set.has(monthKeyFor(entry))`, identical to the old single-month
// filter, which keeps the roll-ups honest and cheap.

export type TimeRangeKind = 'month' | 'quarter' | 'half' | 'year' | 'custom';

export interface TimeRange {
  kind: TimeRangeKind;
  year: number;
  /** 0-11, for kind === 'month'. */
  month?: number;
  /** 1-4, for kind === 'quarter'. */
  quarter?: number;
  /** 1-2, for kind === 'half' (H1 = Jan–Jun, H2 = Jul–Dec). */
  half?: number;
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
    case 'half': {
      const start = ((r.half ?? 1) - 1) * 6;
      return Array.from({ length: 6 }, (_, i) => monthKeyOf(r.year, start + i));
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

/** The last 'YYYY-MM' the range covers (its most recent month). */
export function rangeEndMonthKey(r: TimeRange): string {
  const keys = monthKeysInRange(r);
  if (keys.length) return keys[keys.length - 1];
  return monthKeyOfDate(new Date());
}

/** N consecutive month keys ending at (and including) `endKey`, oldest first.
 *  Used by the Trends window, which is inherently multi-month. */
export function lastNMonthKeys(endKey: string, n: number): string[] {
  const [ey, em] = endKey.split('-').map(Number);
  const out: string[] = [];
  let y = ey, m = em; // m is 1-based
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${pad2(m)}`);
    m -= 1; if (m < 1) { m = 12; y -= 1; }
  }
  return out;
}

/** Short month label for an axis tick, e.g. "Jun" or "Jun '26" when spanning years. */
export function shortMonthLabel(key: string, withYear = false): string {
  const [y, m] = key.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return withYear
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
    : d.toLocaleDateString('en-US', { month: 'short' });
}

/** Headline label, e.g. "June 2026", "Q2 2026", "2026", "Apr–Jun 2026". */
export function rangeLabel(r: TimeRange): string {
  switch (r.kind) {
    case 'month':
      return new Date(r.year, r.month ?? 0, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    case 'quarter':
      return `Q${r.quarter ?? 1} ${r.year}`;
    case 'half':
      return `H${r.half ?? 1} ${r.year}`;
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

/** Fraction (0-1) of the range that has elapsed as of `now`. Drives the
 *  Budget Health pace calc — a month seen on day 15/30 is ~0.5 elapsed. */
export function elapsedFraction(r: TimeRange, now: Date = new Date()): number {
  const keys = monthKeysInRange(r);
  if (!keys.length) return 1;
  const [sy, sm] = keys[0].split('-').map(Number);
  const [ey, em] = keys[keys.length - 1].split('-').map(Number);
  const start = new Date(sy, sm - 1, 1).getTime();
  const end = new Date(ey, em, 1).getTime(); // first instant after the last month
  const total = end - start;
  const el = now.getTime() - start;
  if (total <= 0) return 1;
  if (el <= 0) return 0.02;
  if (el >= total) return 1;
  return el / total;
}

/** Plain-language period word for subtitles ("this month" / "this quarter"…). */
export function rangePeriodWord(r: TimeRange): string {
  switch (r.kind) {
    case 'month': return 'this month';
    case 'quarter': return 'this quarter';
    case 'half': return 'this half';
    case 'year': return 'this year';
    case 'custom': return 'in this range';
  }
}

/** Compact query string for threading the selected range through drill-down
 *  links (Overview → breakdown / bucket detail → costs). */
export function rangeToQuery(r: TimeRange): string {
  const p = new URLSearchParams();
  p.set('k', r.kind);
  p.set('y', String(r.year));
  if (r.kind === 'month' && r.month != null) p.set('m', String(r.month));
  if (r.kind === 'quarter' && r.quarter != null) p.set('q', String(r.quarter));
  if (r.kind === 'half' && r.half != null) p.set('h', String(r.half));
  if (r.kind === 'custom') { if (r.start) p.set('s', r.start); if (r.end) p.set('e', r.end); }
  return p.toString();
}

/** Parse a range from drill-down query params; falls back to the current month
 *  so a directly-opened drill-down page still works. */
export function rangeFromQuery(sp: { get(key: string): string | null }): TimeRange {
  const k = sp.get('k') as TimeRangeKind | null;
  const y = Number(sp.get('y'));
  if (!k || !Number.isFinite(y) || y < 2000) return currentMonthRange();
  switch (k) {
    case 'month': return { kind: 'month', year: y, month: Number(sp.get('m')) || 0 };
    case 'quarter': return { kind: 'quarter', year: y, quarter: Number(sp.get('q')) || 1 };
    case 'half': return { kind: 'half', year: y, half: Number(sp.get('h')) || 1 };
    case 'year': return { kind: 'year', year: y };
    case 'custom': return { kind: 'custom', year: y, start: sp.get('s') || undefined, end: sp.get('e') || undefined };
    default: return currentMonthRange();
  }
}
