// POST /api/stripe/portal — opens the Stripe Billing Portal for a family
// that already has a Stripe customer. The portal is where Stripe handles
// plan changes (with proration), payment-method updates, invoices, and
// cancellation — so Kaya never has to build those screens.
//
// We only need a valid family with a stored stripeCustomerId; the actual
// tier change still comes back to us through the webhook.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { getStripe, appUrl } from '@/lib/stripe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ error: 'stripe-not-configured' }, { status: 503 });

  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.familyId) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  const famSnap = await db.collection('families').doc(ctx.familyId).get();
  const fam = famSnap.exists ? (famSnap.data() as {
    subscription?: { stripeCustomerId?: string | null };
  }) : null;

  const customerId = fam?.subscription?.stripeCustomerId ?? null;
  if (!customerId) {
    // No Stripe customer yet — they've never checked out, so there's
    // nothing for the portal to manage. The UI should send these users
    // to Checkout instead.
    return NextResponse.json({ error: 'no-customer' }, { status: 409 });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${appUrl()}/settings/subscription`,
  });

  return NextResponse.json({ url: session.url });
}
