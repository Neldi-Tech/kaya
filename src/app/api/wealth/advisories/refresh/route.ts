// POST /api/wealth/advisories/refresh — regenerate the caller's family wealth
// advisories from current data. Body: { householdCurrency }. Parent-only.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { verifyBearer } from '@/lib/wealthVaultServer';
import { refreshAdvisories } from '@/lib/wealthAdvisoriesServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  let body: { householdCurrency?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }

  const profile = (await db.collection('users').doc(who.uid).get()).data() as { familyId?: string; role?: string } | undefined;
  if (!profile?.familyId || profile.role !== 'parent') {
    return NextResponse.json({ ok: false, error: 'not-a-parent' }, { status: 403 });
  }
  try {
    const r = await refreshAdvisories(profile.familyId, body.householdCurrency || 'USD');
    return NextResponse.json({ ok: true, ...r });
  } catch {
    return NextResponse.json({ ok: false, error: 'refresh-failed' }, { status: 500 });
  }
}
