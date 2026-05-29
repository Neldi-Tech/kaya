// Referral mechanics — single source of truth for the badge ladder and
// Kaya Coins. Keep this file presentation-agnostic; UI imports from here so
// changing a threshold updates Settings, the public profile, and any future
// surface at once.

import type { SubscriptionTierId } from './tiers';

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

// ── Charter & Founding serials ──────────────────────────────────
// Two non-overlapping honour numbers (see the badge note above):
//   • Charter No.  (CF-###) — a closed-beta Charter Family's join ordinal
//     (1..FOUNDING_FAMILY_LIMIT). Stamped at creation from the global
//     family count; backfilled for existing families by createdAt order.
//   • Founding No. (FF-###) — the order a family EARNS the apex Founding
//     Family badge (1,000 referrals). Assigned server-side when earned;
//     none exist in closed beta yet.
// Both render zero-padded to 3 digits. Returns null when unset so callers
// can hide the serial cleanly.

export function formatCharterNumber(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return `CF-${String(Math.floor(n)).padStart(3, '0')}`;
}

export function formatFoundingNumber(n: number | null | undefined): string | null {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return null;
  return `FF-${String(Math.floor(n)).padStart(3, '0')}`;
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

// ── Display formatting — "classic" compact notation ─────────────
// Big balances/values get unwieldy fast (a 1,000-referral apex family can
// hold billions of KC). Below 10K we show the exact figure with thousand
// separators (#,### — and up to 2 dp for fractional KC like 2.8); at/above
// 10K we switch to compact K/M/B with one decimal (12.5K, 100M, 2.3B). Pure
// + presentation-agnostic so every KC surface reads identically.

export function compactNumber(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(v);
  const compact = (x: number) => String(Math.round(x * 10) / 10); // 1 dp, trims trailing .0
  if (abs >= 1e9) return compact(v / 1e9) + 'B';
  if (abs >= 1e6) return compact(v / 1e6) + 'M';
  if (abs >= 1e4) return compact(v / 1e3) + 'K';
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** A KC balance, classic-formatted (e.g. "2.8", "1,250", "2.3B"). */
export function formatKc(kc: number): string {
  return compactNumber(Math.round((kc || 0) * 100) / 100);
}

/** A KC balance's USD value, classic-formatted with a $ prefix ("$6B"). */
export function formatKcUsd(kc: number): string {
  return '$' + compactNumber(kcToUsd(kc));
}

// ── KC accrual (Phase B engine — pure math) ─────────────────────
// When a REFERRED family pays, the referrer earns 10% of that paid value
// as KC, valued at $6/KC, counted over the referred family's first
// 3 months. These constants + computeReferralAccrualKc() are the whole
// economic rule; the Admin-SDK side (lib/referralServer.ts) feeds them
// real payments. No billing events exist in closed beta yet, so this is
// a documented SEAM — correct + tested, waiting on a payment source.

export const REFERRAL_ACCRUAL_RATE = 0.1; // 10% of a referred family's paid value
export const REFERRAL_ACCRUAL_WINDOW_MONTHS = 3; // counted over their first 3 months

/** KC earned from a single referred payment of `paidValueCents` (USD
 *  cents) inside the 3-month window: 10% of value, charged at $6/KC,
 *  rounded to 2 dp. Pure + side-effect-free so it can be unit-reasoned
 *  and reused by the future billing webhook. */
export function computeReferralAccrualKc(paidValueCents: number): number {
  if (!paidValueCents || paidValueCents <= 0) return 0;
  const rewardUsd = (paidValueCents / 100) * REFERRAL_ACCRUAL_RATE;
  return Math.round((rewardUsd / KC_USD_VALUE) * 100) / 100;
}

// ── KC → tier redemption (Phase B — pure cost math) ─────────────
// KC spends on tier time. The operator picks a family + tier + duration
// in the Admin portal (Phase B "start with Tiers only"); the cost is the
// tier's USD value over that span, charged at $6/KC and rounded UP so a
// grant never costs the family less than its face value. The spend path
// is deliberately generic (lib/referralServer.applyKcLedger) so KC can
// buy non-tier things later without touching this math.

export interface KcTierDuration {
  id: string;
  label: string;
  months: number;
}

export const KC_TIER_DURATIONS: KcTierDuration[] = [
  { id: '1m', label: '1 month', months: 1 },
  { id: '3m', label: '3 months', months: 3 },
  { id: '6m', label: '6 months', months: 6 },
  { id: '12m', label: '12 months', months: 12 },
];

/** KC cost to grant `months` of a plan priced at `priceMonthlyCents`
 *  (USD cents). Value = price × months, charged at $6/KC, rounded UP.
 *  Free plans (Nest) cost 0. */
export function kcCostForTierGrant(priceMonthlyCents: number, months: number): number {
  if (priceMonthlyCents <= 0 || months <= 0) return 0;
  const valueUsd = (priceMonthlyCents / 100) * months;
  return Math.ceil(valueUsd / KC_USD_VALUE);
}

// ── KC ledger (Phase B — audit trail shape) ─────────────────────
// Every balance change is mirrored to families/{id}/kcLedger/{entryId}
// by the Admin SDK. `amount` is signed (+credit / -debit) and
// `balanceAfter` snapshots the running family.kayaCoins so the trail is
// readable without summing. Written server-only; parents may read.

export type KcLedgerKind = 'accrual' | 'grant' | 'redemption' | 'adjustment';

export interface KcLedgerEntry {
  id: string;
  kind: KcLedgerKind;
  amount: number; // signed: +credit / -debit
  balanceAfter: number;
  reason: string;
  createdAtMs: number;
  createdByEmail: string | null;
  // optional context, by kind
  tierId: SubscriptionTierId | null; // redemption: plan granted
  durationMonths: number | null; // redemption: grant length
  refFamilyId: string | null; // accrual: which referred family paid
  paidValueCents: number | null; // accrual: the underlying payment
}

export const KC_LEDGER_KIND_META: Record<KcLedgerKind, { label: string; emoji: string }> = {
  accrual: { label: 'Referral reward', emoji: '🌱' },
  grant: { label: 'Manual grant', emoji: '🎁' },
  redemption: { label: 'Redeemed', emoji: '🪙' },
  adjustment: { label: 'Adjustment', emoji: '⚖️' },
};

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
