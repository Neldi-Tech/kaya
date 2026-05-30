// POST /api/upgrade-requests — any signed-in family member submits an
// upgrade request. Lands as a /upgradeRequests/{id} doc the operator
// sees on /admin/upgrade-requests.
//
// Body: { requestedTier, requestedAddons?, note? }

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth } from '@/lib/buzzServer';
import { DEFAULT_ADDONS, isAddonReleased, type AddonOverrides, type SubscriptionTierId } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIER_IDS = new Set<SubscriptionTierId>(['nest', 'home', 'castle']);
const VALID_ADDON_IDS = new Set(DEFAULT_ADDONS.map((a) => a.id));

export async function POST(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.familyId) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  let body: { requestedTier?: string; requestedAddons?: string[]; note?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const requestedTier = body.requestedTier as SubscriptionTierId;
  if (!TIER_IDS.has(requestedTier)) return NextResponse.json({ error: 'bad-tier' }, { status: 400 });

  const rawAddons = Array.isArray(body.requestedAddons)
    ? body.requestedAddons.filter((a): a is string => typeof a === 'string' && VALID_ADDON_IDS.has(a))
    : [];
  // Charging invariant: an unreleased ("coming soon") add-on can never be
  // requested — reject rather than silently drop, so a tampered client can't
  // smuggle one into the approval queue.
  // Resolve released against admin overrides (an operator can mark a shipped
  // add-on "coming soon"), so the server gate matches what families see.
  let addonOverrides: AddonOverrides = {};
  try {
    const snap = await db.collection('config').doc('addons').get();
    addonOverrides = ((snap.exists ? snap.data() : {}) as AddonOverrides) ?? {};
  } catch { /* defaults: module-shipped status only */ }
  const unavailable = rawAddons.filter((id) => {
    const addon = DEFAULT_ADDONS.find((a) => a.id === id);
    return !addon || !isAddonReleased(addon, addonOverrides);
  });
  if (unavailable.length) {
    return NextResponse.json({ error: 'addon-not-available', addons: unavailable }, { status: 400 });
  }
  const requestedAddons = rawAddons;

  const note = String(body.note ?? '').trim().slice(0, 500);

  const ref = await db.collection('upgradeRequests').add({
    familyId: ctx.familyId,
    familyName: ctx.familyDisplayName ?? '(unnamed)',
    familyHandle: null,
    requesterUid: ctx.uid,
    requesterName: '',  // server fills from /users on read; kept here for legacy reads
    requesterEmail: ctx.email ?? '',
    requestedTier,
    requestedAddons,
    note,
    status: 'pending',
    fulfilledCodeId: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ id: ref.id });
}
