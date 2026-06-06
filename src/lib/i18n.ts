// Kaya i18n — the app-wide language framework. English-first and fully
// translatable: every label can be a Localized map; anything not yet
// translated falls back to English, so the app never breaks mid-rollout.
//
// Resolution chain (see useLocale): the person's own choice → the family's
// primary language (auto-suggested from the country at sign-up, parent-
// confirmed) → English. Swahili is the FIRST language in this system; French,
// Arabic, etc. slot in the same way — add a code here + supply the strings.

export type Locale = 'en' | 'sw';

export const DEFAULT_LOCALE: Locale = 'en';

export const SUPPORTED_LOCALES: { code: Locale; label: string; flag: string; native: string }[] = [
  { code: 'en', label: 'English',   flag: '🇬🇧', native: 'English' },
  { code: 'sw', label: 'Kiswahili', flag: '🇹🇿', native: 'Kiswahili' },
];

/** A string (or any value) that can carry per-locale variants. */
export type Localized<T = string> = Partial<Record<Locale, T>>;

function isLocalized<T>(v: unknown): v is Localized<T> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Resolve a Localized value (or a plain value) for a locale, falling back to
 *  English, then to whatever is present. Plain (non-localized) values pass
 *  through unchanged — so call sites can pass either. */
export function t<T = string>(value: Localized<T> | T, locale: Locale): T {
  if (isLocalized<T>(value)) {
    const m = value as Localized<T>;
    return (m[locale] ?? m[DEFAULT_LOCALE] ?? (Object.values(m)[0] as T));
  }
  return value as T;
}

// Countries whose families default to Swahili (parent can always change it).
const SWAHILI_COUNTRIES = new Set(['TZ', 'KE', 'UG', 'RW', 'BI', 'CD']);

/** The suggested language for a country (ISO 3166 alpha-2). Defaults English. */
export function localeForCountry(country?: string | null): Locale {
  if (!country) return DEFAULT_LOCALE;
  return SWAHILI_COUNTRIES.has(country.toUpperCase()) ? 'sw' : DEFAULT_LOCALE;
}

export function localeLabel(code: Locale): string {
  return SUPPORTED_LOCALES.find((l) => l.code === code)?.label ?? code;
}

/** Normalise an unknown stored value to a supported Locale (or undefined). */
export function asLocale(v: unknown): Locale | undefined {
  return SUPPORTED_LOCALES.some((l) => l.code === v) ? (v as Locale) : undefined;
}
