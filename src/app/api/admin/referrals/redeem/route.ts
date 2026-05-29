// POST /api/admin/referrals/redeem — operator-only. Spends a family's KC
// on tier time (the Phase B "redeem from Admin, Tiers only" control).
// Body: { familyId: string, tierId: 'home'|'castle', durationId: KcTierDuration['id'] }
// Returns { balanceAfter, cost, tierId, months }.
//
// Cost is computed server-side from the MERGED tier prices (defaults +
// admin overrides) so it always matches what the console previews.
// redeemKcForTier debits KC, writes the ledger entry, and flips the
// family's tier + subscription.expiresAt atomically.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { redeemKcForTier } from '@/lib/referralServer';
import { loadAllTiers } from '@/lib/tiersServer';
import { KC_TIER_DURATIONS } from '@/lib/referral';
import type { SubscriptionTierId } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REDEEMABLE = new Set<SubscriptionTierId>(['home', 'castle']);

export async function POST(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db, ctx } = r;

  let body: { familyId?: string; tierId?: SubscriptionTierId; durationId?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const familyId = String(body.familyId ?? '');
  if (!familyId) return NextResponse.json({ error: 'no-family-id' }, { status: 400 });
  if (!body.tierId || !REDEEMABLE.has(body.tierId)) return NextResponse.json({ error: 'bad-tier' }, { status: 400 });

  const duration = KC_TIER_DURATIONS.find((d) => d.id === body.durationId);
  if (!duration) return NextResponse.json({ error: 'bad-duration' }, { status: 400 });

  const tiers = await loadAllTiers(db);
  const res = await redeemKcForTier(db, {
    familyId,
    tierId: body.tierId,
    months: duration.months,
    operatorUid: ctx.uid,
    operatorEmail: ctx.email,
    tiers,
  });

  if (!res.ok) {
    const status = res.error === 'family-not-found' ? 404
      : res.error === 'insufficient-kc' ? 409
      : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({
    balanceAfter: res.balanceAfter,
    cost: res.cost,
    tierId: body.tierId,
    months: duration.months,
  });
}
