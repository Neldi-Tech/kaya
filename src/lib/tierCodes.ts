// Kaya Tier Codes — pure types + helpers. No firebase imports.
//
// Pre-Stripe upgrade flow: family taps Request Upgrade → operator
// reviews → operator generates a per-family code that auto-emails to
// the family → family pastes it on /settings/subscription → tier
// unlocks (with optional expiry). On expiry (lazy check in
// useTierAccess), the family auto-reverts to Nest.

import type { SubscriptionTierId } from './tiers';

// ── Code format ──────────────────────────────────────────────────────
//
// Human-readable: tier prefix + 6 random alphanumeric.
//   HOME-X4K9B2   CAST-V2P8Q7   NEST-T1R7M3
// Tier prefix is decorative — the lock to a specific family is via
// the doc's `familyId` field, not the code string. Excludes confusing
// glyphs (0/O, 1/I/L).

const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function tierCodePrefix(tier: SubscriptionTierId): string {
  switch (tier) {
    case 'nest':   return 'NEST';
    case 'home':   return 'HOME';
    case 'castle': return 'CAST';
  }
}

/** Generates a fresh code (e.g. "HOME-X4K9B2") using crypto-strong
 *  randomness. The format is opaque — the lookup at redeem time uses
 *  the exact string, the prefix is just for human legibility. */
export function generateTierCode(tier: SubscriptionTierId): string {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += SAFE_ALPHABET[rand[i] % SAFE_ALPHABET.length];
  }
  return `${tierCodePrefix(tier)}-${suffix}`;
}

/** True if the string looks like one of our codes — used as a cheap
 *  client-side guard before posting to the redeem endpoint. */
export function isProbablyTierCode(s: string): boolean {
  return /^(NEST|HOME|CAST)-[A-Z0-9]{6}$/.test(s.toUpperCase());
}

// ── Expiry presets (UI dropdown options) ─────────────────────────────

export type ExpiryPreset = '7d' | '30d' | '90d' | '1y' | 'forever';

export interface ExpiryOption {
  id: ExpiryPreset;
  label: string;
  /** Milliseconds to add. `null` = forever (no expiry). */
  ms: number | null;
}

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { id: '7d',      label: '7 days',  ms: 7 * 24 * 60 * 60 * 1000 },
  { id: '30d',     label: '30 days', ms: 30 * 24 * 60 * 60 * 1000 },
  { id: '90d',     label: '90 days', ms: 90 * 24 * 60 * 60 * 1000 },
  { id: '1y',      label: '1 year',  ms: 365 * 24 * 60 * 60 * 1000 },
  { id: 'forever', label: 'Forever', ms: null },
];

export function expiryMsFromPreset(preset: ExpiryPreset): number | null {
  return EXPIRY_OPTIONS.find((o) => o.id === preset)?.ms ?? null;
}

// ── Doc shapes ───────────────────────────────────────────────────────

export type CodeStatus = 'fresh' | 'redeemed' | 'expired' | 'revoked';

export interface TierCodeRow {
  id: string;
  code: string;
  tierId: SubscriptionTierId;
  addons: string[];
  familyId: string;
  familyName: string;
  familyHandle: string | null;
  recipientEmail: string;
  expiresAtMs: number | null;   // null = forever
  status: CodeStatus;
  redeemedAtMs: number | null;
  createdByEmail: string;
  createdAtMs: number;
  emailSent: boolean;
  emailError: string | null;
}

export type RequestStatus = 'pending' | 'fulfilled' | 'dismissed';

export interface UpgradeRequestRow {
  id: string;
  familyId: string;
  familyName: string;
  familyHandle: string | null;
  requesterUid: string;
  requesterName: string;
  requesterEmail: string;
  requestedTier: SubscriptionTierId;
  requestedAddons: string[];
  note: string;
  status: RequestStatus;
  fulfilledCodeId: string | null;
  createdAtMs: number;
}

// ── Display helpers ──────────────────────────────────────────────────

export function statusChip(s: CodeStatus): { bg: string; fg: string; label: string } {
  switch (s) {
    case 'fresh':    return { bg: 'rgba(91,184,91,0.15)',  fg: '#5BB85B', label: 'Fresh' };
    case 'redeemed': return { bg: 'rgba(110,119,145,0.18)', fg: 'rgba(255,255,255,0.5)', label: 'Redeemed' };
    case 'expired':  return { bg: 'rgba(232,92,92,0.15)',  fg: '#FF7676', label: 'Expired' };
    case 'revoked':  return { bg: 'rgba(212,168,71,0.18)', fg: '#D4A847', label: 'Revoked' };
  }
}

/** Format expiry copy ("expires in 30 days", "forever", "expired"). */
export function expiryCopy(expiresAtMs: number | null, now: number = Date.now()): string {
  if (expiresAtMs === null) return 'forever';
  const remaining = expiresAtMs - now;
  if (remaining <= 0) return 'expired';
  const days = Math.ceil(remaining / (24 * 60 * 60 * 1000));
  if (days >= 365) return `expires in ${Math.round(days / 365)} year${Math.round(days / 365) === 1 ? '' : 's'}`;
  if (days >= 30)  return `expires in ${Math.round(days / 30)} month${Math.round(days / 30) === 1 ? '' : 's'}`;
  return `expires in ${days} day${days === 1 ? '' : 's'}`;
}
