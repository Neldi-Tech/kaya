// GET /api/addons — any signed-in member. Returns the add-on catalogue with
// admin price + released + purchasable resolved (mergedAddons), plus THIS
// family's effective acquisition mode ('request' | 'stripe'). Keeps
// /config/addons + /config/admin server-side (Admin SDK read → no rules change).

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { mergedAddons, type AddonOverrides } from '@/lib/tiers';
import { resolveAddonBillingMode, DEFAULT_ADMIN_SETTINGS, type AdminSettings } from '@/lib/adminSettings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;

  const addonsSnap = await db.collection('config').doc('addons').get();
  const overrides = ((addonsSnap.exists ? addonsSnap.data() : {}) as AddonOverrides) ?? {};

  // Resolve this family's add-on acquisition mode (request vs stripe).
  let mode: 'request' | 'stripe' = 'request';
  try {
    const adminSnap = await db.collection('config').doc('admin').get();
    const settings: AdminSettings = {
      ...DEFAULT_ADMIN_SETTINGS,
      ...((adminSnap.exists ? adminSnap.data() : {}) as Partial<AdminSettings>),
    };
    let createdAtMs: number | null = null;
    if (ctx.familyId) {
      const famSnap = await db.collection('families').doc(ctx.familyId).get();
      const createdAt = famSnap.exists
        ? (famSnap.data()?.createdAt as { toMillis?: () => number } | undefined)
        : undefined;
      if (createdAt && typeof createdAt.toMillis === 'function') createdAtMs = createdAt.toMillis();
    }
    mode = resolveAddonBillingMode(settings, createdAtMs, Date.now());
  } catch { /* default 'request' */ }

  return NextResponse.json({ addons: mergedAddons(overrides), mode });
}
