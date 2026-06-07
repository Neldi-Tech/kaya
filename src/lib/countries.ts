// Kaya Games — country quick-picks for Local Trivia. The AI can write questions
// for ANY country; this is the popular set shown as flags (+ the family's home
// country, surfaced first). Codes are ISO 3166 alpha-2 to match family.location.

export interface Country { code: string; name: string; flag: string }

export const COUNTRIES: Country[] = [
  { code: 'US', name: 'USA', flag: '🇺🇸' },
  { code: 'GB', name: 'UK', flag: '🇬🇧' },
  { code: 'TZ', name: 'Tanzania', flag: '🇹🇿' },
  { code: 'KE', name: 'Kenya', flag: '🇰🇪' },
  { code: 'NG', name: 'Nigeria', flag: '🇳🇬' },
  { code: 'ZA', name: 'South Africa', flag: '🇿🇦' },
  { code: 'GH', name: 'Ghana', flag: '🇬🇭' },
  { code: 'UG', name: 'Uganda', flag: '🇺🇬' },
  { code: 'EG', name: 'Egypt', flag: '🇪🇬' },
  { code: 'IN', name: 'India', flag: '🇮🇳' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵' },
  { code: 'CN', name: 'China', flag: '🇨🇳' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷' },
  { code: 'FR', name: 'France', flag: '🇫🇷' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪' },
  { code: 'AE', name: 'UAE', flag: '🇦🇪' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺' },
];

export function countryByCode(code?: string | null): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

export const LOCAL_DISCIPLINES: { id: string; label: string; icon: string }[] = [
  { id: 'geography', label: 'Geography', icon: '🗺️' },
  { id: 'history', label: 'History', icon: '🏛️' },
  { id: 'culture', label: 'Culture', icon: '🎎' },
  { id: 'food', label: 'Food', icon: '🍲' },
  { id: 'sports', label: 'Sports', icon: '⚽' },
  { id: 'language', label: 'Language', icon: '🗣️' },
  { id: 'mixed', label: 'A bit of all', icon: '🎲' },
];
