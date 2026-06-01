// Kaya Tycoon — currency engine. Ported 1:1 from the prototype.
//
// The whole economy is authored in the BASE currency (US$ ×1) and scaled to
// the chosen currency, rounded to clean whole numbers by niceRound. Three
// choices exist, but the *local* (home) currency is only offered when the
// board country IS the home country — the explicit product rule.

import type {
  GameConfig, CountryKey, Theme, CurrencyKey, CurrencyOption, ResolvedCurrency,
} from './types';
import { PACKS } from './data';

/** Round to ~2 significant figures; the rounding factor is floored at 1 so
 *  every result is an integer — no fractions even at rate ×0.8. */
export function niceRound(v: number): number {
  if (v <= 0) return 0;
  let f = Math.pow(10, Math.floor(Math.log10(v)) - 1);
  if (f < 1) f = 1;
  return Math.round(Math.round(v / f) * f);
}

/** Convert a BASE value into the resolved currency's integer units. */
export function conv(cur: ResolvedCurrency, base: number): number {
  if (cur.kind === 'kaya') return base * 10;
  if (cur.kind === 'local') return niceRound(base * cur.rate);
  return base; // usd
}

/** Format an amount with the currency symbol + thousands separators. */
export function money(cur: ResolvedCurrency, v: number): string {
  return cur.symbol + Math.round(v).toLocaleString('en-US');
}

/** True when a country's home currency is just US$ (so "local" adds nothing). */
export function homeIsUSD(homeCountry: CountryKey): boolean {
  const c = PACKS[homeCountry].currency;
  return c.symbol === '$' && c.rate === 1;
}

const USD_OPTION: CurrencyOption = {
  key: 'usd', symbol: '$', name: 'US Dollars', blurb: 'Universal dollars — friendly numbers.',
};
const KAYA_OPTION: CurrencyOption = {
  key: 'kaya', symbol: '🪙 ', name: 'Kaya Coins', blurb: 'Branded Kaya play coins (×10).',
};

/** The currency chips to show for a given board/home selection. Local first
 *  (only on the home board), then the always-available US$ and Kaya Coins. */
export function availableCurrencies(
  theme: Theme, country: CountryKey, homeCountry: CountryKey,
): CurrencyOption[] {
  const list: CurrencyOption[] = [];
  if (theme === 'cities' && country === homeCountry && !homeIsUSD(homeCountry)) {
    const c = PACKS[homeCountry].currency;
    list.push({
      key: 'local', symbol: c.symbol, name: `${c.name} 🏠`,
      blurb: 'Your home currency — only on your home board.',
    });
  }
  list.push(USD_OPTION, KAYA_OPTION);
  return list;
}

/** Pick the first allowed currency if the requested one isn't available
 *  (e.g. you chose "local" then switched to an away board). */
export function ensureCurrency(
  requested: CurrencyKey, theme: Theme, country: CountryKey, homeCountry: CountryKey,
): CurrencyKey {
  const list = availableCurrencies(theme, country, homeCountry);
  return list.some((c) => c.key === requested) ? requested : list[0].key;
}

/** Resolve a config's currency choice into a serialisable currency. */
export function resolveCurrency(config: GameConfig): ResolvedCurrency {
  const { currency, theme, country, homeCountry } = config;
  if (currency === 'kaya') {
    return { key: 'kaya', kind: 'kaya', symbol: '🪙 ', name: 'Kaya Coins', rate: 10 };
  }
  if (currency === 'local' && theme === 'cities' && country === homeCountry && !homeIsUSD(homeCountry)) {
    const c = PACKS[homeCountry].currency;
    return { key: 'local', kind: 'local', symbol: c.symbol, name: c.name, rate: c.rate };
  }
  return { key: 'usd', kind: 'usd', symbol: '$', name: 'US Dollars', rate: 1 };
}
