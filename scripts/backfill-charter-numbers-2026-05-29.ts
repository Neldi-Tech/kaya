#!/usr/bin/env tsx
/**
 * scripts/backfill-charter-numbers-2026-05-29.ts
 *
 * One-time backfill for Charter serials (CF-###). The closed-beta
 * "Charter Family" crew (the first FOUNDING_FAMILY_LIMIT families,
 * isFoundingFamily === true) get a `charterNumber` = their join ordinal.
 *
 * Going forward createFamily() stamps charterNumber = newCount at creation;
 * this script fills in the families that pre-date that stamp.
 *
 * Ordering: by createdAt ascending. familyCount is monotonic (createFamily
 * only ever increments it, never decrements), so createdAt order reproduces
 * each family's original join position. Numbering is gapless 1..N over the
 * founding crew.
 *
 * Idempotent: only writes a family whose stored charterNumber differs from
 * the computed one. Re-running once values are correct is a no-op.
 *
 * USAGE
 *   # dry-run (prints the plan, writes nothing)
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/backfill-charter-numbers-2026-05-29.ts
 *
 *   # commit
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/backfill-charter-numbers-2026-05-29.ts --commit
 */

import * as admin from 'firebase-admin';

const FOUNDING_FAMILY_LIMIT = 100; // mirror of src/lib/referral.ts
const commitMode = process.argv.includes('--commit');

function createdAtMs(v: unknown): number {
  if (v && typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return Number.MAX_SAFE_INTEGER; // missing timestamps sort last
}

async function main() {
  console.log(`Mode: ${commitMode ? 'COMMIT' : 'DRY-RUN'}`);

  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463',
      });
    } catch (e) {
      console.error('Credential init failed. Set GOOGLE_APPLICATION_CREDENTIALS or run `gcloud auth application-default login`.');
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  const db = admin.firestore();

  // Scan all families, filter the Charter crew in memory (no composite
  // index needed for a one-off over a small closed-beta dataset).
  const snap = await db.collection('families').get();
  const founders = snap.docs
    .filter((d) => (d.data() as { isFoundingFamily?: boolean }).isFoundingFamily === true)
    .map((d) => ({
      id: d.id,
      ref: d.ref,
      name: (d.data() as { name?: string }).name ?? '(unnamed)',
      createdMs: createdAtMs((d.data() as { createdAt?: unknown }).createdAt),
      current: (d.data() as { charterNumber?: number }).charterNumber,
    }))
    .sort((a, b) => a.createdMs - b.createdMs);

  console.log(`Charter Families found: ${founders.length} (limit ${FOUNDING_FAMILY_LIMIT})\n`);
  if (founders.length > FOUNDING_FAMILY_LIMIT) {
    console.warn(`⚠️  More founding families than the limit — numbering all by createdAt anyway.\n`);
  }

  let changes = 0;
  for (let i = 0; i < founders.length; i++) {
    const f = founders[i];
    const computed = i + 1; // gapless 1..N by join order
    const serial = `CF-${String(computed).padStart(3, '0')}`;
    if (f.current === computed) {
      console.log(`  ${serial}  ${f.name}  (already set)`);
      continue;
    }
    changes++;
    console.log(`  ${serial}  ${f.name}  ${f.current === undefined ? '(new)' : `(was ${f.current})`}`);
    if (commitMode) await f.ref.update({ charterNumber: computed });
  }

  console.log(`\n${commitMode ? 'Committed' : 'Would change'}: ${changes} family/families.`);
  if (!commitMode) console.log('Re-run with --commit to write.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
