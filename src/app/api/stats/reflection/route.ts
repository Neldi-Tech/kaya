// Kaya · My Stats — kid reflections on their own ratings (Admin SDK).
//
// PR 2 of the Kid Stats pack (Elia-approved 2026-07-29). A kid (or a
// parent) attaches a short REFLECTION to a specific routine rating —
// "I stayed up reading. I'll sleep by 9 so I wake up for prayer." —
// so low ratings arrive at the Sunday meeting already explained.
//
// Why a route: firestore.rules allow ratings CREATE for parents/helpers
// only and no client UPDATE at all — kids can't write. This route
// verifies the caller owns the childId (kid) or is a parent in the
// family, then writes `reflections.{routineId}` on the rating doc via
// Admin SDK. NO rules change.
//
// Honesty freeze: once a family meeting with date >= the rating's date
// exists, the reflection is frozen (409) — the record that reached the
// meeting stays the record.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { ratingId?: string; routineId?: string; text?: string }

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const ratingId = typeof body.ratingId === 'string' ? body.ratingId.slice(0, 200) : '';
  const routineId = typeof body.routineId === 'string' ? body.routineId.slice(0, 80) : '';
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 400) : '';
  if (!ratingId || !routineId) return NextResponse.json({ error: 'ratingId + routineId required' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const ratingRef = db.collection('families').doc(familyId).collection('ratings').doc(ratingId);
  const rating = (await ratingRef.get()).data() as { childId?: string; date?: string } | undefined;
  if (!rating) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  // A kid may reflect only on their OWN ratings; parents may on any.
  const isParent = user?.role === 'parent';
  if (!isParent && user?.childId !== rating.childId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // Honesty freeze — once a meeting on/after the rating date exists.
  const meetSnap = await db.collection('families').doc(familyId).collection('meetings')
    .where('date', '>=', rating.date || '9999-99-99').limit(1).get();
  if (!meetSnap.empty) return NextResponse.json({ error: 'frozen', reason: 'meeting-closed' }, { status: 409 });

  const name = (user?.displayName || 'Family member').split(' ')[0];
  await ratingRef.set({
    reflections: {
      [routineId]: text
        ? { text, byUid: uid, byName: name, at: Date.now() }
        : null, // empty text clears the kid's reflection (still pre-freeze only)
    },
  }, { merge: true });

  return NextResponse.json({ ok: true, text, byName: name });
}
