// POST { familyId, byUid, streak } — 🔥 meeting-streak milestone (SM3.1 · #6).
//
// Fired (fire-and-forget) by the presenter when finishing a meeting lands
// the family on a 5 / 10 / 25 / 52 consecutive-Sunday streak. Posts a
// celebration into the family chat AS KAYA (kids can't write the group
// thread header, and the moment should feel like the app cheering, not a
// parent typing). Admin SDK; caller must belong to the family; only the
// four milestone values are accepted.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

const MILESTONES = new Set([5, 10, 25, 52]);

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { familyId?: string; byUid?: string; streak?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const byUid = typeof body.byUid === 'string' ? body.byUid : '';
  const streak = typeof body.streak === 'number' ? body.streak : 0;
  if (!familyId || !byUid || !MILESTONES.has(streak)) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  // Caller must belong to the family (user doc or a kid's children.uid).
  const senderSnap = await db.collection('users').doc(byUid).get();
  let belongs = senderSnap.exists && senderSnap.data()?.familyId === familyId;
  if (!belongs) {
    const kid = await db.collection('families').doc(familyId)
      .collection('children').where('uid', '==', byUid).limit(1).get();
    belongs = !kid.empty;
  }
  if (!belongs) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const famRef = db.collection('families').doc(familyId);
  const threadRef = famRef.collection('threads').doc('group');
  if (!(await threadRef.get()).exists) return NextResponse.json({ ok: true, skipped: 'no-chat' });

  const text = streak === 52
    ? `🏆🔥 FIFTY-TWO Sunday meetings in a row — a FULL YEAR of showing up for each other. What a family! 🎉`
    : `🔥 ${streak} Sunday meetings in a row — the streak lives! Keep protecting it together 🎉`;
  await threadRef.collection('messages').add({
    senderUid: 'kaya', senderName: 'Kaya 🎉', text, createdAt: FieldValue.serverTimestamp(),
  });
  await threadRef.update({
    lastText: text, lastSenderUid: 'kaya', lastAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
