// Kaya Sparks · render-side helpers for the gallery surfaces.
//
// • groupByMonth — bucket items by their YYYY-MM date prefix, return
//   ordered groups (newest month first).
// • monthLabel — render "August 2024" from a YYYY-MM key.
// • HIGHLIGHTS_CAP — UI guard on how many highlights a parent can star
//   per area per kid (rules don't enforce; the toggle helper checks).

import type { SparksItem } from './schema';

export const HIGHLIGHTS_CAP = 5;

export interface MonthGroup {
  /** 'YYYY-MM' key — e.g. '2024-08'. 'undated' bucket for missing dates. */
  key: string;
  /** Pretty header label — 'August 2024' or 'Undated'. */
  label: string;
  /** Items in the bucket, sorted by full date desc. */
  items: SparksItem[];
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/** Parse a 'YYYY-MM' key to a pretty label. Returns 'Undated' for the
 *  sentinel key. Falls back to the raw key if parsing fails — never
 *  throws, since this runs every render. */
export function monthLabel(key: string): string {
  if (key === 'undated') return 'Undated';
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const year = Number(m[1]);
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return key;
  return `${MONTHS[monthIdx]} ${year}`;
}

/** Group items by month using the YYYY-MM prefix of `item.date`.
 *  Items missing a date land in the 'undated' bucket (rendered at the
 *  bottom). Within each month, sort by full date desc. Months
 *  themselves are returned newest-first; 'undated' is always last. */
export function groupByMonth(items: SparksItem[]): MonthGroup[] {
  const buckets = new Map<string, SparksItem[]>();
  for (const it of items) {
    const date = (it.date || '').trim();
    const key = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.slice(0, 7) : 'undated';
    const arr = buckets.get(key) ?? [];
    arr.push(it);
    buckets.set(key, arr);
  }
  // Sort items inside each bucket — newest date first; undated keeps insertion order.
  for (const [key, arr] of buckets) {
    if (key === 'undated') continue;
    arr.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  }
  // Sort the bucket keys — month keys descending, 'undated' last.
  const keys = Array.from(buckets.keys()).sort((a, b) => {
    if (a === 'undated') return 1;
    if (b === 'undated') return -1;
    return b.localeCompare(a);
  });
  return keys.map((k) => ({ key: k, label: monthLabel(k), items: buckets.get(k)! }));
}

/** Which months should start expanded? The two most recent month
 *  buckets (excluding 'undated'). */
export function defaultOpenMonths(groups: MonthGroup[]): Set<string> {
  const opens = new Set<string>();
  let added = 0;
  for (const g of groups) {
    if (added >= 2) break;
    if (g.key === 'undated') continue;
    opens.add(g.key);
    added++;
  }
  return opens;
}
