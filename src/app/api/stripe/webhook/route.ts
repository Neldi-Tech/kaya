// POST /api/stripe/webhook — Stripe-to-Kaya event sink (PR 4-Pay).
//
// This is the ONLY thing that writes a paid tier. It runs unauthenticated
// from Kaya's side but is trust-anchored on Stripe's signature: every
// payload is verified against STRIPE_WEBHOOK_SECRET using the RAW body
// (so no JSON parsing before verification). Writes are idempotent — they
// set absolute field values keyed by familyId, so Stripe's at-least-once
// retries are harmless.
//
// Register the endpoint in the Stripe dashboard:
//   https://www.ourkaya.com/api/stripe/webhook
// and subscribe to: checkout.session.completed,
// customer.subscription.updated, customer.subscription.deleted,
// invoice.payment_failed.

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { getStripe, tierForPriceId } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SUB_STATUS = (s: Stripe.Subscription.Status): 'active' | 'past_due' | 'canceled' => {
  switch (s) {
    case 'active':
    case 'trialing':
      return 'active';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    default:
      return 'canceled';
  }
};

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) {
    return NextResponse.json({ error: 'stripe-not-configured' }, { status: 503 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'no-signature' }, { status: 400 });

  const raw = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    console.warn('[stripe-webhook] signature verification failed:', e);
    return NextResponse.json({ error: 'bad-signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const familyId = session.client_reference_id ?? session.metadata?.familyId ?? null;
        const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
        if (!familyId) break;
        if (session.metadata?.kind === 'addons') {
          // Add-on purchase — union into subscription.addons; never touches tier.
          const ids = (session.metadata?.addons ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          if (ids.length) await applyAddons(db, familyId, ids, subId ?? null);
          break;
        }
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscription(db, familyId, sub);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        // Add-on subscriptions carry no tier — skip so we never clobber the
        // family's tier subscription fields.
        if (sub.metadata?.kind === 'addons') break;
        const familyId = await resolveFamilyId(db, sub);
        if (familyId) await applySubscription(db, familyId, sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const familyId = await resolveFamilyId(db, sub);
        if (!familyId) break;
        if (sub.metadata?.kind === 'addons') {
          // Add-on sub cancelled — drop those add-ons; leave the tier alone.
          const ids = (sub.metadata?.addons ?? '').split(',').map((s) => s.trim()).filter(Boolean);
          await removeAddons(db, familyId, ids);
          break;
        }
        await db.collection('families').doc(familyId).update({
          tierId: 'nest',
          'subscription.status': 'canceled',
          'subscription.stripeSubscriptionId': null,
        });
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          // Add-on dunning shouldn't flip the family's tier status to past_due.
          if (sub.metadata?.kind === 'addons') break;
          const familyId = await resolveFamilyId(db, sub);
          if (familyId) {
            await db.collection('families').doc(familyId).update({
              'subscription.status': 'past_due',
            });
          }
        }
        break;
      }
      default:
        // Unhandled event types are acknowledged so Stripe stops retrying.
        break;
    }
  } catch (e) {
    // Returning 500 makes Stripe retry — appropriate for transient
    // Firestore/Stripe errors. Signature already verified above.
    console.error('[stripe-webhook] handler error:', event.type, e);
    return NextResponse.json({ error: 'handler-failed' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Writes the family's tier + subscription seam from a Stripe
 *  Subscription. Maps the sub's price → tierId; if the price is unknown
 *  (e.g. a stale/foreign price) the tier is left untouched. */
async function applySubscription(db: Firestore, familyId: string, sub: Stripe.Subscription): Promise<void> {
  const priceId = sub.items.data[0]?.price?.id;
  const resolved = priceId ? await tierForPriceId(db, priceId) : null;

  const patch: Record<string, unknown> = {
    'subscription.stripeSubscriptionId': sub.id,
    'subscription.stripeCustomerId': typeof sub.customer === 'string' ? sub.customer : sub.customer.id,
    'subscription.status': SUB_STATUS(sub.status),
  };
  // current_period_end sits on the Subscription pre-basil (2025-02-24.acacia,
  // our account's pinned version) and moved onto the first item in basil+ /
  // dahlia. Read both so the handler survives a Stripe API-version upgrade, and
  // skip the field entirely if absent so we never write a NaN Timestamp.
  const periodEndSecs =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    (sub.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
  if (typeof periodEndSecs === 'number' && Number.isFinite(periodEndSecs)) {
    patch['subscription.currentPeriodEnd'] = Timestamp.fromMillis(periodEndSecs * 1000);
  }
  if (resolved) {
    patch.tierId = resolved.tierId;
    patch['subscription.billingCycle'] = resolved.cycle;
  }
  await db.collection('families').doc(familyId).update(patch);
}

/** Union purchased add-on IDs into subscription.addons + record the add-on
 *  subscription id. Never touches tierId or the tier subscription. */
async function applyAddons(db: Firestore, familyId: string, addonIds: string[], subId: string | null): Promise<void> {
  const ref = db.collection('families').doc(familyId);
  const snap = await ref.get();
  const current = ((snap.exists ? (snap.data() as { subscription?: { addons?: string[] } }).subscription?.addons : []) ?? []) as string[];
  const next = Array.from(new Set([...current, ...addonIds]));
  const patch: Record<string, unknown> = { 'subscription.addons': next };
  if (subId) patch['subscription.stripeAddonSubscriptionId'] = subId;
  await ref.update(patch);
}

/** Remove the given add-on IDs from subscription.addons (add-on sub cancelled). */
async function removeAddons(db: Firestore, familyId: string, addonIds: string[]): Promise<void> {
  const ref = db.collection('families').doc(familyId);
  const snap = await ref.get();
  const current = ((snap.exists ? (snap.data() as { subscription?: { addons?: string[] } }).subscription?.addons : []) ?? []) as string[];
  const remove = new Set(addonIds);
  await ref.update({ 'subscription.addons': current.filter((a) => !remove.has(a)), 'subscription.stripeAddonSubscriptionId': null });
}

/** Find the Kaya family for a Stripe subscription. Prefers the
 *  familyId we stamped in metadata; falls back to a lookup by the
 *  stored Stripe customer id. */
async function resolveFamilyId(db: Firestore, sub: Stripe.Subscription): Promise<string | null> {
  const fromMeta = sub.metadata?.familyId;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
  const q = await db.collection('families').where('subscription.stripeCustomerId', '==', customerId).limit(1).get();
  return q.empty ? null : q.docs[0].id;
}
