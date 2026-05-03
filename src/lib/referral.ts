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

// ── House colour library ────────────────────────────────────────
// 3 default colours, 3 unlocked at Friend tier (1 referral),
// 6 more unlocked at Tribe tier (3 referrals). Champion adds nothing
// new on the colour front — its perk is the free Premium month.

export type HouseTier = 'default' | 'friend' | 'tribe';

export type HousePreset = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  tier: HouseTier;
};

export const HOUSE_LIBRARY: HousePreset[] = [
  // Default — always available
  { id: 'golden',   name: 'Golden House',   color: '#D4A017', emoji: '🏅', tier: 'default' },
  { id: 'white',    name: 'White House',    color: '#7B9DB7', emoji: '🤍', tier: 'default' },
  { id: 'silver',   name: 'Silver House',   color: '#9B8EC4', emoji: '🥈', tier: 'default' },

  // Friend tier — unlocked at 1 referral
  { id: 'ruby',     name: 'Ruby House',     color: '#C0392B', emoji: '❤️', tier: 'friend' },
  { id: 'emerald',  name: 'Emerald House',  color: '#27AE60', emoji: '💚', tier: 'friend' },
  { id: 'sapphire', name: 'Sapphire House', color: '#2980B9', emoji: '💙', tier: 'friend' },

  // Tribe tier — unlocked at 3 referrals
  { id: 'coral',    name: 'Coral House',    color: '#FF6B6B', emoji: '🌸', tier: 'tribe' },
  { id: 'indigo',   name: 'Indigo House',   color: '#5E35B1', emoji: '🔮', tier: 'tribe' },
  { id: 'teal',     name: 'Teal House',     color: '#0E9594', emoji: '🌊', tier: 'tribe' },
  { id: 'rose',     name: 'Rose House',     color: '#EC407A', emoji: '🌹', tier: 'tribe' },
  { id: 'amber',    name: 'Amber House',    color: '#FFA000', emoji: '🔥', tier: 'tribe' },
  { id: 'mint',     name: 'Mint House',     color: '#26A69A', emoji: '🌿', tier: 'tribe' },
];

export function isHouseUnlocked(houseTier: HouseTier, direct: number, compound = 0): boolean {
  if (houseTier === 'default') return true;
  const total = effectiveCount(direct, compound);
  if (houseTier === 'friend') return total >= 1;
  if (houseTier === 'tribe')  return total >= 3;
  return false;
}

export function unlockedHouses(direct: number, compound = 0): HousePreset[] {
  return HOUSE_LIBRARY.filter((h) => isHouseUnlocked(h.tier, direct, compound));
}

export function houseUnlockHint(houseTier: HouseTier): string {
  if (houseTier === 'default') return 'Available to all families';
  if (houseTier === 'friend')  return 'Unlocks at 1 referral · Friend tier';
  if (houseTier === 'tribe')   return 'Unlocks at 3 referrals · Tribe tier';
  return '';
}
