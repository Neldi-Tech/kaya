// POST /api/stripe/checkout-addons — any signed-in family member.
// Body: { addons: string[] }. Creates a Stripe Checkout Session (subscription
// mode) for the selected add-ons and returns its hosted URL.
//
// Charging invariant: only RELEASED add-ons WITH a provisioned Stripe Price are
// chargeable. Unreleased → 400 addon-not-available; released-but-unpriced →
// 409 price-not-provisioned (the family page falls back to the request flow).
// The add-on subscription carries metadata.kind='addons' so the webhook applies
// it to subscription.addons WITHOUT touching the family's tier subscription.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { getStripe, appUrl } from '@/lib/stripe';
import { DEFAULT_ADDONS, isAddonReleased, type AddonOverrides } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'stripe-not-configured' }, { status: 503 });

  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.familyId) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  let body: { addons?: string[] };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const requested = Array.isArray(body.addons)
    ? body.addons.filter((a): a is string => typeof a === 'string')
    : [];
  if (requested.length === 0) return NextResponse.json({ error: 'no-addons' }, { status: 400 });

  const snap = await db.collection('config').doc('addons').get();
  const overrides = ((snap.exists ? snap.data() : {}) as AddonOverrides) ?? {};

  // Charging invariant — every selected add-on must be released AND priced.
  const lineItems: { price: string; quantity: number }[] = [];
  const unavailable: string[] = [];
  const unpriced: string[] = [];
  for (const id of requested) {
    const addon = DEFAULT_ADDONS.find((a) => a.id === id);
    if (!addon || !isAddonReleased(addon, overrides)) { unavailable.push(id); continue; }
    const priceId = overrides[id]?.stripePriceId;
    if (!priceId) { unpriced.push(id); continue; }
    lineItems.push({ price: priceId, quantity: 1 });
  }
  if (unavailable.length) return NextResponse.json({ error: 'addon-not-available', addons: unavailable }, { status: 400 });
  if (unpriced.length) return NextResponse.json({ error: 'price-not-provisioned', addons: unpriced }, { status: 409 });

  // Get-or-create the Stripe customer (mirrors the tier checkout).
  const famRef = db.collection('families').doc(ctx.familyId);
  const famSnap = await famRef.get();
  const fam = famSnap.exists ? (famSnap.data() as {
    name?: string;
    subscription?: { stripeCustomerId?: string | null };
  }) : null;
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

  const addonsCsv = requested.join(',');
  const base = appUrl();
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    client_reference_id: ctx.familyId,
    line_items: lineItems,
    allow_promotion_codes: true,
    // kind='addons' tells the webhook to apply these to subscription.addons
    // and NEVER touch the tier subscription fields.
    metadata: { familyId: ctx.familyId, kind: 'addons', addons: addonsCsv },
    subscription_data: { metadata: { familyId: ctx.familyId, kind: 'addons', addons: addonsCsv } },
    success_url: `${base}/settings/subscription?addons=success`,
    cancel_url: `${base}/settings/subscription?addons=cancelled`,
  });

  if (!session.url) return NextResponse.json({ error: 'no-session-url' }, { status: 500 });
  return NextResponse.json({ url: session.url });
}
