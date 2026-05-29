// GET /api/admin/referrals — operator-only. Two shapes:
//   • no query        → list every family with its KC balance + referral
//                        stats (for the Kaya Coins console list).
//   • ?familyId=<id>   → that family's balance + recent ledger detail.
//
// Mutations live in ./grant and ./redeem. This route is read-only.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { listKcLedger } from '@/lib/referralServer';
import { loadAllTiers } from '@/lib/tiersServer';
import { effectiveCount, topBadge, type KcLedgerEntry } from '@/lib/referral';
import type { SubscriptionTierId } from '@/lib/tiers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface AdminReferralRow {
  id: string;
  name: string;
  handle: string | null;
  kayaCoins: number;
  referralCount: number;   // direct
  compoundCredit: number;  // 1-level-deep credit
  effectiveCount: number;  // direct + compound (drives the badge)
  topBadgeName: string | null;
  isFoundingFamily: boolean;
  charterNumber: number | null; // Charter serial (CF-###) when set
}

/** Lightweight tier summary so the client computes redemption cost with
 *  the same prices the server will charge (admin-overridable). */
export interface AdminReferralTierSummary {
  id: SubscriptionTierId;
  name: string;
  emoji: string;
  priceMonthly: number; // USD cents
}

export interface AdminReferralDetail {
  id: string;
  name: string;
  handle: string | null;
  kayaCoins: number;
  ledger: KcLedgerEntry[];
}

export async function GET(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const { db } = r;

  const familyId = req.nextUrl.searchParams.get('familyId');

  // ── Detail: one family + its ledger ────────────────────────────────
  if (familyId) {
    const snap = await db.collection('families').doc(familyId).get();
    if (!snap.exists) return NextResponse.json({ error: 'family-not-found' }, { status: 404 });
    const d = snap.data() as { name?: string; handle?: string; kayaCoins?: number };
    const ledger = await listKcLedger(db, familyId, 50);
    const detail: AdminReferralDetail = {
      id: familyId,
      name: d.name ?? '(unnamed)',
      handle: d.handle ?? null,
      kayaCoins: Number(d.kayaCoins ?? 0),
      ledger,
    };
    return NextResponse.json({ detail });
  }

  // ── List: every family with KC + referral stats ────────────────────
  const famSnap = await db.collection('families').orderBy('name').get();
  const rows: AdminReferralRow[] = famSnap.docs.map((doc) => {
    const x = doc.data() as {
      name?: string;
      handle?: string;
      kayaCoins?: number;
      referralCount?: number;
      compoundCredit?: number;
      isFoundingFamily?: boolean;
      charterNumber?: number;
    };
    const direct = Number(x.referralCount ?? 0);
    const compound = Number(x.compoundCredit ?? 0);
    const eff = effectiveCount(direct, compound);
    return {
      id: doc.id,
      name: x.name ?? '(unnamed)',
      handle: x.handle ?? null,
      kayaCoins: Number(x.kayaCoins ?? 0),
      referralCount: direct,
      compoundCredit: compound,
      effectiveCount: eff,
      topBadgeName: topBadge(direct, compound)?.name ?? null,
      isFoundingFamily: x.isFoundingFamily === true,
      charterNumber: typeof x.charterNumber === 'number' ? x.charterNumber : null,
    };
  });

  // Tier price summary (merged defaults + admin overrides) for the client
  // cost preview — Home/Castle only (Nest is free, never redeemable).
  const tiers = await loadAllTiers(db);
  const tierSummary: AdminReferralTierSummary[] = (['home', 'castle'] as SubscriptionTierId[]).map((id) => ({
    id,
    name: tiers[id].name,
    emoji: tiers[id].emoji,
    priceMonthly: tiers[id].priceMonthly,
  }));

  return NextResponse.json({ families: rows, tiers: tierSummary });
}
