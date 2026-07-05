// POST list of the family's 🔔 alert-log entries (VIS PR1).
//
// Admin SDK read — the `families/{id}/alertLog` subcollection is written by
// the low-balance engine and never touched by clients, so reads come through
// here with a verified Firebase ID token (mirrors reminders/list). PARENT
// only: entries carry recipient email addresses, which kids and helpers
// don't get to browse.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string } | undefined;
  if (!user?.familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user.role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });

  // Single-field orderBy — no composite index needed.
  const snap = await db.collection('families').doc(user.familyId)
    .collection('alertLog').orderBy('firedAt', 'desc').limit(120).get();
  const entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }));

  return NextResponse.json({ entries });
}
