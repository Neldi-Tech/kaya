// Kaya Games — hourly Question-of-the-Day rotation cron (2026-07-19).
//
// THE fix for "same question every day": the daily question now rotates
// SERVER-SIDE, guaranteed, instead of waiting for a family member to
// freshly open My Day. Runs hourly at :05; each run rotates any family
// whose qotd doc isn't on today's (local) date yet — so the switch lands
// within the hour after local midnight, whatever the timezone maths.
//
// Only families that have used QotD at least once are rotated (the
// client-side ensure covers a family's very first question). Secured by
// CRON_SECRET when set (Vercel sends it as a Bearer token). Admin SDK —
// no Firestore-rules change.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { dayKeyInTZ } from '@/lib/dates';
import { rotateQotdForFamily, QOTD_TZ } from '@/lib/qotdServer';

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

  const today = dayKeyInTZ(new Date(), QOTD_TZ);
  const families = await db.collection('families').select().limit(500).get();

  let rotated = 0; let fresh = 0; let skipped = 0; let errors = 0;
  for (const f of families.docs) {
    const outcome = await rotateQotdForFamily(db, f.id, today, { onlyIfExists: true });
    if (outcome === 'rotated') rotated += 1;
    else if (outcome === 'fresh') fresh += 1;
    else if (outcome === 'skipped') skipped += 1;
    else errors += 1;
  }

  return NextResponse.json({ ok: true, today, families: families.size, rotated, fresh, skipped, errors });
}
