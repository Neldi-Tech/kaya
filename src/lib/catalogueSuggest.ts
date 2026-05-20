// Master Catalogue v2 · Phase 2 — AI country enrichment (client).
//
// For catalogue items missing a local name / brands for the family's
// country, ask the AI once (POST /api/catalogue-suggest) and merge the
// result into the in-memory catalogue, tagged source:'ai'. Curated
// data always wins; AI only fills gaps. No-ops gracefully when the
// API key isn't configured.

export interface CatalogueSuggestion {
  localName?: string;
  brands?: string[];
}

/** Country picks for the locale switcher. Code = ISO alpha-2. */
export const COUNTRY_PICKS: { code: string; label: string }[] = [
  { code: 'TZ', label: '🇹🇿 Tanzania' },
  { code: 'KE', label: '🇰🇪 Kenya' },
  { code: 'UG', label: '🇺🇬 Uganda' },
  { code: 'NG', label: '🇳🇬 Nigeria' },
  { code: 'ZA', label: '🇿🇦 South Africa' },
  { code: 'IN', label: '🇮🇳 India' },
  { code: 'AE', label: '🇦🇪 UAE' },
  { code: 'GB', label: '🇬🇧 UK' },
  { code: 'US', label: '🇺🇸 USA' },
];

export function countryLabel(code: string): string {
  return COUNTRY_PICKS.find((c) => c.code === code)?.label ?? code;
}

/** Ask the AI for local names + brands for a batch of items in a given
 *  country + language. Returns a map keyed by item id, or null when the
 *  route is unavailable / unconfigured (caller falls back to curated /
 *  English-only). Fire-and-forget safe. */
export async function suggestCatalogueLocales(
  items: { id: string; globalName: string }[],
  country: string,
  language: string,
): Promise<Record<string, CatalogueSuggestion> | null> {
  if (typeof window === 'undefined') return null;
  if (items.length === 0) return null;
  try {
    const res = await fetch('/api/catalogue-suggest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ items, country, language }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.skipped) return null;
    return (data?.suggestions ?? null) as Record<string, CatalogueSuggestion> | null;
  } catch {
    return null;
  }
}
