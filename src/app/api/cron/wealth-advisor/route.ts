// Household → Wealth advisor (daily cron, 06:00 EAT).
//
// Scans every family's active subscriptions for "unused" candidates
// (no updatedAt activity in 60+ days) and writes one advisory per
// family bundling the candidates with the potential annual saving.
// Spec §8: spend data flows UP only as ADVISORY signals — never
// auto-promotes to a Wealth asset. The user acts via
// /api/redirection/confirm to actually cancel + create an investment.
//
// Auth: standard CRON_SECRET bearer.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const UNUSED_DAYS = 60;
const ADVISORY_TTL_DAYS = 30;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-not-configured' });

  const now = Timestamp.now();
  const unusedCutoff = Timestamp.fromMillis(now.toMillis() - UNUSED_DAYS * 86_400_000);
  const expiresAt   = Timestamp.fromMillis(now.toMillis() + ADVISORY_TTL_DAYS * 86_400_000);

  let familiesScanned = 0;
  let advisoriesWritten = 0;

  try {
    const families = await db.collection('families').get();
    for (const fam of families.docs) {
      familiesScanned += 1;
      const familyId = fam.id;

      // Candidates: active subs not touched in UNUSED_DAYS.
      // collectionGroup is overkill here (already scoping per family);
      // the per-family subcollection read is cheaper.
      const subsSnap = await db.collection('families').doc(familyId)
        .collection('subscriptions')
        .where('status', '==', 'active')
        .get();

      const candidates = subsSnap.docs.filter((d) => {
        const data = d.data();
        const lastTouched = (data.updatedAt as Timestamp | undefined) ?? (data.createdAt as Timestamp | undefined);
        if (!lastTouched) return false;
        return lastTouched.toMillis() < unusedCutoff.toMillis();
      });

      if (candidates.length === 0) continue;

      const annualSaving = candidates.reduce((sum, d) => {
        const monthly = (d.data().monthlyEquivalent as number | undefined) ?? 0;
        return sum + monthly * 12;
      }, 0);

      // De-dupe: if an open redirection_opportunity already exists, skip
      // (we don't want to write a fresh one every day).
      const existingSnap = await db.collection('families').doc(familyId)
        .collection('wealth_advisories')
        .where('status', '==', 'open')
        .where('type', '==', 'redirection_opportunity')
        .limit(1)
        .get();
      if (!existingSnap.empty) continue;

      await db.collection('families').doc(familyId)
        .collection('wealth_advisories')
        .add({
          type: 'redirection_opportunity',
          title: `${candidates.length} subscription${candidates.length === 1 ? '' : 's'} look unused`,
          body: `No activity on ${candidates.length} active subscription${candidates.length === 1 ? '' : 's'} in the last ${UNUSED_DAYS} days. Cancelling and redirecting could free up money for investing.`,
          detectedAt: now,
          candidateSubIds: candidates.map((d) => d.id),
          potentialAnnualSaving: annualSaving,
          suggestedDestination: 'index_fund',
          status: 'open',
          actedAt: null,
          actedBy: null,
          resultingInvestmentId: null,
          expiresAt,
        });
      advisoriesWritten += 1;
    }
  } catch (e) {
    console.error('[cron/wealth-advisor] scan failed:', e);
    return NextResponse.json({ error: 'scan-failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    familiesScanned,
    advisoriesWritten,
  });
}

export async function GET(req: NextRequest)  { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
