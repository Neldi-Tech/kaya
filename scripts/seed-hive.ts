/**
 * scripts/seed-hive.ts
 *
 * Seeds The Hive sub-tree for one kid so the new screens feel populated in
 * local dev. Idempotent at the wallet level (won't double-credit) but
 * creates fresh ledger entries each run — re-run sparingly.
 *
 * Usage:
 *   FAMILY_ID=<familyDocId> KID_ID=<childDocId> npx tsx scripts/seed-hive.ts
 *
 * Prereqs:
 *   - You must be authenticated to Firestore through the same app
 *     credentials this script imports from `src/lib/firebase`. The
 *     simplest path is to run it from a browser console or an Emulator.
 *     This file is structured as TS so it can also be wrapped in a small
 *     Next.js admin route later if we want a "Seed Hive" button.
 */

import {
  collection, doc, getDoc, setDoc, addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '../src/lib/firebase';
import {
  Wallet, EMPTY_WALLET, DEFAULT_HIVE_CONFIG,
} from '../src/lib/hive';

const FAMILY_ID = process.env.FAMILY_ID;
const KID_ID = process.env.KID_ID;

if (!FAMILY_ID || !KID_ID) {
  console.error('Set FAMILY_ID and KID_ID env vars.');
  process.exit(1);
}

async function main() {
  // 1) Ensure the family doc has a hiveConfig.
  const famRef = doc(db, 'families', FAMILY_ID!);
  const famSnap = await getDoc(famRef);
  if (!famSnap.exists()) throw new Error(`Family ${FAMILY_ID} not found.`);
  await setDoc(famRef, { hiveConfig: DEFAULT_HIVE_CONFIG }, { merge: true });
  console.log('· hiveConfig set');

  // 2) Wallet — v3 cash split: HP=1240, Honey=85, Cash $42.50
  //    ($30.00 on hand · $12.50 in safekeeping).
  const walletRef = doc(db, 'families', FAMILY_ID!, 'kids', KID_ID!, 'wallet', 'balances');
  const seedWallet: Wallet = {
    ...EMPTY_WALLET,
    housePoints: 1240,
    honeyCoins: 85,
    cashOnHandCents: 3000,
    cashOnDepositCents: 1250,
    totalLifetimeEarnedCents: 8500,
    totalLifetimeSpentCents: 3200,
  };
  await setDoc(walletRef, { ...seedWallet, updatedAt: serverTimestamp() });
  console.log('· wallet seeded · HP 1240 · 🍯 85 · Cash $42.50 ($30 on hand · $12.50 safekept)');

  // 3) Ledger — a small mix across all three layers, last 4 weeks.
  const txCol = collection(db, 'families', FAMILY_ID!, 'kids', KID_ID!, 'hiveTransactions');
  const sample = [
    { layer: 'cash',  direction: 'in',  amount: 1000, category: 'allowance', description: 'Weekly allowance from Mom', daysAgo: 1 },
    { layer: 'cash',  direction: 'in',  amount: 2500, category: 'gift',      description: 'Birthday gift from Auntie Sarah', daysAgo: 9 },
    { layer: 'cash',  direction: 'in',  amount: 1500, category: 'convert',   description: 'From 15 🍯', daysAgo: 15 },
    { layer: 'cash',  direction: 'out', amount: 1200, category: 'spend',     description: 'Book: Wings of Fire', daysAgo: 5 },
    { layer: 'cash',  direction: 'out', amount: 800,  category: 'spend',     description: 'Ice cream outing', daysAgo: 7 },
    { layer: 'cash',  direction: 'out', amount: 1200, category: 'donation',  description: 'Donation — animal shelter', daysAgo: 13 },
    { layer: 'honey', direction: 'in',  amount: 30,   category: 'convert',   description: 'From 3000 HP', daysAgo: 12 },
    { layer: 'honey', direction: 'out', amount: 15,   category: 'convert',   description: 'Cashed out 15 🍯', daysAgo: 15 },
    { layer: 'house_points', direction: 'in', amount: 50, category: 'chore', description: 'Morning routine — perfect score', daysAgo: 2 },
    { layer: 'house_points', direction: 'in', amount: 20, category: 'award', description: 'Helping with groceries', daysAgo: 3 },
  ];
  for (const s of sample) {
    const ts = new Date(Date.now() - s.daysAgo * 86400000);
    await addDoc(txCol, {
      ...s, status: 'completed', createdAt: ts, completedAt: ts,
      createdBy: 'seed', approvedBy: 'seed',
    });
  }
  console.log(`· ${sample.length} ledger entries written`);

  // 4) Goals — bike at 62%, headphones at 28% (matches the v2 mockup).
  const goalCol = collection(db, 'families', FAMILY_ID!, 'kids', KID_ID!, 'goals');
  await addDoc(goalCol, {
    title: 'New bike', icon: '🚲', layer: 'cash',
    targetAmount: 12000, currentAmount: 7440,
    status: 'active', createdAt: serverTimestamp(),
  });
  await addDoc(goalCol, {
    title: 'Headphones', icon: '🎧', layer: 'cash',
    targetAmount: 5000, currentAmount: 1400,
    status: 'active', createdAt: serverTimestamp(),
  });
  console.log('· 2 goals written');

  // 5) One pending cash-out request (matches the v2 mockup spend card).
  const reqCol = collection(db, 'families', FAMILY_ID!, 'approvalRequests');
  await addDoc(reqCol, {
    kidId: KID_ID, type: 'spend', amountCents: 2499, category: 'spend',
    description: 'Lego City set from the toy store',
    status: 'pending', createdAt: serverTimestamp(),
    createdBy: KID_ID,
  });
  console.log('· 1 pending spend request');

  console.log('\nDone. Open /hive in the app.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
