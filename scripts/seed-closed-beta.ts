#!/usr/bin/env tsx
/**
 * scripts/seed-closed-beta.ts
 *
 * Seeds the closed-beta access-control collections (2026-05-24):
 *   - config/beta        { publicSignupOpen:false, autoAdmit:false }  (only if absent)
 *   - operators/{email}  Elia (owner) + Diana (operator)
 *   - allowlist/{email}  Elia + Diana (so they can spin up a test family)
 *
 * Emails are resolved from UIDs via Admin Auth — never hardcoded. Doc ids
 * are the lowercased email, matching the email gate in firestore.rules.
 *
 * Additive + idempotent: no behavioural effect until the new rules deploy.
 * config/beta is created only if missing, so a re-run never re-closes a
 * launched signup.
 *
 * USAGE
 *   ELIA_UID=<uid> DIANA_UID=<uid> \
 *     GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/kaya-sa.json \
 *     npx tsx scripts/seed-closed-beta.ts --commit
 *
 * Without --commit it prints the plan (dry-run) and writes nothing.
 */

const ELIA_UID = process.env.ELIA_UID;
const DIANA_UID = process.env.DIANA_UID;
const COMMIT = process.argv.includes('--commit');

async function main() {
  if (!ELIA_UID) { console.error('Set ELIA_UID (the owner).'); process.exit(1); }

  const projectId = process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463';
  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
  }
  const db = admin.firestore();
  const auth = admin.auth();
  const norm = (e: string) => e.trim().toLowerCase();

  // Resolve emails from the known parent UIDs.
  const eliaUser = await auth.getUser(ELIA_UID);
  const eliaEmail = eliaUser.email ? norm(eliaUser.email) : null;
  if (!eliaEmail) { console.error(`ELIA_UID ${ELIA_UID} has no email on its auth record.`); process.exit(1); }

  let dianaEmail: string | null = null;
  if (DIANA_UID) {
    const dianaUser = await auth.getUser(DIANA_UID);
    dianaEmail = dianaUser.email ? norm(dianaUser.email) : null;
  }

  const operators = [
    { email: eliaEmail, role: 'owner' as const },
    ...(dianaEmail ? [{ email: dianaEmail, role: 'operator' as const }] : []),
  ];

  console.log('Plan:');
  console.log('  config/beta = { publicSignupOpen:false, autoAdmit:false }  (only if absent)');
  for (const op of operators) console.log(`  operators/${op.email} = ${op.role}`);
  for (const op of operators) console.log(`  allowlist/${op.email}`);

  if (!COMMIT) {
    console.log('\nDry-run (pass --commit to write). Nothing written.');
    return;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  const betaRef = db.collection('config').doc('beta');
  const betaSnap = await betaRef.get();
  if (!betaSnap.exists) {
    await betaRef.set({ publicSignupOpen: false, autoAdmit: false, updatedAt: now, updatedBy: 'seed' });
    console.log('· config/beta created (closed)');
  } else {
    console.log('· config/beta already exists — left as-is');
  }

  for (const op of operators) {
    await db.collection('operators').doc(op.email).set(
      { email: op.email, role: op.role, addedAt: now, addedBy: 'seed' },
      { merge: true },
    );
    await db.collection('allowlist').doc(op.email).set(
      { email: op.email, addedAt: now, addedBy: 'seed' },
      { merge: true },
    );
    console.log(`· ${op.email} → operator(${op.role}) + allowlist`);
  }

  console.log('\nDone. Operator access is live at the DB level — usable once the new rules + app deploy.');
}

main().catch((e) => { console.error(e); process.exit(1); });
