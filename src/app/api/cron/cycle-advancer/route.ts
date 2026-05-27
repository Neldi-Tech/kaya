// Household · Subscription cycle advancer (daily cron).
//
// Runs once a day to:
//   1. For each Manual cycle past its dueDate without a payment →
//      promote status 'upcoming'/'due' → 'overdue'.
//   2. (Reminder delivery — pre-due push / WhatsApp share — is a
//      follow-up: this PR ships the state machine + the post-due UI;
//      the reminder dispatch wires into Kaya's existing notification
//      system next.)
//
// Auth: standard CRON_SECRET bearer (matches the pulse-* + business-*
// crons). Vercel sends a GET; we also accept POST.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function run(req: NextRequest) {
  // CRON_SECRET gate (matches the other Kaya crons)
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
  let promotedOverdue = 0;
  let scanned = 0;

  try {
    // Walk every family's cycles via collection group. The composite
    // index (cycles collectionGroup, status ASC, dueDate ASC) is declared
    // in firestore.indexes.json from P1.
    const dueSnap = await db.collectionGroup('cycles')
      .where('status', 'in', ['upcoming', 'due'])
      .where('dueDate', '<', now)
      .get();

    scanned = dueSnap.size;
    const batch = db.batch();
    for (const doc of dueSnap.docs) {
      batch.update(doc.ref, { status: 'overdue' });
      promotedOverdue += 1;
    }
    if (promotedOverdue > 0) await batch.commit();
  } catch (e) {
    console.error('[cron/cycle-advancer] scan failed:', e);
    return NextResponse.json({ error: 'scan-failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned,
    promotedOverdue,
    note: 'Reminder dispatch + Auto-sub nextBillingDate roll lands in a follow-up.',
  });
}

export async function GET(req: NextRequest)  { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
