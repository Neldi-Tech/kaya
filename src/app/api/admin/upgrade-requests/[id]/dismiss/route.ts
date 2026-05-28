// POST /api/admin/upgrade-requests/[id]/dismiss — operator-only.
// Marks the request as dismissed (without generating a code).

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

  await r.db.collection('upgradeRequests').doc(id).update({
    status: 'dismissed',
    dismissedAt: FieldValue.serverTimestamp(),
    dismissedBy: r.ctx.uid,
  });

  return NextResponse.json({ ok: true });
}
