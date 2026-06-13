// GET-style (POST) list of the caller's visible reminders.
//
// Admin SDK throughout — the `families/{id}/reminders` subcollection is
// default-deny until firestore.rules deploys, so reads go through here with
// a verified Firebase ID token (mirrors the Birthdays engine). Returns the
// caller's own events + shared/active family events (+ pending kid events to
// parents). Auto-imported family birthdays are merged CLIENT-side from the
// already-loaded family profiles, so this route only returns stored events.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { visibleTo, type ReminderEvent } from '@/lib/reminders';

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
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = user?.role;

  const snap = await db.collection('families').doc(familyId).collection('reminders').get();
  const events: ReminderEvent[] = [];
  snap.forEach((d) => {
    const ev = { id: d.id, ...(d.data() as Record<string, unknown>) } as ReminderEvent;
    if (visibleTo(ev, uid, role)) events.push(ev);
  });

  return NextResponse.json({ events });
}
