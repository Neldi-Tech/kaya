// POST /api/admin/referrals/grant — FOUNDER-only (minting KC is the apex
// money power; see FOUNDER_EMAILS). Manually credits KC to a family (the
// Phase B "manual grant" control). Body:
//   { familyId: string, amount: number (>0), reason?: string }
// Returns { balanceAfter }. Writes via lib/referralServer.grantKc, which
// appends a kcLedger entry atomically.

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { grantKc } from '@/lib/referralServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isFounder) return NextResponse.json({ error: 'founder-only' }, { status: 403 });
  const { db, ctx } = r;

  let body: { familyId?: string; amount?: number; reason?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const familyId = String(body.familyId ?? '');
  if (!familyId) return NextResponse.json({ error: 'no-family-id' }, { status: 400 });

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'bad-amount' }, { status: 400 });

  const res = await grantKc(db, {
    familyId,
    amount,
    reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : '',
    operatorUid: ctx.uid,
    operatorEmail: ctx.email,
  });

  if (!res.ok) {
    const status = res.error === 'family-not-found' ? 404 : 400;
    return NextResponse.json({ error: res.error }, { status });
  }
  return NextResponse.json({ balanceAfter: res.balanceAfter });
}
