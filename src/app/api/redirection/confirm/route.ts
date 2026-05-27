// Household → Wealth · Confirm a redirection (cancel subs + create
// investment stub).
//
// POST { ConfirmRedirectionInput } → atomically:
//   1. Cancel each sub in cancelSubIds (status='cancelled', archivedAt)
//   2. Create /families/{f}/investments/{newId} with sourceAdvisoryId
//      pointing back to the originating advisory
//   3. Mark the advisory acted (status='acted', actedAt, actedBy,
//      resultingInvestmentId)
//
// Per spec §8 — this is the ONLY path by which Household spend data
// writes into Wealth as an asset/liability line. The cron writes only
// advisories; the user confirming an advisory is what triggers the
// actual asset write.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Body {
  familyId?: string;
  advisoryId?: string;
  destinationType?: 'index_fund' | 'savings' | 'custom';
  destinationLabel?: string;
  monthlyContributionCents?: number;
  cancelSubIds?: string[];
  confirmedByUid?: string;
}

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const required = ['familyId', 'advisoryId', 'destinationType',
                    'monthlyContributionCents', 'cancelSubIds', 'confirmedByUid'] as const;
  for (const k of required) {
    if (body[k] == null) return NextResponse.json({ error: `missing: ${k}` }, { status: 400 });
  }
  if (!Array.isArray(body.cancelSubIds) || body.cancelSubIds.length === 0) {
    return NextResponse.json({ error: 'cancelSubIds-must-have-at-least-one' }, { status: 400 });
  }

  const famRef       = db.collection('families').doc(body.familyId!);
  const advisoryRef  = famRef.collection('wealth_advisories').doc(body.advisoryId!);
  const investmentRef = famRef.collection('investments').doc();  // auto-id
  const now = Timestamp.now();

  try {
    await db.runTransaction(async (tx) => {
      // Verify the advisory is still open before acting
      const advSnap = await tx.get(advisoryRef);
      if (!advSnap.exists) throw new Error('advisory-not-found');
      if (advSnap.data()!.status !== 'open') throw new Error('advisory-not-open');

      // Cancel each sub
      for (const subId of body.cancelSubIds!) {
        const subRef = famRef.collection('subscriptions').doc(subId);
        tx.update(subRef, {
          status: 'cancelled',
          archivedAt: now,
          updatedAt: now,
          endedOn: now,
        });
      }

      // Create the investment stub. Schema is intentionally light here
      // — Kaya Wealth's full investment model isn't built yet (the
      // /wealth route is a stub). This minimal shape gives the advisor
      // a real artifact to point at, and Wealth can flesh it out when
      // its UI lands.
      tx.set(investmentRef, {
        sourceAdvisoryId: body.advisoryId!,
        sourceModule: 'household_redirection',
        destinationType: body.destinationType!,
        destinationLabel: body.destinationLabel ?? null,
        monthlyContribution: body.monthlyContributionCents!,
        cancelledSubIds: body.cancelSubIds!,
        startedOn: now,
        createdBy: body.confirmedByUid!,
        createdAt: now,
      });

      // Mark advisory acted
      tx.update(advisoryRef, {
        status: 'acted',
        actedAt: now,
        actedBy: body.confirmedByUid!,
        resultingInvestmentId: investmentRef.id,
      });
    });
  } catch (e) {
    const msg = (e as Error).message || 'write-failed';
    if (msg === 'advisory-not-found' || msg === 'advisory-not-open') {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    console.error('[redirection/confirm] transaction failed:', e);
    return NextResponse.json({ error: 'write-failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, investmentId: investmentRef.id });
}

export async function POST(req: NextRequest) { return run(req); }
