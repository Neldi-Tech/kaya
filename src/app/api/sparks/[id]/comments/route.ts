// GET  /api/sparks/[id]/comments — list (sanitised).
// POST /api/sparks/[id]/comments — add a comment.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveAuth, sanitizeComment, trimToLen, loadSparksSettings, type RawComment } from '@/lib/sparksServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx: auth } = r;
  const id = ctx.params.id;
  const snap = await db.collection('sparks').doc(id).collection('comments').orderBy('createdAt', 'asc').limit(200).get();
  const comments = snap.docs.map((d) => sanitizeComment(d.id, d.data() as RawComment, auth));
  return NextResponse.json({ comments });
}

export async function POST(req: NextRequest, ctx: { params: { id: string } }) {
  const r = await resolveAuth(req);
  if ('error' in r) return NextResponse.json({ error: r.error }, { status: r.status });
  const { db, ctx: auth } = r;
  if (!auth.familyId || !auth.familyDisplayName) return NextResponse.json({ error: 'no-family' }, { status: 400 });

  let body: { body?: string; postedAnonymously?: boolean };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const text = trimToLen(String(body.body ?? ''), 1000);
  if (!text) return NextResponse.json({ error: 'body-required' }, { status: 400 });

  const settings = await loadSparksSettings(db);
  let postedAnonymously = body.postedAnonymously === true;
  if (!settings.allowAnonymous) postedAnonymously = false;
  if (auth.role === 'kid' && settings.kidsDefaultAnonymous && body.postedAnonymously !== false) {
    postedAnonymously = true;
  }

  const sparkRef = db.collection('sparks').doc(ctx.params.id);
  const sparkSnap = await sparkRef.get();
  if (!sparkSnap.exists) return NextResponse.json({ error: 'spark-not-found' }, { status: 404 });

  const commentRef = sparkRef.collection('comments').doc();
  const batch = db.batch();
  batch.set(commentRef, {
    body: text,
    authorUid: auth.uid,
    authorFamilyId: auth.familyId,
    authorRealName: auth.familyDisplayName,
    postedAnonymously,
    createdAt: FieldValue.serverTimestamp(),
  });
  batch.update(sparkRef, {
    commentCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await batch.commit();
  return NextResponse.json({ id: commentRef.id });
}
