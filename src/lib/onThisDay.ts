// "On this day" lookups — fetches Wikipedia's free, no-key onthisday API and
// returns small lists of (a) notable people born on the same date and
// (b) major historical events that happened on that date. Cached in
// localStorage per (month, day) for the current calendar day so the same
// profile doesn't hit Wikipedia on every load.
//
// API:
//   births: https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/MM/DD
//   events: https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/MM/DD

import type { Gender } from './firestore';

export interface BornOnThisDayPerson {
  name: string;
  year: number;
  description: string;
  thumbnailUrl?: string;
  pageUrl: string;
}

export interface OnThisDayEvent {
  year: number;
  text: string;
  thumbnailUrl?: string;
  pageUrl?: string;
}

const CACHE_PREFIX = 'kaya.otd.';
const EVENTS_CACHE_PREFIX = 'kaya.otd.events.';

// Heuristic gender classifier from the short Wikipedia bio. Wikipedia exposes
// gender in Wikidata, but that's an extra round-trip; pronouns in the bio are
// a "good enough" filter for an opt-in family suggestion.
function inferGender(description: string): Gender {
  if (!description) return 'unspecified';
  // Word-boundary match so "she" doesn't trigger on "Sheffield".
  const she = /\b(she|her|herself|hers|actress|queen|princess|empress|duchess|countess)\b/i.test(description);
  const he = /\b(he|him|himself|his|king|prince|emperor|duke|count)\b/i.test(description);
  if (she && !he) return 'female';
  if (he && !she) return 'male';
  return 'unspecified';
}

export async function bornOnThisDay(
  monthMM: string,
  dayDD: string,
  max = 5,
  preferGender: Gender = 'unspecified',
): Promise<BornOnThisDayPerson[]> {
  if (!/^\d{2}$/.test(monthMM) || !/^\d{2}$/.test(dayDD)) return [];

  const today = new Date().toISOString().slice(0, 10);
  // Cache key includes the gender preference so a kid switch doesn't return
  // stale results from a sibling's profile.
  const cacheKey = `${CACHE_PREFIX}${monthMM}-${dayDD}.${preferGender}.${today}`;

  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return (JSON.parse(cached) as BornOnThisDayPerson[]).slice(0, max);
    } catch {}
  }

  let raw: any;
  try {
    const res = await fetch(
      `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/${monthMM}/${dayDD}`,
      { headers: { 'Api-User-Agent': 'kaya/1.0 (https://www.ourkaya.com)' } },
    );
    if (!res.ok) return [];
    raw = await res.json();
  } catch {
    return [];
  }

  type Scored = BornOnThisDayPerson & { matchesGender: boolean };
  const items: Scored[] = [];
  for (const entry of (raw?.births || []) as any[]) {
    if (items.length >= 60) break; // cap before filtering
    const page = entry?.pages?.[0];
    if (!page) continue;
    const description: string = page.description || page.extract || '';
    if (/\b(killed|murdered|executed|criminal|tyrant|dictator|terrorist)\b/i.test(description)) continue;
    const detected = inferGender(description);
    const matchesGender =
      preferGender === 'unspecified' || preferGender === 'other'
        ? true
        : detected === preferGender;
    items.push({
      name: page.normalizedtitle || page.title?.replace(/_/g, ' ') || 'Unknown',
      year: entry.year || 0,
      description: description.slice(0, 120),
      thumbnailUrl: page.thumbnail?.source,
      pageUrl: page.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title || '')}`,
      matchesGender,
    });
  }

  // Sort: gender match first, then thumbnail-bearing, then most recent.
  items.sort((a, b) => {
    if (a.matchesGender !== b.matchesGender) return a.matchesGender ? -1 : 1;
    const aHasImg = a.thumbnailUrl ? 1 : 0;
    const bHasImg = b.thumbnailUrl ? 1 : 0;
    if (aHasImg !== bHasImg) return bHasImg - aHasImg;
    return (b.year || 0) - (a.year || 0);
  });

  // Strip the helper field before returning.
  const top: BornOnThisDayPerson[] = items.slice(0, max).map(({ matchesGender, ...rest }) => rest);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(top));
    } catch {}
  }

  return top;
}

export async function eventsOnThisDay(
  monthMM: string,
  dayDD: string,
  max = 5,
): Promise<OnThisDayEvent[]> {
  if (!/^\d{2}$/.test(monthMM) || !/^\d{2}$/.test(dayDD)) return [];

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${EVENTS_CACHE_PREFIX}${monthMM}-${dayDD}.${today}`;

  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return (JSON.parse(cached) as OnThisDayEvent[]).slice(0, max);
    } catch {}
  }

  let raw: any;
  try {
    const res = await fetch(
      `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/${monthMM}/${dayDD}`,
      { headers: { 'Api-User-Agent': 'kaya/1.0 (https://www.ourkaya.com)' } },
    );
    if (!res.ok) return [];
    raw = await res.json();
  } catch {
    return [];
  }

  const items: OnThisDayEvent[] = [];
  for (const entry of (raw?.events || []) as any[]) {
    const text: string = entry?.text || '';
    if (!text) continue;
    // Soft filter: avoid the bleakest entries on a kid's profile.
    if (/\b(massacre|genocide|atrocit|raped?|brothel|terrorist)\b/i.test(text)) continue;
    const page = entry?.pages?.[0];
    items.push({
      year: entry.year || 0,
      text: text.slice(0, 240),
      thumbnailUrl: page?.thumbnail?.source,
      pageUrl: page?.content_urls?.desktop?.page,
    });
  }

  // Prefer entries with thumbnails, then more recent (more relatable).
  items.sort((a, b) => {
    const aHasImg = a.thumbnailUrl ? 1 : 0;
    const bHasImg = b.thumbnailUrl ? 1 : 0;
    if (aHasImg !== bHasImg) return bHasImg - aHasImg;
    return (b.year || 0) - (a.year || 0);
  });

  const top = items.slice(0, max);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(top));
    } catch {}
  }

  return top;
}
