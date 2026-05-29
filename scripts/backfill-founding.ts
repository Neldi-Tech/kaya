#!/usr/bin/env tsx
/**
 * scripts/backfill-founding.ts
 *
 * GO-LIVE SAFETY NET for the Stripe paid funnel (PR 4-Pay).
 *
 * Context: tierAccess.ts has DEFAULT_TIER_FALLBACK = 'castle' so that during
 * closed beta a family with no explicit tierId still sees every feature. When
 * we open paid billing we flip that fallback to 'nest' — at which point any
 * existing family that (a) is NOT flagged isFoundingFamily AND (b) has no
 * explicit tierId would silently drop from Castle-equivalent access to Nest.
 *
 * The first FOUNDING_FAMILY_LIMIT (100) families are auto-stamped
 * isFoundingFamily at creation, so in practice almost every beta family is
 * already safe. This script PROVES that empirically and grandfathers any
 * straggler by stamping isFoundingFamily: true — which grants the same full
 * module set the castle fallback was already giving them (access-neutral).
 *
 * Run this BEFORE flipping DEFAULT_TIER_FALLBACK to 'nest'.
 *
 * Categories printed per family:
 *   safe-founding  isFoundingFamily === true                     → untouched
 *   safe-tier      has an explicit tierId (fallback never applies)→ untouched
 *   AT-RISK        neither — the flip would downgrade them        → stamped (commit)
 *
 * USAGE
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/kaya-sa.json \
 *     npx tsx scripts/backfill-founding.ts            # dry-run, writes nothing
 *   ...same... npx tsx scripts/backfill-founding.ts --commit   # stamp at-risk
 */

const COMMIT = process.argv.includes('--commit');

async function main() {
  const projectId = process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463';
  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
  const db = admin.firestore();

  const snap = await db.collection('families').get();
  console.log(`\nScanning ${snap.size} families…\n`);

  const atRisk: { id: string; name: string }[] = [];
  let safeFounding = 0;
  let safeTier = 0;

  for (const doc of snap.docs) {
    const d = doc.data() as { name?: string; tierId?: string; isFoundingFamily?: boolean };
    const name = d.name || '(unnamed)';
    const tier = d.tierId ?? '—';
    if (d.isFoundingFamily === true) {
      safeFounding += 1;
      console.log(`  safe-founding  ${doc.id}  "${name}"  tier=${tier}`);
    } else if (d.tierId) {
      safeTier += 1;
      console.log(`  safe-tier      ${doc.id}  "${name}"  tier=${tier}`);
    } else {
      atRisk.push({ id: doc.id, name });
      console.log(`  AT-RISK        ${doc.id}  "${name}"  tier=${tier}  ← flip would drop to Nest`);
    }
  }

  console.log(`\nSummary: ${safeFounding} founding · ${safeTier} explicit-tier · ${atRisk.length} AT-RISK`);

  if (atRisk.length === 0) {
    console.log('\nNothing to backfill — every family is already safe. The fallback flip is safe to make.');
    return;
  }

  if (!COMMIT) {
    console.log(`\nDry-run. Re-run with --commit to stamp isFoundingFamily:true on the ${atRisk.length} at-risk family(ies) above.`);
    console.log('Stamping grants the same full module set the castle fallback already gave them (access-neutral).');
    return;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  for (const f of atRisk) {
    await db.collection('families').doc(f.id).set(
      { isFoundingFamily: true, foundingBackfilledAt: now, foundingBackfilledBy: 'backfill-founding-script' },
      { merge: true },
    );
    console.log(`  ✓ stamped ${f.id} "${f.name}" → isFoundingFamily:true`);
  }
  console.log(`\nDone. ${atRisk.length} family(ies) grandfathered. The DEFAULT_TIER_FALLBACK flip is now safe.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
