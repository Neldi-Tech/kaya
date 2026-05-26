// POST /api/sparks/[id]/upvote — toggle the caller's vote on a spark.
// Returns { voted: boolean, upvoteCount: number } reflecting post-state.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth } from '@/lib/sparksServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx: auth } = r;

  const sparkRef = db.collection('sparks').doc(ctx.params.id);
  const voteRef = sparkRef.collection('upvotes').doc(auth.uid);

  const newState = await db.runTransaction(async (tx) => {
    const [sparkSnap, voteSnap] = await Promise.all([tx.get(sparkRef), tx.get(voteRef)]);
    if (!sparkSnap.exists) throw new Error('spark-not-found');
    const had = voteSnap.exists;
    if (had) {
      tx.delete(voteRef);
      tx.update(sparkRef, { upvoteCount: FieldValue.increment(-1) });
    } else {
      tx.set(voteRef, { uid: auth.uid, votedAt: FieldValue.serverTimestamp() });
      tx.update(sparkRef, { upvoteCount: FieldValue.increment(1) });
    }
    const current = (sparkSnap.data() as { upvoteCount?: number }).upvoteCount ?? 0;
    return { voted: !had, upvoteCount: current + (had ? -1 : 1) };
  }).catch((e) => ({ error: String(e?.message ?? e) }));

  if ('error' in newState) {
    const code = newState.error === 'spark-not-found' ? 404 : 500;
    return NextResponse.json({ error: newState.error }, { status: code });
  }
  return NextResponse.json(newState);
}
