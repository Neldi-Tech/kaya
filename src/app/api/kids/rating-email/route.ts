// ⭐ Points Email Audience (approved 2026-08-09) — instant rating email
// to the rated kid.
//
// POST { childId, period, points } + Firebase ID token.
//
// Fired fire-and-forget from the rate page after a routine is saved. Only
// NUMBERS + an enum cross this route — the email's words are composed
// server-side, so nobody can put arbitrary text in a kid's inbox (same
// anti-abuse posture as /api/kids/reward-email). Sends only when the
// family armed '🧒 the kid it's about' for rating emails AND the kid has a
// parent-managed COPPA email pointer. Always best-effort.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { sendKidRatingEmail } from '@/lib/kidEmails.server';

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

  let body: { childId?: string; period?: string; points?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const childId = typeof body.childId === 'string' ? body.childId : '';
  const period = body.period === 'morning' || body.period === 'evening' ? body.period : null;
  const points = typeof body.points === 'number' && Number.isFinite(body.points) ? Math.round(body.points) : null;
  if (!childId || !period || points == null || points <= 0) {
    return NextResponse.json({ error: 'bad-args' }, { status: 400 });
  }

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  // The kid must belong to the caller's family — no cross-family pings.
  const kid = await db.collection('families').doc(familyId).collection('children').doc(childId).get();
  if (!kid.exists) return NextResponse.json({ error: 'kid-not-found' }, { status: 404 });

  await sendKidRatingEmail(db, familyId, childId, { period, points });
  return NextResponse.json({ ok: true });
}
