// "Born on this day" — fetches Wikipedia's free, no-key onthisday API and
// returns a small list of notable people born on the same date. Cached in
// localStorage per (month, day) for the current calendar day so the same
// kid's profile doesn't hit Wikipedia on every load.
//
// API: https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/births/MM/DD

export interface BornOnThisDayPerson {
  name: string;
  year: number;
  description: string;
  thumbnailUrl?: string;
  pageUrl: string;
}

const CACHE_PREFIX = 'kaya.otd.';

export async function bornOnThisDay(
  monthMM: string,
  dayDD: string,
  max = 5,
): Promise<BornOnThisDayPerson[]> {
  if (!/^\d{2}$/.test(monthMM) || !/^\d{2}$/.test(dayDD)) return [];

  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${CACHE_PREFIX}${monthMM}-${dayDD}.${today}`;

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

  const items: BornOnThisDayPerson[] = [];
  for (const entry of (raw?.births || []) as any[]) {
    if (items.length >= 30) break; // cap before filtering
    const page = entry?.pages?.[0];
    if (!page) continue;
    // Soft filter: prefer modern, image-bearing, non-tragic entries.
    const description: string = page.description || page.extract || '';
    if (/\b(killed|murdered|executed|criminal|tyrant|dictator|terrorist)\b/i.test(description)) continue;
    items.push({
      name: page.normalizedtitle || page.title?.replace(/_/g, ' ') || 'Unknown',
      year: entry.year || 0,
      description: description.slice(0, 120),
      thumbnailUrl: page.thumbnail?.source,
      pageUrl: page.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title || '')}`,
    });
  }

  // Prefer entries with a thumbnail, then more recent births (more relatable).
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
