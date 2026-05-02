// Referral mechanics — single source of truth for tier thresholds and labels.
// Keep this file presentation-agnostic; UI imports from here so changing a
// threshold updates Settings, the landing banner, and any future surfaces.

export const FOUNDING_FAMILY_LIMIT = 100;

export type Tier = 'none' | 'friend' | 'tribe' | 'champion';

export const TIERS: { tier: Tier; threshold: number; name: string; perk: string }[] = [
  { tier: 'none',     threshold: 0,  name: 'New family',  perk: 'Invite a friend to unlock perks.' },
  { tier: 'friend',   threshold: 1,  name: 'Friend',      perk: '3 premium house colors (Ruby, Emerald, Sapphire).' },
  { tier: 'tribe',    threshold: 3,  name: 'Tribe',       perk: 'All 12 house colors, custom kid emoji, dashboard badge.' },
  { tier: 'champion', threshold: 10, name: 'Champion',    perk: 'Free month of Kaya Premium when it launches + landing-page spotlight (opt-in).' },
];

export function effectiveCount(direct: number, compound: number): number {
  return direct + compound;
}

export function tierFor(direct: number, compound = 0): Tier {
  const n = effectiveCount(direct, compound);
  if (n >= 10) return 'champion';
  if (n >= 3)  return 'tribe';
  if (n >= 1)  return 'friend';
  return 'none';
}

export function nextTier(direct: number, compound = 0): { tier: Tier; threshold: number; remaining: number } | null {
  const n = effectiveCount(direct, compound);
  if (n < 1)  return { tier: 'friend',   threshold: 1,  remaining: 1 - n };
  if (n < 3)  return { tier: 'tribe',    threshold: 3,  remaining: 3 - n };
  if (n < 10) return { tier: 'champion', threshold: 10, remaining: 10 - n };
  return null;
}

// Progress toward the *next* tier (0..1). Returns 1 at and beyond Champion.
export function progressToNext(direct: number, compound = 0): number {
  const n = effectiveCount(direct, compound);
  if (n >= 10) return 1;
  if (n >= 3)  return (n - 3) / (10 - 3);
  if (n >= 1)  return (n - 1) / (3 - 1);
  return n / 1;
}

// Generate a referral code from a family name. Format: NAM-YYYY-XXX
// Distinct from inviteCode (which lets helpers/kids join the SAME family).
export function generateReferralCode(name: string): string {
  const cleaned = (name || 'KAYA').replace(/^(the|family|household)\s+/i, '').trim();
  const root = (cleaned.split(/\s+/)[0] || 'KAYA').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase() || 'KAYA';
  const year = new Date().getFullYear();
  const tail = Math.random().toString(36).replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  return `${root}-${year}-${tail}`;
}

export function referralLink(code: string, origin = 'https://www.ourkaya.com'): string {
  return `${origin}/?ref=${encodeURIComponent(code)}`;
}
