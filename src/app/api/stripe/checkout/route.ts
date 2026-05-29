// POST /api/stripe/checkout — any signed-in family member (the admin
// surface gates the button, but the server only needs a valid family).
// Body: { tierId: 'home' | 'castle', cycle: 'monthly' | 'yearly' }
//
// Creates a Stripe Checkout Session (mode: subscription) and returns its
// hosted URL. The price is resolved server-side from /config/tiers by
// tierId+cycle — NEVER trusted from the client. The webhook (not the
// success redirect) is what actually flips the family's tier.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { getStripe, priceIdFor, appUrl, type BillingCycle } from '@/lib/stripe';
import type { SubscriptionTierId } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAID = new Set<SubscriptionTierId>(['home', 'castle']);
const CYCLES = new Set<BillingCycle>(['monthly', 'yearly']);

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'stripe-not-configured' }, { status: 503 });

  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.familyId) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  let body: { tierId?: string; cycle?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const tierId = body.tierId as SubscriptionTierId;
  const cycle = body.cycle as BillingCycle;
  if (!PAID.has(tierId)) return NextResponse.json({ error: 'bad-tier' }, { status: 400 });
  if (!CYCLES.has(cycle)) return NextResponse.json({ error: 'bad-cycle' }, { status: 400 });

  const priceId = await priceIdFor(db, tierId, cycle);
  if (!priceId) return NextResponse.json({ error: 'price-not-provisioned' }, { status: 409 });

  // Load the family to reuse/record the Stripe customer + guard against
  // creating a second subscription on top of an existing paid one.
  const famRef = db.collection('families').doc(ctx.familyId);
  const famSnap = await famRef.get();
  const fam = famSnap.exists ? (famSnap.data() as {
    name?: string;
    subscription?: { stripeCustomerId?: string | null; stripeSubscriptionId?: string | null; status?: string };
  }) : null;

  const existingSub = fam?.subscription?.stripeSubscriptionId;
  if (existingSub && fam?.subscription?.status !== 'canceled') {
    // Already paying — plan changes go through the Billing Portal so
    // Stripe handles proration instead of stacking subscriptions.
    return NextResponse.json({ error: 'already-subscribed', usePortal: true }, { status: 409 });
  }

  // Get-or-create the Stripe customer, keyed to the family.
  let customerId = fam?.subscription?.stripeCustomerId ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: ctx.email ?? undefined,
      name: fam?.name ?? undefined,
      metadata: { familyId: ctx.familyId },
    });
    customerId = customer.id;
    await famRef.update({ 'subscription.stripeCustomerId': customerId });
  }

  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: ctx.familyId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    // Both the session and the subscription carry the family + tier so
    // the webhook can resolve them from either object.
    metadata: { familyId: ctx.familyId, tierId, cycle },
    subscription_data: { metadata: { familyId: ctx.familyId, tierId, cycle } },
    success_url: `${base}/settings/subscription?checkout=success`,
    cancel_url: `${base}/settings/subscription?checkout=cancelled`,
  });

  if (!session.url) return NextResponse.json({ error: 'no-session-url' }, { status: 500 });
  return NextResponse.json({ url: session.url });
}
