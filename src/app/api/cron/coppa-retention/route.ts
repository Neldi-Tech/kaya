// Kaya · Max-Privacy Mode — child-session retention sweep.
//
// Max-Privacy Mode keeps a CHILD's footprint on a short leash: a kid-login
// session record (childSessions/{id}) is deleted CHILD_LOG_RETENTION_DAYS
// (30) days after it was created. This cron is the enforcement — disclosure
// of "30-day rolling deletion" is only honest if something actually deletes.
//
// Admin SDK only (bypasses rules); secured by CRON_SECRET when set; no-ops
// cleanly before configuration. Scheduled in vercel.json. The query is a
// single-field range on createdAt, so it needs no composite index.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { CHILD_LOG_RETENTION_DAYS } from '@/lib/coppa/constants';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const BATCH = 400; // under Firestore's 500-write batch ceiling

export async function POST(req: NextRequest) {
  return run(req);
}
export async function GET(req: NextRequest) {
  return run(req);
}

async function run(req: NextRequest) {
  // Auth: enforce CRON_SECRET when configured (Vercel sends it as a Bearer
  // token). If unset, allow (pre-configuration / manual test).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = getAdminFirestore();
  if (!db) {
    return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });
  }

  const cutoff = new Date(Date.now() - CHILD_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  let deleted = 0;
  // Page through expired sessions in batches until none remain.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await db
      .collection('childSessions')
      .where('createdAt', '<', cutoff)
      .limit(BATCH)
      .get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    deleted += snap.size;

    if (snap.size < BATCH) break; // last page
  }

  return NextResponse.json({
    ok: true,
    deleted,
    retentionDays: CHILD_LOG_RETENTION_DAYS,
    cutoff: cutoff.toISOString(),
  });
}
