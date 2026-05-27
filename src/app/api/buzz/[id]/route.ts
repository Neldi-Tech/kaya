// GET    /api/buzz/[id]   — fetch a single buzz (sanitised).
// DELETE /api/buzz/[id]   — delete (author or operator only).

import { NextRequest, NextResponse } from 'next/server';
import { resolveAuth, sanitizeBuzz, type RawBuzz } from '@/lib/buzzServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx: auth } = r;

  const id = ctx.params.id;
  const snap = await db.collection('buzz').doc(id).get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const raw = snap.data() as RawBuzz;
  if (raw.status === 'review' && !auth.isOperator && raw.authorUid !== auth.uid) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  const voteSnap = await db.collection('buzz').doc(id).collection('upvotes').doc(auth.uid).get();
  return NextResponse.json({ buzz: sanitizeBuzz(id, raw, auth, voteSnap.exists) });
}

export async function DELETE(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx: auth } = r;

  const id = ctx.params.id;
  const ref = db.collection('buzz').doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const raw = snap.data() as RawBuzz;
  const isAuthor = raw.authorUid === auth.uid;
  if (!isAuthor && !auth.isOperator) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Delete sub-collections first (comments + upvotes), then the doc.
  // Bounded volume — buzz rarely accumulate huge sub-collections.
  const [comments, votes] = await Promise.all([
    ref.collection('comments').get(),
    ref.collection('upvotes').get(),
  ]);
  const batch = db.batch();
  for (const d of comments.docs) batch.delete(d.ref);
  for (const d of votes.docs)    batch.delete(d.ref);
  batch.delete(ref);
  await batch.commit();
  return NextResponse.json({ ok: true });
}
