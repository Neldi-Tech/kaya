// Kaya Sparks · dashboard aggregations.
//
// Pure functions on top of the items + ratings streams already
// subscribed by the parent dashboard. Date-window filter, per-week
// bucketing, per-area aggregation, simple streak detection.
//
// Slice 5 (2026-05-27) — Claude-powered AI insights is a separate
// route; everything in here is deterministic + local-only so the chart
// surfaces stay snappy and offline-friendly.

import {
  aggregateRatings,
  type RatingAggregate,
} from './firestore';
import {
  SPARKS_AREA_META,
  type SparksArea,
  type SparksItem,
  type SparksItemArea,
  type SparksRating,
} from './schema';

// ── Date utilities ───────────────────────────────────────────────────

export type SparksFilter =
  | 'week'
  | 'month'
  | 'term'
  | 'year'
  | 'all'
  | { customDays: number };

export const FILTER_LABELS: Record<Exclude<SparksFilter, object>, string> = {
  week:  'Week',
  month: 'Month',
  term:  'Term',
  year:  'Year',
  all:   'All-time',
};

/** Convert a filter into a millisecond inclusive lower bound. `null`
 *  means "no lower bound" (all-time). All boundaries are computed in
 *  LOCAL time per the Kaya date-format rule. */
export function filterLowerBound(filter: SparksFilter, now: Date = new Date()): number | null {
  if (filter === 'all') return null;
  const ms = now.getTime();
  if (filter === 'week')  return ms - 7  * 24 * 3600_000;
  if (filter === 'month') return ms - 30 * 24 * 3600_000;
  if (filter === 'term')  return ms - 90 * 24 * 3600_000; // school terms ~ 12 weeks
  if (filter === 'year')  return ms - 365 * 24 * 3600_000;
  return ms - filter.customDays * 24 * 3600_000;
}

/** Parse a YYYY-MM-DD string as a local-midnight Date. Robust to
 *  partial/invalid input (returns NaN-bearing Date — caller filters). */
export function ymdToDate(ymd: string): Date {
  if (!ymd || ymd.length < 10) return new Date(NaN);
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

/** YYYY-MM-DD in local time for a Date. */
export function dateToYmd(d: Date): string {
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Filtering ────────────────────────────────────────────────────────

/** Filter a stream by `.date` (YYYY-MM-DD) within the active window. */
export function filterByDate<T extends { date?: string }>(
  rows: T[],
  filter: SparksFilter,
  now: Date = new Date(),
): T[] {
  const lo = filterLowerBound(filter, now);
  if (lo === null) return rows;
  return rows.filter((r) => {
    const ts = ymdToDate(r.date ?? '').getTime();
    return Number.isFinite(ts) && ts >= lo;
  });
}

// ── KPI roll-up ──────────────────────────────────────────────────────

export interface SparksKpis {
  totalItems: number;
  totalRatings: number;
  ratingAgg: RatingAggregate;
  /** Top area by item count in the active window. */
  topArea: SparksItemArea | null;
  /** Current ⭐ streak in days — consecutive days ending today with at
   *  least one rating ≥ 4 stars. Falls back to 0 when there's no
   *  star data. */
  starStreakDays: number;
}

export function computeKpis(
  items: SparksItem[],
  ratings: SparksRating[],
): SparksKpis {
  const counts: Record<SparksItemArea, number> = {
    school_project: 0, home_project: 0, achievement: 0, sports_subscription: 0, revision: 0,
  };
  for (const it of items) counts[it.area]++;

  let topArea: SparksItemArea | null = null;
  let topN = 0;
  (Object.entries(counts) as [SparksItemArea, number][]).forEach(([k, n]) => {
    if (n > topN) { topN = n; topArea = k; }
  });

  return {
    totalItems: items.length,
    totalRatings: ratings.length,
    ratingAgg: aggregateRatings(ratings),
    topArea,
    starStreakDays: computeStarStreak(ratings),
  };
}

function computeStarStreak(ratings: SparksRating[]): number {
  // Group ratings by date (YYYY-MM-DD), then walk back from today
  // counting consecutive days that had at least one ⭐ ≥ 4.
  const goodByDate = new Set<string>();
  for (const r of ratings) {
    if (typeof r.stars === 'number' && r.stars >= 4 && r.date) goodByDate.add(r.date);
  }
  let streak = 0;
  const cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  while (goodByDate.has(dateToYmd(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// ── 10-week trend buckets ────────────────────────────────────────────

export interface TrendBucket {
  /** ISO Monday of the week (YYYY-MM-DD). */
  weekStart: string;
  /** "May 19" — short display label for the X axis. */
  label: string;
  count: number;            // total items dated in this week
  avgStars: number | null;  // null when no star ratings in week
  avgPercent: number | null;
}

/** Bucket items + ratings into the last `weeks` Monday-anchored weeks
 *  (default 10). Most-recent week is the LAST entry. */
export function weeklyTrend(
  items: SparksItem[],
  ratings: SparksRating[],
  weeks = 10,
  now: Date = new Date(),
): TrendBucket[] {
  // Anchor on the Monday of the current week.
  const startOfThisWeek = startOfWeek(now);
  const buckets: TrendBucket[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(startOfThisWeek);
    ws.setDate(ws.getDate() - i * 7);
    buckets.push({
      weekStart: dateToYmd(ws),
      label: ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      count: 0,
      avgStars: null,
      avgPercent: null,
    });
  }

  const indexOfWeek = (ymd: string): number => {
    const d = ymdToDate(ymd);
    if (Number.isNaN(d.getTime())) return -1;
    const ws = startOfWeek(d);
    const target = dateToYmd(ws);
    return buckets.findIndex((b) => b.weekStart === target);
  };

  for (const it of items) {
    const idx = indexOfWeek(it.date);
    if (idx >= 0) buckets[idx].count++;
  }

  // Aggregate ratings per week — store partial sums then divide.
  const perWeek: Array<{ s: number; sn: number; p: number; pn: number }> =
    buckets.map(() => ({ s: 0, sn: 0, p: 0, pn: 0 }));
  for (const r of ratings) {
    const idx = indexOfWeek(r.date);
    if (idx < 0) continue;
    if (typeof r.stars === 'number')   { perWeek[idx].s += r.stars;   perWeek[idx].sn++; }
    if (typeof r.percent === 'number') { perWeek[idx].p += r.percent; perWeek[idx].pn++; }
  }
  buckets.forEach((b, i) => {
    const w = perWeek[i];
    b.avgStars   = w.sn > 0 ? +(w.s / w.sn).toFixed(2) : null;
    b.avgPercent = w.pn > 0 ? Math.round(w.p / w.pn)   : null;
  });
  return buckets;
}

function startOfWeek(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const day = r.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day; // ISO week starts Monday
  r.setDate(r.getDate() + diff);
  return r;
}

// ── Category breakdown ───────────────────────────────────────────────

export interface CategoryBreakdownRow {
  area: SparksArea;
  label: string;
  emoji: string;
  count: number;
  avgStars: number | null;
  avgPercent: number | null;
  /** Coral / Yellow / Green / Purple / Mint — accent matches the
   *  mockup's tile + area-card palette. */
  accent: string;
}

const AREA_ACCENT: Record<SparksArea, string> = {
  school_project:      '#FF6B6B',
  home_project:        '#FFD93D',
  achievement:         '#6BCB77',
  academic:            '#A66CFF',
  sports_subscription: '#4ECDC4',
  revision:            '#5A3CB8',
};

export function categoryBreakdown(
  items: SparksItem[],
  ratings: SparksRating[],
  /** Number of academic records (passed in from the dashboard page
   *  since it's tracked separately). Used as the count for the
   *  'academic' row. */
  academicCount: number,
): CategoryBreakdownRow[] {
  // Pre-index ratings by item_id so we can fold them into per-area
  // aggregates without re-scanning the full ratings list per area.
  const byItem = new Map<string, SparksRating[]>();
  for (const r of ratings) {
    if (!r.item_id) continue;
    const arr = byItem.get(r.item_id);
    if (arr) arr.push(r); else byItem.set(r.item_id, [r]);
  }

  type Acc = { count: number; stars: number; sn: number; pct: number; pn: number };
  const acc: Record<SparksArea, Acc> = {
    school_project:      { count: 0, stars: 0, sn: 0, pct: 0, pn: 0 },
    home_project:        { count: 0, stars: 0, sn: 0, pct: 0, pn: 0 },
    achievement:         { count: 0, stars: 0, sn: 0, pct: 0, pn: 0 },
    academic:            { count: academicCount, stars: 0, sn: 0, pct: 0, pn: 0 },
    sports_subscription: { count: 0, stars: 0, sn: 0, pct: 0, pn: 0 },
    revision:            { count: 0, stars: 0, sn: 0, pct: 0, pn: 0 },
  };

  for (const it of items) {
    acc[it.area].count++;
    for (const r of byItem.get(it.id) ?? []) {
      if (typeof r.stars === 'number') { acc[it.area].stars += r.stars; acc[it.area].sn++; }
      if (typeof r.percent === 'number') { acc[it.area].pct += r.percent; acc[it.area].pn++; }
    }
  }

  return (Object.keys(SPARKS_AREA_META) as SparksArea[]).map((area) => {
    const a = acc[area];
    const meta = SPARKS_AREA_META[area];
    return {
      area,
      label: meta.label,
      emoji: meta.emoji,
      count: a.count,
      avgStars:   a.sn > 0 ? +(a.stars / a.sn).toFixed(1) : null,
      avgPercent: a.pn > 0 ? Math.round(a.pct / a.pn)     : null,
      accent: AREA_ACCENT[area],
    };
  });
}
