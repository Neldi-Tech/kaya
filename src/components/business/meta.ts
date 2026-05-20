// Kaya Business · presentation meta shared across the Business screens.
// Type labels/emoji come from the data-layer catalog; the per-type card
// gradients + status tones are the visual language from the v2 mockup
// (Kaya-Business_Mockup_2026-05-19.html). Geographically + currency neutral.

import { BUSINESS_TYPES, BusinessType, BusinessStatus } from '@/lib/business';

export function typeMeta(type: BusinessType): { label: string; emoji: string } {
  const m = BUSINESS_TYPES.find((t) => t.key === type);
  return m ? { label: m.label, emoji: m.emoji } : { label: 'Business', emoji: '💼' };
}

// Soft → saturated gradient per business type (inline `background` style —
// these aren't Tailwind tokens, matching the mockup's card treatment).
export const TYPE_GRADIENT: Record<BusinessType, string> = {
  goods:    'linear-gradient(135deg, #FFF6DE 0%, #F5D77A 100%)',
  service:  'linear-gradient(135deg, #E8F0FF 0%, #B7CDF2 100%)',
  advice:   'linear-gradient(135deg, #F0E6FF 0%, #C9B3F0 100%)',
  sport:    'linear-gradient(135deg, #E1F4E5 0%, #9CCFA5 100%)',
  learning: 'linear-gradient(135deg, #FFE9D9 0%, #F5B47E 100%)',
  coop:     'linear-gradient(135deg, #FFF6DE 0%, #F5D77A 100%)',
  adhoc:    'linear-gradient(135deg, #FFE2EC 0%, #F4A0BB 100%)',
};

// Status pill tone — green = live, amber = in-the-works, muted = parked.
export const STATUS_META: Record<BusinessStatus, { label: string; pill: string }> = {
  idea:   { label: 'Idea',   pill: 'bg-[#FCEAD6] text-[#B25E16]' },
  pilot:  { label: 'Pilot',  pill: 'bg-[#FCEAD6] text-[#B25E16]' },
  active: { label: 'Active', pill: 'bg-[#E2F0E2] text-[#2F7D32]' },
  paused: { label: 'Paused', pill: 'bg-hive-cream text-hive-muted' },
  closed: { label: 'Closed', pill: 'bg-hive-cream text-hive-muted' },
};
