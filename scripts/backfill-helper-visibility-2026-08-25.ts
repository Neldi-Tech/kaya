#!/usr/bin/env tsx
/**
 * scripts/backfill-helper-visibility-2026-08-25.ts
 *
 * 🤝 One-shot: stamp `helperListed` on every helper's user doc.
 *
 * WHY
 *   Communication surfaces (chat pickers, @mentions, reminder
 *   recipients, album access, award emails…) now list a helper only
 *   when `users/{uid}.helperListed !== false`. The verdict is derived
 *   from the parent-controlled HelperLink:
 *
 *       listed  ⇔  status === 'active'  AND  kidIds.length > 0
 *
 *   Kids cannot read HelperLink docs (rules gate them to parents +
 *   the helper themselves — they carry the readable helper password),
 *   which is why the flag is mirrored onto the family-readable user
 *   doc in the first place.
 *
 *   Missing flag reads as "listed" (fail-open), so until this runs a
 *   family keeps the OLD over-populated behaviour — nothing breaks,
 *   it just doesn't thin out. This sweep brings every existing family
 *   current in one pass. /api/helpers/visibility does the same thing
 *   per-family whenever a parent opens Settings → Helpers.
 *
 *   Idempotent: only writes when the stored value actually differs.
 *   NON-DESTRUCTIVE — adds one boolean field, touches nothing else.
 *
 * USAGE
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/backfill-helper-visibility-2026-08-25.ts           # dry-run
 *     npx tsx scripts/backfill-helper-visibility-2026-08-25.ts --commit  # write
 *   Optional: FAMILY_ID=… to limit the sweep to one family.
 */

import * as admin from 'firebase-admin';

const commit = process.argv.includes('--commit');
const ONLY_FAMILY = process.env.FAMILY_ID || null;

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

/** The one rule. Mirrors lib/helperVisibility.ts → helperIsListed. */
function isListed(link: { status?: string; kidIds?: unknown }): boolean {
  if (link.status !== 'active') return false;
  return Array.isArray(link.kidIds) && link.kidIds.length > 0;
}

async function main() {
  console.log(`\n🤝 Helper visibility backfill — ${commit ? 'COMMIT' : 'DRY RUN'}`);
  if (ONLY_FAMILY) console.log(`   scoped to family ${ONLY_FAMILY}`);

  const families = ONLY_FAMILY
    ? [await db.collection('families').doc(ONLY_FAMILY).get()]
    : (await db.collection('families').get()).docs;

  let fam = 0, checked = 0, changed = 0, skipped = 0;

  for (const f of families) {
    if (!f.exists) continue;
    fam += 1;
    const helpers = await f.ref.collection('helpers').get();
    if (helpers.empty) continue;

    for (const h of helpers.docs) {
      const link = h.data() as { status?: string; kidIds?: unknown; displayName?: string };
      const listed = isListed(link);
      const userRef = db.collection('users').doc(h.id);
      const snap = await userRef.get();
      const u = snap.data() as { familyId?: string; role?: string; helperListed?: boolean } | undefined;

      // Guard: never rewrite a doc that isn't this family's helper.
      if (!snap.exists || u?.familyId !== f.id || u?.role !== 'helper') { skipped += 1; continue; }
      checked += 1;
      if (u.helperListed === listed) continue;

      const kidCount = Array.isArray(link.kidIds) ? link.kidIds.length : 0;
      console.log(
        `   ${listed ? '✅ list  ' : '🚫 hide  '} ${(link.displayName || h.id).padEnd(22)}` +
        ` status=${String(link.status).padEnd(8)} kids=${kidCount}  (${f.id})`,
      );
      changed += 1;
      if (commit) await userRef.update({ helperListed: listed });
    }
  }

  console.log(
    `\n   families ${fam} · helper links checked ${checked} · ` +
    `${commit ? 'written' : 'would write'} ${changed} · skipped ${skipped}\n`,
  );
  if (!commit && changed > 0) console.log('   Re-run with --commit to apply.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
