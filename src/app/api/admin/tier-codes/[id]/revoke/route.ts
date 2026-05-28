// POST /api/admin/tier-codes/[id]/revoke — operator-only. Marks a fresh
// code as revoked so it can't be redeemed. No-op if already redeemed /
// expired / revoked.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth } from '@/lib/buzzServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  if (!r.ctx.isOperator) return NextResponse.json({ error: 'operator-only' }, { status: 403 });
  const id = ctx.params.id;
  if (!id) return NextResponse.json({ error: 'no-id' }, { status: 400 });

  const ref = r.db.collection('tierCodes').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const data = snap.data() as { status?: string };
  if (data.status !== 'fresh') {
    return NextResponse.json({ ok: true, noop: true, status: data.status });
  }

  await ref.update({
    status: 'revoked',
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: r.ctx.uid,
    revokedReason: 'manual',
  });

  return NextResponse.json({ ok: true });
}
