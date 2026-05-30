// GET /api/addons — any signed-in member. Returns the add-on catalogue with
// admin price + released overrides applied (mergedAddons). Lets the family
// subscription page reflect operator pricing/availability while /config/addons
// stays server-side (Admin SDK read → no Firestore rules change needed).

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { mergedAddons, type AddonOverrides } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const snap = await r.db.collection('config').doc('addons').get();
  const overrides = ((snap.exists ? snap.data() : {}) as AddonOverrides) ?? {};
  return NextResponse.json({ addons: mergedAddons(overrides) });
}
