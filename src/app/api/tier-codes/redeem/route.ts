// POST /api/tier-codes/redeem — any signed-in family member.
// Body: { code: "HOME-X4K9B2" }
//
// Validates the code, verifies it's locked to the caller's family,
// fresh, not expired — then applies it transactionally (tier + addons +
// expiry written to families/{id}, code marked as redeemed).

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth } from '@/lib/buzzServer';
import { isProbablyTierCode } from '@/lib/tierCodes';
import { redeemCode } from '@/lib/tierCodesServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx } = r;
  if (!ctx.familyId) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  let body: { code?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const code = String(body.code ?? '').trim().toUpperCase();
  if (!isProbablyTierCode(code)) return NextResponse.json({ error: 'bad-code-format' }, { status: 400 });

  // Find the code doc by its `code` field.
  const snap = await db.collection('tierCodes').where('code', '==', code).limit(1).get();
  if (snap.empty) return NextResponse.json({ error: 'code-not-found' }, { status: 404 });
  const doc = snap.docs[0];

  // Apply transactionally.
  const result = await redeemCode(db, doc.id, ctx.familyId);
  if (!result.ok) {
    const userFacing: Record<string, string> = {
      'wrong-family':  'This code isn\'t for your family.',
      'code-redeemed': 'This code has already been redeemed.',
      'code-expired':  'This code has expired.',
      'code-revoked':  'This code has been revoked. Reach out for a new one.',
      'code-not-found': 'We couldn\'t find that code. Check the spelling.',
    };
    return NextResponse.json({
      error: result.error,
      message: userFacing[result.error] ?? 'Couldn\'t redeem the code.',
    }, { status: 400 });
  }

  return NextResponse.json({ ok: true, tier: result.tier });
}
