// "On this day" lookups — fetches Wikipedia's free, no-key onthisday API and
// returns small lists of (a) notable people born on the same date and
// (b) inspiring innovations / breakthroughs that happened on that date.
//
// For events we prefer Wikipedia's `selected` endpoint (editorially curated
// "most notable" entries for the day), then layer a strong
// inspiring/innovations filter, then prepend a small hand-curated overlay
// (`innovationsOnThisDay`) that guarantees a kid-friendly entry on the
// most famous dates regardless of what the live API returns.
//
// All results cached in localStorage per (month, day) for the current
// calendar day so the same profile doesn't hit Wikipedia on every load.
//
// API:
//   births:   https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/MM/DD
//   selected: https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/MM/DD
//   events:   https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/events/MM/DD

import type { Gender } from './firestore';
import {
  curatedFor, CATEGORY_ICON, CuratedInnovation,
} from './innovationsOnThisDay';

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

// ── Inspiring / innovations filter ───────────────────────────────
// Skip anything that matches the negative regex (war, disasters, deaths).
// Boost entries that match the positive regex (firsts, discoveries,
// peace milestones, achievements). Most "selected" entries pass; we just
// reorder to put the inspiring ones on top.
const NEGATIVE_RX = new RegExp(
  '\\b(' + [
    'war', 'wars', 'battle', 'battles', 'killed', 'kills', 'murder', 'murdered',
    'massacre', 'massacred', 'genocide', 'atrocit', 'rape', 'raped', 'brothel',
    'terror', 'terrorism', 'terrorist', 'attack', 'attacked', 'invad', 'invasion',
    'bomb', 'bombed', 'bombing', 'bomber', 'destroy', 'destruction', 'destroyed',
    'crash', 'crashed', 'sank', 'sunk', 'shipwreck', 'fire destroyed',
    'riot', 'rioted', 'revolt', 'revolted', 'coup', 'overthrew', 'overthrow',
    'dictator', 'tyrant', 'holocaust', 'concentration camp', 'slav', 'slave', 'slaves', 'slavery',
    'plague', 'epidemic', 'pandemic', 'outbreak', 'cholera', 'typhoid', 'smallpox',
    'earthquake', 'tsunami', 'hurricane', 'tornado', 'flood', 'famine', 'starv',
    'disaster', 'catastroph', 'apocalyp',
    'execut', 'executed', 'died', 'dies', 'deaths', 'fatal', 'tragic', 'tragedy',
    'kidnap', 'hijack', 'assassin', 'shot dead', 'stabbed', 'hang', 'hanged', 'hanging',
    'guillotine', 'nazi', 'fascist', 'gulag', 'exiled', 'exile',
    'crisis', 'collapsed', 'collapse', 'siege',
  ].join('|') + ')\\b',
  'i',
);

const POSITIVE_RX = new RegExp(
  '\\b(' + [
    // Firsts and discoveries
    'first', 'discover', 'discovered', 'invented', 'invents', 'invention',
    'patented', 'patent', 'introduced', 'unveiled', 'released',
    // Founding / peace / civic milestones
    'founded', 'establish', 'established', 'inaugurated', 'opened', 'launched',
    'completed', 'signed (a |the )?treaty', 'ratified', 'ratifies',
    'peace', 'reconciliation', 'freed', 'abolished', 'granted',
    'broke ground', 'broke the record', 'set the record',
    // Achievements
    'awarded', 'won', 'wins', 'winner', 'champion',
    'graduated', 'crowned',
    // Space / exploration / science
    'space', 'orbit', 'orbital', 'satellite', 'rocket', 'spacecraft',
    'landed on', 'landing', 'launched into',
    'breakthrough', 'innovation', 'innovations',
    // Arts / culture
    'premiered', 'debuted', 'published', 'painted', 'composed', 'performed',
  ].join('|') + ')\\b',
  'i',
);

function isInspiring(text: string): boolean {
  if (!text) return false;
  if (NEGATIVE_RX.test(text)) return false;
  return true;
}

function inspiringScore(item: OnThisDayEvent): number {
  let score = 0;
  if (POSITIVE_RX.test(item.text)) score += 3;
  if (item.thumbnailUrl) score += 1;
  if (item.year >= 1900) score += 1;
  if (item.year >= 1970) score += 1;
  return score;
}

async function fetchOnThisDayBucket(
  bucket: 'selected' | 'events',
  monthMM: string,
  dayDD: string,
): Promise<any[]> {
  try {
    const res = await fetch(
      `https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/${bucket}/${monthMM}/${dayDD}`,
      { headers: { 'Api-User-Agent': 'kaya/1.0 (https://www.ourkaya.com)' } },
    );
    if (!res.ok) return [];
    const raw = await res.json();
    // Both endpoints return their entries under different keys.
    return (raw?.[bucket] || raw?.events || raw?.selected || []) as any[];
  } catch {
    return [];
  }
}

export async function eventsOnThisDay(
  monthMM: string,
  dayDD: string,
  max = 5,
): Promise<OnThisDayEvent[]> {
  if (!/^\d{2}$/.test(monthMM) || !/^\d{2}$/.test(dayDD)) return [];

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${EVENTS_CACHE_PREFIX}${monthMM}-${dayDD}.v2.${today}`;

  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return (JSON.parse(cached) as OnThisDayEvent[]).slice(0, max);
    } catch {}
  }

  // Layer 1 (highest priority): hand-curated innovations overlay.
  const curated: OnThisDayEvent[] = curatedFor(monthMM, dayDD).map(curatedToEvent);

  // Layer 2: Wikipedia's editorially-curated "selected" feed.
  const selected = await fetchOnThisDayBucket('selected', monthMM, dayDD);

  // Layer 3 (fallback): the broader "events" feed, if we still need more.
  const wide = selected.length < 8
    ? await fetchOnThisDayBucket('events', monthMM, dayDD)
    : [];

  // De-dupe by year+first-50-chars-of-text so the same headline doesn't show
  // up twice from two endpoints.
  const seen = new Set<string>(curated.map((e) => `${e.year}|${e.text.slice(0, 50)}`));
  const items: OnThisDayEvent[] = [];

  for (const entry of [...selected, ...wide]) {
    const text: string = entry?.text || '';
    if (!isInspiring(text)) continue;
    const key = `${entry.year || 0}|${text.slice(0, 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const page = entry?.pages?.[0];
    items.push({
      year: entry.year || 0,
      text: text.slice(0, 240),
      thumbnailUrl: page?.thumbnail?.source,
      pageUrl: page?.content_urls?.desktop?.page,
    });
  }

  // Sort Wikipedia layer by inspiring score (desc), then year (desc).
  items.sort((a, b) => {
    const sa = inspiringScore(a);
    const sb = inspiringScore(b);
    if (sa !== sb) return sb - sa;
    return (b.year || 0) - (a.year || 0);
  });

  // Curated overlay always on top, then Wikipedia entries.
  const merged = [...curated, ...items].slice(0, max);

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify(merged));
    } catch {}
  }

  return merged;
}

// Convert a curated innovation (no thumbnail) into the public event shape.
// We prepend the category icon to the text so the kid sees what kind of
// breakthrough it was at a glance — emoji renders inline next to the year.
function curatedToEvent(c: CuratedInnovation): OnThisDayEvent {
  const icon = CATEGORY_ICON[c.category] || '✨';
  return {
    year: c.year,
    text: `${icon}  ${c.text}`,
    thumbnailUrl: undefined,
    pageUrl: c.pageUrl,
  };
}
