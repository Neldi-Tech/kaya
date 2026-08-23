// 💛 Points Emails 2.0 — the kid says thanks on an award (E4-kid, R11).
//
// POST { awardId, text } + Firebase ID token. A kid (own award) or a parent
// writes a short `kidNote` onto the award doc via Admin (kids can't write
// awards client-side — no rules change) and the awarder gets a 🔔 bell
// card. Surfaces: parent's 📬 Feedback card, Reports. 300 chars max.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
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

  let body: { awardId?: string; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const awardId = typeof body.awardId === 'string' ? body.awardId.slice(0, 200) : '';
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 300) : '';
  if (!awardId) return NextResponse.json({ error: 'awardId required' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string; role?: string; childId?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const ref = db.collection('families').doc(familyId).collection('awards').doc(awardId);
  const award = (await ref.get()).data() as { childId?: string; awardedBy?: string; reason?: string } | undefined;
  if (!award) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const isParent = user?.role === 'parent';
  if (!isParent && user?.childId !== award.childId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const byName = (user?.displayName || 'Kid').split(' ')[0];
  if (!text) {
    await ref.set({ kidNote: FieldValue.delete() }, { merge: true });
    return NextResponse.json({ ok: true, cleared: true });
  }
  await ref.set({ kidNote: { text, byUid: uid, byName, at: Date.now() } }, { merge: true });
  // 🔔 tell the awarder (best-effort).
  if (award.awardedBy && award.awardedBy !== uid) {
    try {
      await db.collection('families').doc(familyId).collection('notifications').add({
        type: 'points', title: `💛 ${byName} said thanks`, message: text, read: false,
        forUserId: award.awardedBy, link: `/stats/me?kid=${award.childId || ''}&thanks=${awardId}`,
        createdAt: FieldValue.serverTimestamp(),
      });
    } catch { /* bell is a bonus */ }
  }
  return NextResponse.json({ ok: true });
}
