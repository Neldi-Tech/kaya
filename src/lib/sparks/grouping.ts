// Kaya Sparks · render-side helpers for the gallery surfaces.
//
// • groupByMonth — bucket items by their YYYY-MM date prefix, return
//   ordered groups (newest month first).
// • monthLabel — render "August 2024" from a YYYY-MM key.
// • pickDailyHighlights — deterministic daily rotation of N items
//   from the area feed so the highlights rail stays fresh without
//   manual parent curation. Same seed → same picks across all family
//   members; tomorrow's seed differs, so tomorrow's picks differ.
// • HIGHLIGHTS_CAP — UI cap on how many daily picks we render.

import type { SparksItem } from './schema';

export const HIGHLIGHTS_CAP = 5;

/** Today's local-time YYYY-MM-DD — used as part of the daily seed.
 *  Local because we want the kid's day boundary, not UTC. */
export function todayLocalYmd(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** mulberry32 PRNG seeded by a string. Same string → same sequence. */
function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick `max` items from `items` deterministically per (kid, area, day).
 *  Items without a photo land at the back of the pool so the rail
 *  visually leads with the strongest captures, but they're still
 *  eligible. Returns an empty array when there are no items.
 *
 *  The pick is stable across renders for the same day — opening the
 *  page twice shows the same picks; opening tomorrow refreshes them. */
export function pickDailyHighlights(
  items: SparksItem[],
  seed: { kidId: string; area: string; ymd?: string },
  max: number = HIGHLIGHTS_CAP,
): SparksItem[] {
  if (items.length === 0 || max <= 0) return [];
  const ymd = seed.ymd ?? todayLocalYmd();
  const rand = seededRandom(`${ymd}|${seed.kidId}|${seed.area}`);

  // Photographed items first, photo-less second — preserves a punchy
  // rail while still surfacing description-only entries over time.
  const withPhoto = items.filter((i) => (i.photo_urls?.length ?? 0) > 0);
  const withoutPhoto = items.filter((i) => (i.photo_urls?.length ?? 0) === 0);
  const pool = [...withPhoto, ...withoutPhoto];

  // Fisher-Yates partial shuffle — produces the top-N picks without
  // shuffling the entire array.
  const arr = pool.slice();
  const n = Math.min(max, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (arr.length - i));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

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
