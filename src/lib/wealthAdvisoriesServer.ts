// Kaya Wealth · advisory generation — server-only (Phase 2 · PR7 · 2026-06-01).
//
// Reads the family's wealth (Savings Queue + assets) and writes advisory
// cards (Admin SDK; clients can't create them). Advisories never MOVE money —
// they only suggest. The user must confirm any promotion (funnel integrity).
// Auto-generated open cards are regenerated each refresh; acted/dismissed
// cards (and any non-auto ones) are left untouched.

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from './firebaseAdmin';

interface NewAdvisory {
  kind: string;
  title: string;
  body: string;
  amountCents?: number;
  currency?: string;
  ctaLabel?: string;
  assetId?: string;
  visibility: 'shared' | 'personal';
}

export async function refreshAdvisories(familyId: string, householdCurrency: string): Promise<{ created: number }> {
  const db = getAdminFirestore();
  if (!db) throw new Error('admin-not-configured');
  const famRef = db.collection('families').doc(familyId);
  const advCol = famRef.collection('wealth_advisories');

  const [savingsSnap, assetsSnap, openSnap] = await Promise.all([
    famRef.collection('wealth_config').doc('savings').get(),
    famRef.collection('wealth_assets').get(),
    advCol.where('status', '==', 'open').get(),
  ]);

  const out: NewAdvisory[] = [];

  // 1. Savings Queue ready to invest.
  const sharedQueue = (savingsSnap.data() as { sharedCents?: number } | undefined)?.sharedCents ?? 0;
  if (sharedQueue >= 50_000) { // ≥ 500 major units
    out.push({
      kind: 'promote_queue', visibility: 'shared',
      title: 'Your Savings Queue is ready to invest',
      body: 'Money set aside in the queue is sitting idle. Promote it into an investment to put it to work — only when you confirm.',
      amountCents: sharedQueue, currency: householdCurrency, ctaLabel: 'Promote to investment',
    });
  }

  // 2. Maturing shared assets.
  assetsSnap.forEach((d) => {
    const a = d.data() as { name?: string; visibility?: string; archivedAt?: unknown; meta?: { maturityNote?: string } };
    if (a.archivedAt || a.visibility !== 'shared' || !a.meta?.maturityNote) return;
    out.push({
      kind: 'maturing', visibility: 'shared',
      title: `${a.name ?? 'An asset'} is maturing`,
      body: `${a.meta.maturityNote}. Consider rolling it into a higher-yield holding when it matures.`,
      ctaLabel: 'Review asset', assetId: d.id,
    });
  });

  const batch = db.batch();
  openSnap.forEach((d) => { if ((d.data() as { auto?: boolean }).auto) batch.delete(d.ref); });
  for (const a of out) {
    batch.set(advCol.doc(), { ...a, status: 'open', auto: true, createdAt: Timestamp.now() });
  }
  await batch.commit();
  return { created: out.length };
}
