// 🔥 Points Emails 2.0 — rating Heat Report gateway (approved 23-Aug-2026).
//
// POST { ratingId, mode?: 'send' | 'preview' } + Firebase ID token.
//
// ONE source of truth for every routine-rating email (R1): the client
// sends an ID only; the server reads the rating doc + family + week,
// resolves the audience by IDENTITY (R2) and renders the three tiers
// (family Heat Report · Kid Heat Report · outside totals). No free text
// crosses this route — the reasons are the parents' own notes on the
// rating doc. Replaces the client-side fan-out that used to live on the
// rate page (and the old /api/kids/rating-email kid-only route).
//
// mode 'preview' (parents only) composes without sending — used by the
// Settings "👁️ Preview" button and for QA. Always best-effort: the rating
// already exists; this route can only add delivery, never break it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { processRatingEmail } from '@/lib/pointsEmail.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { ratingId?: string; mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const ratingId = typeof body.ratingId === 'string' ? body.ratingId.slice(0, 200) : '';
  const mode = body.mode === 'preview' ? 'preview' : 'send';
  if (!ratingId) return NextResponse.json({ error: 'ratingId required' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string; role?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  // Sending is for the people who can rate (parents + helpers); preview is parents only.
  if (user?.role === 'kid') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (mode === 'preview' && user?.role !== 'parent') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Idempotence: a rating emails once. The stamp lives on the rating doc
  // (Admin write) so a double-tap / retry never double-sends.
  const ratingRef = db.collection('families').doc(familyId).collection('ratings').doc(ratingId);
  if (mode === 'send') {
    const snap = await ratingRef.get();
    if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if ((snap.data() as { emailedAt?: number } | undefined)?.emailedAt) {
      return NextResponse.json({ ok: true, skipped: 'already-emailed' });
    }
    try { await ratingRef.set({ emailedAt: Date.now() }, { merge: true }); } catch { /* best-effort */ }
  }

  try {
    const result = await processRatingEmail(db, familyId, ratingId, mode);
    if (!result) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
