// Referral mechanics — single source of truth for the badge ladder and
// Kaya Coins. Keep this file presentation-agnostic; UI imports from here so
// changing a threshold updates Settings, the public profile, and any future
// surface at once.

export const FOUNDING_FAMILY_LIMIT = 100; // closed-beta "Charter Family" crew

// ── Badge ladder ────────────────────────────────────────────────
// Five lifetime badges, earned purely on FREE family signups (direct +
// one-level compound credit). They are a cosmetic honour only — no perks
// gate behind them (the house-colour / free-month perks were retired
// 2026-05-29; badges + Kaya Coins are now the whole reward).
//
// Founding Family is the apex crown, earned ONLY at 1,000 referrals. It is
// deliberately NOT auto-granted to the closed-beta crew — they keep their
// own distinct "Charter Family" mark (see FOUNDING_FAMILY_LIMIT above). Two
// separate honours that don't overlap.

export type BadgeId = 'friend' | 'tribe' | 'champion' | 'patron' | 'founding';

export type Badge = {
  id: BadgeId;
  name: string;
  threshold: number; // referrals (direct + compound) needed to earn it
  color: string;     // flat seal fill (hex); the apex uses a gold gradient in the component
  blurb: string;     // one-line earned description (from the approved v7 design)
  apex?: boolean;    // Founding Family — gold seal + crown + sparkles
};

export const BADGES: Badge[] = [
  { id: 'friend',   name: 'First Friend',    threshold: 1,    color: '#2EB872', blurb: 'The first sprout. You planted Kaya in someone’s home.' },
  { id: 'tribe',    name: 'Tribe',           threshold: 10,   color: '#3B9AE1', blurb: 'A circle is forming around you.' },
  { id: 'champion', name: 'Champion',        threshold: 50,   color: '#F4A93D', blurb: 'Top of the room. You’re carrying the movement.' },
  { id: 'patron',   name: 'Patron',          threshold: 100,  color: '#8C5BE6', blurb: 'Rare air. A true builder of the Kaya world.' },
  { id: 'founding', name: 'Founding Family', threshold: 1000, color: '#E0A93C', blurb: 'Gold seal, sparkle, crown. The one badge that glows.', apex: true },
];

export function effectiveCount(direct: number, compound = 0): number {
  return (direct || 0) + (compound || 0);
}

// All badges earned at the given referral total (direct + compound).
export function earnedBadges(direct: number, compound = 0): Badge[] {
  const n = effectiveCount(direct, compound);
  return BADGES.filter((b) => n >= b.threshold);
}

// Highest badge earned, or null if none yet.
export function topBadge(direct: number, compound = 0): Badge | null {
  const earned = earnedBadges(direct, compound);
  return earned.length ? earned[earned.length - 1] : null;
}

// The next badge to chase, or null once Founding Family is reached.
export function nextBadge(direct: number, compound = 0): Badge | null {
  const n = effectiveCount(direct, compound);
  return BADGES.find((b) => n < b.threshold) ?? null;
}

// Progress (0..1) from the previously-earned rung to the next badge.
// Returns 1 once the apex (Founding Family) is reached.
export function progressToNextBadge(direct: number, compound = 0): number {
  const n = effectiveCount(direct, compound);
  const next = nextBadge(direct, compound);
  if (!next) return 1;
  // Floor at the highest threshold already cleared (0 before the first rung).
  const prev = [...BADGES].reverse().find((b) => b.threshold <= n)?.threshold ?? 0;
  const span = next.threshold - prev;
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (n - prev) / span));
}

// ── Kaya Coins (KC) — family-level referral currency ────────────
// 1 KC ≈ $6 USD. KC accrues at 10% of referred families' paid value over a
// 3-month window. The accrual ENGINE ships in Phase B — Phase A only
// surfaces the (server-owned) balance, which is 0 for everyone today, shown
// dimmed / "coming soon". KC and kid-earned Honey never cross.
export const KC_USD_VALUE = 6;

export function kcToUsd(kc: number): number {
  return Math.max(0, Math.round((kc || 0) * KC_USD_VALUE));
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

// ── House colour library (ungated 2026-05-29) ───────────────────
// House colours used to be a referral perk (3 default + 3 at Friend + 6 at
// Tribe). Perks were retired, so EVERY family now gets the full library.
// The unlock helpers are kept (and always return unlocked) so existing call
// sites keep working without edits; the `tier` tag is now purely descriptive.

export type HouseTier = 'default' | 'friend' | 'tribe';

export type HousePreset = {
  id: string;
  name: string;
  color: string;
  emoji: string;
  tier: HouseTier;
};

export const HOUSE_LIBRARY: HousePreset[] = [
  // Originally "default"
  { id: 'golden',   name: 'Golden House',   color: '#D4A017', emoji: '🏅', tier: 'default' },
  { id: 'white',    name: 'White House',    color: '#7B9DB7', emoji: '🤍', tier: 'default' },
  { id: 'silver',   name: 'Silver House',   color: '#9B8EC4', emoji: '🥈', tier: 'default' },

  // Originally "friend" tier
  { id: 'ruby',     name: 'Ruby House',     color: '#C0392B', emoji: '❤️', tier: 'friend' },
  { id: 'emerald',  name: 'Emerald House',  color: '#27AE60', emoji: '💚', tier: 'friend' },
  { id: 'sapphire', name: 'Sapphire House', color: '#2980B9', emoji: '💙', tier: 'friend' },

  // Originally "tribe" tier
  { id: 'coral',    name: 'Coral House',    color: '#FF6B6B', emoji: '🌸', tier: 'tribe' },
  { id: 'indigo',   name: 'Indigo House',   color: '#5E35B1', emoji: '🔮', tier: 'tribe' },
  { id: 'teal',     name: 'Teal House',     color: '#0E9594', emoji: '🌊', tier: 'tribe' },
  { id: 'rose',     name: 'Rose House',     color: '#EC407A', emoji: '🌹', tier: 'tribe' },
  { id: 'amber',    name: 'Amber House',    color: '#FFA000', emoji: '🔥', tier: 'tribe' },
  { id: 'mint',     name: 'Mint House',     color: '#26A69A', emoji: '🌿', tier: 'tribe' },
];

// All house colours are now available to every family. Signature retained for
// backward compatibility with existing callers (args ignored).
export function isHouseUnlocked(_houseTier?: HouseTier, _direct?: number, _compound = 0): boolean {
  return true;
}

export function unlockedHouses(_direct?: number, _compound = 0): HousePreset[] {
  return HOUSE_LIBRARY;
}

export function houseUnlockHint(_houseTier?: HouseTier): string {
  return 'Available to all families';
}
