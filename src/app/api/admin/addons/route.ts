// GET   /api/admin/addons — operator-only. Returns the add-on override map
//                           ({ [addonId]: { priceMonthly?, released? } }).
// PATCH /api/admin/addons — operator-only. Body: { addonId, patch }.
//
// Persisted at /config/addons. Admin SDK access bypasses Firestore rules,
// and the client never reads this doc directly (it flows through
// useTierAccess), so no rules entry is needed.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { DEFAULT_ADDONS, type AddonOverride, type AddonOverrides } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ADDONS_PATH = ['config', 'addons'] as const;
const VALID_IDS = new Set(DEFAULT_ADDONS.map((a) => a.id));

async function readOverrides(db: FirebaseFirestore.Firestore): Promise<AddonOverrides> {
  const snap = await db.collection(ADDONS_PATH[0]).doc(ADDONS_PATH[1]).get();
  return ((snap.exists ? snap.data() : {}) as AddonOverrides) ?? {};
}

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  return NextResponse.json({ overrides: await readOverrides(r.db) });
}

export async function PATCH(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });

  let body: { addonId?: string; patch?: AddonOverride };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const { addonId, patch } = body;
  if (!addonId || !VALID_IDS.has(addonId)) return NextResponse.json({ error: 'bad-addon' }, { status: 400 });

  const clean: AddonOverride = {};
  if (patch && Number.isFinite(patch.priceMonthly)) clean.priceMonthly = Math.max(0, Math.round(patch.priceMonthly as number));
  if (patch && typeof patch.released === 'boolean') clean.released = patch.released;
  if (patch && typeof patch.stripePriceId === 'string') clean.stripePriceId = patch.stripePriceId.trim().slice(0, 120);

  // Deep-merge under the addonId key so updating one field keeps the other.
  await r.db.collection(ADDONS_PATH[0]).doc(ADDONS_PATH[1]).set({ [addonId]: clean }, { merge: true });
  return NextResponse.json({ overrides: await readOverrides(r.db) });
}
