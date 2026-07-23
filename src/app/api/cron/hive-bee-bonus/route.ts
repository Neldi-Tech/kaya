// 🐝 Bee Bonus — weekly interest on the banked Honey Pot (CASH UPGRADE §5).
//
// Runs every Sunday morning. For every family with hiveConfig.beeBonus
// enabled, each kid's Pot grows by weeklyRatePct% (capped per week when a
// cap is set). Idempotent: the ledger row uses the deterministic id
// `bee-{runDateKey}` per kid, so a re-run (or manual trigger) can never
// double-pay a week. Admin SDK throughout — no firestore-rules change.
// Secured by CRON_SECRET when set (Vercel sends it as a Bearer token).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  // One key per run day — the cron fires Sundays, so this is the week key.
  const runKey = new Date().toISOString().slice(0, 10);

  const families = await db.collection('families').limit(500).get();
  let paid = 0; let skipped = 0; let errors = 0;

  for (const fam of families.docs) {
    try {
      const bee = fam.data()?.hiveConfig?.beeBonus as
        | { enabled?: boolean; weeklyRatePct?: number; capCents?: number }
        | undefined;
      const rate = Number(bee?.weeklyRatePct) || 0;
      if (!bee?.enabled || rate <= 0) { skipped += 1; continue; }
      const cap = Number(bee?.capCents) || 0;

      const kids = await db.collection(`families/${fam.id}/kids`).listDocuments();
      for (const kidRef of kids) {
        try {
          const walletRef = kidRef.collection('wallet').doc('balances');
          const txRef = kidRef.collection('hiveTransactions').doc(`bee-${runKey}`);
          await db.runTransaction(async (tx) => {
            const [walletSnap, txSnap] = await Promise.all([tx.get(walletRef), tx.get(txRef)]);
            if (txSnap.exists) return; // already paid this week
            if (!walletSnap.exists) return;
            const pot = Number(walletSnap.data()?.treasuryCents) || 0;
            let bonus = Math.floor((pot * rate) / 100);
            if (cap > 0) bonus = Math.min(bonus, cap);
            if (bonus < 1) return;
            tx.update(walletRef, {
              treasuryCents: FieldValue.increment(bonus),
              totalLifetimeEarnedCents: FieldValue.increment(bonus),
              updatedAt: FieldValue.serverTimestamp(),
            });
            tx.set(txRef, {
              layer: 'treasury', direction: 'in', amount: bonus,
              category: 'interest',
              description: `🐝 Bee Bonus — your honey grew! (${rate}% of your Pot)`,
              status: 'completed',
              createdBy: 'bee-bonus-cron', approvedBy: 'auto',
              createdAt: FieldValue.serverTimestamp(),
              completedAt: FieldValue.serverTimestamp(),
            });
            paid += 1;
          });
        } catch (e) {
          errors += 1;
          console.error(`bee-bonus: kid ${kidRef.path} failed`, e);
        }
      }
    } catch (e) {
      errors += 1;
      console.error(`bee-bonus: family ${fam.id} failed`, e);
    }
  }

  return NextResponse.json({ ok: true, runKey, paid, skipped, errors });
}
