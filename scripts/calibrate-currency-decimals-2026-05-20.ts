#!/usr/bin/env tsx
/**
 * scripts/calibrate-currency-decimals-2026-05-20.ts
 *
 * One-time calibration. Two clean-ups, idempotent (re-running once values
 * are clean is a no-op):
 *
 *   1. INVOICES — for families on a zero-decimal currency (KES, TZS, UGX,
 *      ZAR, NGN, INR) strip the meaningless sub-unit "cents" out of EVERY
 *      purchase request, including approved & closed ones. An item entered
 *      as KSh 50.50 (stored 5050) becomes KSh 51 (5100); the request
 *      totals (estimatedTotalCents / actualTotalCents) are rounded to whole
 *      units the same way. We round the stored figures in place — we never
 *      re-derive a total from items, so a recorded receipt total is only
 *      cleaned, never changed by recomputation.
 *
 *   2. BUDGET CAPS — neaten householdBudgets caps to the nearest budget
 *      bucket (nearest 10 / 100 / 1000 by magnitude), for ALL currencies,
 *      matching what the budget composer now writes going forward.
 *
 * The decimal map + rounding here MUST mirror src/lib/hive.ts (CURRENCIES
 * .decimals) and src/lib/format.ts (roundNeatCents / roundToWholeUnitCents).
 *
 * USAGE
 *   # one family (dry-run, then commit)
 *   FAMILY_ID=... GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/calibrate-currency-decimals-2026-05-20.ts
 *   FAMILY_ID=... GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/calibrate-currency-decimals-2026-05-20.ts --commit
 *
 *   # every family (omit FAMILY_ID)
 *   GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/calibrate-currency-decimals-2026-05-20.ts --commit
 */

import * as admin from 'firebase-admin';

const FAMILY_ID = process.env.FAMILY_ID; // optional — all families if unset
const commitMode = process.argv.includes('--commit');

// Currencies with NO meaningful sub-unit — mirror of src/lib/hive.ts.
const ZERO_DECIMAL = new Set(['TZS', 'KES', 'UGX', 'ZAR', 'NGN', 'INR']);
function currencyDecimals(code: string): number {
  return ZERO_DECIMAL.has(code) ? 0 : 2;
}

/** Drop sub-unit cents: 5050 → 5100, 5040 → 5000. */
function roundToWholeUnitCents(cents: number): number {
  if (!Number.isFinite(cents)) return 0;
  return Math.round(cents / 100) * 100;
}

/** Nearest neat budget bucket (10/100/1000 by magnitude). */
function roundNeatCents(cents: number): number {
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  const display = cents / 100;
  let bucket: number;
  if (display < 1000) bucket = 10;
  else if (display < 100000) bucket = 100;
  else bucket = 1000;
  const bucketCents = bucket * 100;
  return Math.round(cents / bucketCents) * bucketCents;
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

  const familyIds: string[] = [];
  if (FAMILY_ID) {
    familyIds.push(FAMILY_ID);
  } else {
    const snap = await db.collection('families').get();
    snap.forEach((d) => familyIds.push(d.id));
  }
  console.log(`Families to scan: ${familyIds.length}\n`);

  let capChanges = 0;
  let itemChanges = 0;
  let reqChanges = 0;

  for (const fid of familyIds) {
    const famRef = db.collection('families').doc(fid);
    const famSnap = await famRef.get();
    const fam = famSnap.data() as Record<string, unknown> | undefined;
    if (!fam) continue;
    const currency = (fam.currency as string) || 'USD';
    const dec = currencyDecimals(currency);
    console.log(`Family ${fid} — ${currency} (${dec} dp)`);

    // 1. Budget caps → nearest neat bucket (all currencies).
    const budgets = (fam.householdBudgets as Record<string, unknown>) || {};
    const capPatch: Record<string, number> = {};
    for (const [key, val] of Object.entries(budgets)) {
      if (typeof val !== 'number') continue;
      const neat = roundNeatCents(val);
      if (neat !== val) {
        capPatch[`householdBudgets.${key}`] = neat;
        capChanges++;
        console.log(`  cap ${key}: ${val} → ${neat}`);
      }
    }
    if (Object.keys(capPatch).length && commitMode) {
      await famRef.update(capPatch);
    }

    // 2. Purchase requests → strip sub-unit decimals (zero-decimal only).
    if (dec === 0) {
      const reqSnap = await famRef.collection('purchaseRequests').get();
      for (const reqDoc of reqSnap.docs) {
        const r = reqDoc.data() as Record<string, unknown>;
        const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]) : [];
        const patch: Record<string, unknown> = {};
        let localItemChanges = 0;

        const newItems = items.map((it) => {
          const next = { ...it };
          for (const field of ['estimatedCents', 'actualCents'] as const) {
            const v = it[field];
            if (typeof v === 'number') {
              const w = roundToWholeUnitCents(v);
              if (w !== v) {
                next[field] = w;
                localItemChanges++;
              }
            }
          }
          return next;
        });
        if (localItemChanges > 0) patch.items = newItems;

        for (const field of ['estimatedTotalCents', 'actualTotalCents'] as const) {
          const v = r[field];
          if (typeof v === 'number') {
            const w = roundToWholeUnitCents(v);
            if (w !== v) patch[field] = w;
          }
        }

        if (Object.keys(patch).length > 0) {
          reqChanges++;
          itemChanges += localItemChanges;
          console.log(
            `  req ${reqDoc.id} [${(r.status as string) ?? '?'}]: ` +
            `${localItemChanges} item price(s)` +
            (patch.estimatedTotalCents !== undefined ? `, est ${r.estimatedTotalCents}→${patch.estimatedTotalCents}` : '') +
            (patch.actualTotalCents !== undefined ? `, act ${r.actualTotalCents}→${patch.actualTotalCents}` : ''),
          );
          if (commitMode) await reqDoc.ref.update(patch);
        }
      }
    }
  }

  console.log(
    `\n${commitMode ? 'Committed' : 'Would change'}: ` +
    `${capChanges} cap(s), ${reqChanges} request(s) (${itemChanges} item price(s)).`,
  );
  if (!commitMode) console.log('Re-run with --commit to write.');
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
