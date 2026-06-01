// POST /api/wealth/markets/ai-update — DSE quotes + AI commentary tied to the
// caller's family holdings. Returns { quotes, asOf, commentary, ai }.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { verifyBearer } from '@/lib/wealthVaultServer';
import { getMarketUpdate } from '@/lib/wealthMarketsServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const who = await verifyBearer(req);
  if (!who) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });
  const profile = (await db.collection('users').doc(who.uid).get()).data() as { familyId?: string } | undefined;
  if (!profile?.familyId) return NextResponse.json({ ok: false, error: 'no-family' }, { status: 403 });

  // Pass the date in (server has no Date.now restriction here, but keep it explicit).
  const asOf = new Date().toISOString().slice(0, 10);
  try {
    const r = await getMarketUpdate(profile.familyId, asOf);
    return NextResponse.json({ ok: true, ...r });
  } catch {
    return NextResponse.json({ ok: false, error: 'market-update-failed' }, { status: 500 });
  }
}
