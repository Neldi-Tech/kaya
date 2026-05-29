// Server-only Stripe client + tier↔price mapping (PR 4-Pay).
//
// NEVER import this from a client component — it pulls in the secret
// key. Mirrors firebaseAdmin's graceful-null policy: a missing
// STRIPE_SECRET_KEY returns null rather than throwing, so the build and
// unrelated routes survive while billing simply 503s until keys land.
//
// Stripe Price IDs live on /config/tiers/{tierId} (written by
// scripts/stripe-provision.ts) — NOT in env — so the admin pricing page
// can manage them without a deploy. `loadAllTiers` already surfaces them
// because it spreads the stored patch over DEFAULT_TIERS.

import Stripe from 'stripe';
import type { Firestore } from 'firebase-admin/firestore';
import { loadAllTiers } from './tiersServer';
import type { SubscriptionTierId, TierConfig } from './tiers';

export type BillingCycle = 'monthly' | 'yearly';

/** Paid tiers only — Nest is free and has no Stripe object. */
export const PAID_TIERS: SubscriptionTierId[] = ['home', 'castle'];

const SECRET = process.env.STRIPE_SECRET_KEY;

let cached: Stripe | null | undefined; // undefined = not attempted; null = no key

/** Lazily-constructed Stripe client, or null if no key configured.
 *  apiVersion is intentionally omitted so the type stays valid across
 *  SDK upgrades; the account's default pinned version is used. */
export function getStripe(): Stripe | null {
  if (cached !== undefined) return cached;
  if (!SECRET) {
    console.warn('[stripe] STRIPE_SECRET_KEY not set — billing routes will 503.');
    cached = null;
    return null;
  }
  cached = new Stripe(SECRET);
  return cached;
}

/** True when the configured key is a live key (sk_live_…). Lets the UI
 *  / scripts print a clear "LIVE" vs "TEST" banner. */
export function isLiveMode(): boolean {
  return (SECRET ?? '').startsWith('sk_live_');
}

/** Absolute app origin for building Checkout success/cancel + portal
 *  return URLs. Falls back to prod. */
export function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
}

/** The Stripe Price ID for a tier+cycle from a resolved TierConfig.
 *  null when free (Nest) or not yet provisioned. */
export function priceIdFromConfig(t: TierConfig, cycle: BillingCycle): string | null {
  return (cycle === 'yearly' ? t.stripePriceIdYearly : t.stripePriceIdMonthly) ?? null;
}

/** Server-trusted price lookup: never accept a price/amount from the
 *  client — map tierId+cycle → priceId from the live merged config. */
export async function priceIdFor(
  db: Firestore,
  tierId: SubscriptionTierId,
  cycle: BillingCycle,
): Promise<string | null> {
  const tiers = await loadAllTiers(db);
  return priceIdFromConfig(tiers[tierId], cycle);
}

export interface ResolvedPrice {
  tierId: SubscriptionTierId;
  cycle: BillingCycle;
  priceId: string;
}

/** Reverse map a Stripe Price ID back to tierId+cycle. Used by the
 *  webhook to decide which tier a subscription grants. null = unknown
 *  price (e.g. an add-on or a stale/foreign price) — caller should
 *  leave the tier untouched rather than guess. */
export async function tierForPriceId(db: Firestore, priceId: string): Promise<ResolvedPrice | null> {
  const tiers = await loadAllTiers(db);
  for (const tierId of PAID_TIERS) {
    const t = tiers[tierId];
    if (t.stripePriceIdMonthly === priceId) return { tierId, cycle: 'monthly', priceId };
    if (t.stripePriceIdYearly === priceId) return { tierId, cycle: 'yearly', priceId };
  }
  return null;
}
