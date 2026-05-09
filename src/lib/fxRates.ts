// Live exchange-rate fetcher. Free, no-key:
//   GET https://open.er-api.com/v6/latest/{BASE}
//   { result: 'success', rates: { USD: 1, EUR: 0.92, TZS: 2650, … } }
//
// Cached in localStorage per (base, ISO date) so we hit the network at
// most once per day per base. Used by /parent/hive-deposit to suggest a
// source→default rate when the parent flips on the FX toggle, and as a
// hint under Lever B in /parent/rates.
//
// Failure modes:
//   - Network blocked → returns null. UI just hides the suggestion.
//   - Rate missing for a currency → suggestedRate() returns null.
//   - User offline → cache from earlier in the day is still valid.

export interface FxRates {
  base: string;
  date: string;             // ISO yyyy-mm-dd
  fetchedAt: number;        // epoch ms — useful when surfacing "as of"
  rates: Record<string, number>;
}

const CACHE_KEY_PREFIX = 'kaya.fx.';

export async function fetchFxRates(base = 'USD'): Promise<FxRates | null> {
  const today = new Date().toISOString().slice(0, 10);
  const cacheKey = `${CACHE_KEY_PREFIX}${base}.${today}`;
  if (typeof window !== 'undefined') {
    try {
      const cached = window.localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as FxRates;
    } catch {}
  }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
    if (!res.ok) return null;
    const raw = await res.json();
    if (raw?.result !== 'success' || !raw.rates) return null;
    const out: FxRates = {
      base,
      date: today,
      fetchedAt: Date.now(),
      rates: raw.rates,
    };
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(cacheKey, JSON.stringify(out)); } catch {}
    }
    return out;
  } catch {
    return null;
  }
}

/** "1 source = X target" at today's rate. Null if either side is missing
 *  from the rate table. Identity returns 1. */
export function suggestedRate(rates: FxRates | null, source: string, target: string): number | null {
  if (!rates) return null;
  if (source === target) return 1;
  // Cross-rate via the fetched base: 1 source = (rates[target] / rates[source]) target.
  const fromBase = rates.rates[source];
  const toBase = rates.rates[target];
  if (typeof fromBase !== 'number' || typeof toBase !== 'number' || fromBase === 0) return null;
  return toBase / fromBase;
}

/** Compact rate for display: 4 sig figs when below 1, otherwise 2 decimals. */
export function formatRate(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 0.01) return n.toPrecision(3);
  if (n < 1) return n.toFixed(4);
  if (n < 100) return n.toFixed(2);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.round(n));
}
