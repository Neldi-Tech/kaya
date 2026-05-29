#!/usr/bin/env tsx
/**
 * scripts/stripe-provision.ts
 *
 * Idempotently creates the Stripe Products + monthly/yearly Prices for the
 * paid Kaya tiers (Home, Castle) and writes their IDs back to
 * config/tiers/plans/{tierId}, so /api/stripe/checkout and the webhook can
 * map tier+cycle <-> Stripe Price. Nest is free and gets no Stripe object.
 *
 * Idempotency (safe to re-run):
 *   - Product: reuse the id stored in the config doc (verified via
 *     retrieve); else reuse an existing product tagged metadata.kayaTierId;
 *     else create one.
 *   - Price: prices are immutable in Stripe, so we reuse an active price on
 *     the product that already matches currency + interval + amount. Only
 *     when the amount has changed do we create a NEW price (and the config
 *     simply repoints to it). We never delete or mutate the old price.
 *
 * Reads always run, so the dry-run plan is accurate. Writes (Stripe create
 * + Firestore set) happen only with --commit.
 *
 * USAGE
 *   STRIPE_SECRET_KEY=sk_test_... \
 *     GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/kaya-sa.json \
 *     npx tsx scripts/stripe-provision.ts            # dry-run, writes nothing
 *   ...same... npx tsx scripts/stripe-provision.ts --commit   # create + write
 */

import Stripe from 'stripe';
import { DEFAULT_TIERS, type SubscriptionTierId } from '../src/lib/tiers';

const COMMIT = process.argv.includes('--commit');
const PAID_TIERS: SubscriptionTierId[] = ['home', 'castle'];
const CURRENCY = 'usd'; // company default — prices in lib/tiers.ts are USD cents

type Cycle = 'monthly' | 'yearly';
const CYCLES: { cycle: Cycle; interval: 'month' | 'year' }[] = [
  { cycle: 'monthly', interval: 'month' },
  { cycle: 'yearly', interval: 'year' },
];

function amountFor(tierId: SubscriptionTierId, cycle: Cycle): number {
  const t = DEFAULT_TIERS[tierId];
  return cycle === 'yearly' ? t.priceYearly : t.priceMonthly;
}

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

async function main() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) { console.error('Set STRIPE_SECRET_KEY.'); process.exit(1); }

  const live = secret.startsWith('sk_live_');
  const banner = live ? 'LIVE 🔴' : 'TEST 🧪';
  console.log(`\nStripe mode: ${banner}`);
  console.log(COMMIT ? 'Mode: --commit (will create Stripe objects + write Firestore)\n' : 'Mode: dry-run (reads only; pass --commit to write)\n');

  const stripe = new Stripe(secret);

  const projectId = process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463';
  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
  const db = admin.firestore();

  for (const tierId of PAID_TIERS) {
    const t = DEFAULT_TIERS[tierId];
    console.log(`── ${t.name} (${tierId}) ─────────────────────────────`);

    const planRef = db.collection('config').doc('tiers').collection('plans').doc(tierId);
    const planSnap = await planRef.get();
    const stored = planSnap.exists ? (planSnap.data() as {
      stripeProductId?: string;
      stripePriceIdMonthly?: string;
      stripePriceIdYearly?: string;
    }) : {};

    // ── Product ───────────────────────────────────────────────────────
    let productId = await resolveProduct(stripe, tierId, t.name, t.tagline, stored.stripeProductId);

    // ── Prices (one per cycle) ────────────────────────────────────────
    const priceIds: Partial<Record<Cycle, string>> = {};
    for (const { cycle, interval } of CYCLES) {
      const amount = amountFor(tierId, cycle);
      priceIds[cycle] = await resolvePrice(stripe, tierId, productId.id, productId.created, cycle, interval, amount);
    }

    // ── Persist to config/tiers/plans/{tierId} ────────────────────────
    const patch = {
      stripeProductId: productId.id,
      stripePriceIdMonthly: priceIds.monthly,
      stripePriceIdYearly: priceIds.yearly,
    };
    if (COMMIT) {
      await planRef.set(patch, { merge: true });
      console.log(`  ✓ wrote config/tiers/plans/${tierId} →`, patch);
    } else {
      console.log(`  (dry-run) would write config/tiers/plans/${tierId} →`, patch);
    }
    console.log('');
  }

  console.log(COMMIT
    ? 'Done. Checkout can now resolve prices for Home + Castle.'
    : 'Dry-run complete. Re-run with --commit to create the Stripe objects and write the config.');
}

/** Returns { id, created } — created=true when we just made it (only with --commit). */
async function resolveProduct(
  stripe: Stripe,
  tierId: SubscriptionTierId,
  name: string,
  description: string,
  storedId: string | undefined,
): Promise<{ id: string; created: boolean }> {
  // 1) Stored id wins — verify it still exists and isn't archived.
  //    retrieve() throws for a deleted id (caught below), so a successful
  //    retrieve is always a live product; we only need the active check.
  if (storedId) {
    try {
      const p = await stripe.products.retrieve(storedId);
      if (p.active) {
        console.log(`  product: reuse ${p.id} (from config)`);
        return { id: p.id, created: false };
      }
    } catch {
      console.log(`  product: stored id ${storedId} not found — will search/create`);
    }
  }
  // 2) Search by metadata tag.
  try {
    const found = await stripe.products.search({ query: `active:'true' AND metadata['kayaTierId']:'${tierId}'`, limit: 1 });
    if (found.data[0]) {
      console.log(`  product: reuse ${found.data[0].id} (matched metadata.kayaTierId)`);
      return { id: found.data[0].id, created: false };
    }
  } catch {
    // search index can lag right after creation; fall through to create
  }
  // 3) Create.
  if (!COMMIT) {
    console.log(`  product: (dry-run) would CREATE "${name}" {metadata.kayaTierId:${tierId}}`);
    return { id: `prod_DRYRUN_${tierId}`, created: true };
  }
  const created = await stripe.products.create({
    name,
    description,
    metadata: { kayaTierId: tierId },
  });
  console.log(`  product: created ${created.id} "${name}"`);
  return { id: created.id, created: true };
}

async function resolvePrice(
  stripe: Stripe,
  tierId: SubscriptionTierId,
  productId: string,
  productJustCreated: boolean,
  cycle: Cycle,
  interval: 'month' | 'year',
  amount: number,
): Promise<string> {
  // A freshly-created (or dry-run placeholder) product has no prices yet.
  if (!productJustCreated) {
    const existing = await stripe.prices.list({ product: productId, active: true, limit: 100 });
    const match = existing.data.find((p) =>
      p.currency === CURRENCY &&
      p.unit_amount === amount &&
      p.recurring?.interval === interval,
    );
    if (match) {
      console.log(`  price[${cycle}]: reuse ${match.id} (${fmtUsd(amount)}/${interval})`);
      return match.id;
    }
  }
  if (!COMMIT) {
    console.log(`  price[${cycle}]: (dry-run) would CREATE ${fmtUsd(amount)}/${interval}`);
    return `price_DRYRUN_${tierId}_${cycle}`;
  }
  const created = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: amount,
    recurring: { interval },
    metadata: { kayaTierId: tierId, cycle },
  });
  console.log(`  price[${cycle}]: created ${created.id} (${fmtUsd(amount)}/${interval})`);
  return created.id;
}

main().catch((e) => { console.error(e); process.exit(1); });
