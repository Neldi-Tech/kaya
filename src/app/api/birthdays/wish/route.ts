// POST { familyId, fromUid, personKey, text } — send a birthday wish.
//
// Appends the wish to family.birthdays[personKey].wishes (each wish lights a
// candle on the birthday person's cake — B2) AND posts it into the family chat
// as the sender. Admin SDK: kids can't write the family doc directly, and the
// wish must land even when the sender isn't a family-chat member yet.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import type { BirthdayWishEntry } from '@/lib/birthdays';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { familyId?: string; fromUid?: string; personKey?: string; text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const fromUid = typeof body.fromUid === 'string' ? body.fromUid : '';
  const personKey = typeof body.personKey === 'string' ? body.personKey : '';
  const text = (typeof body.text === 'string' ? body.text : '').trim().slice(0, 200);
  if (!familyId || !fromUid || !personKey || !text) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  // Sender must belong to the family.
  const senderSnap = await db.collection('users').doc(fromUid).get();
  const sender = senderSnap.data();
  if (!sender || sender.familyId !== familyId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const senderName = String(sender.displayName || 'Someone');

  const famRef = db.collection('families').doc(familyId);
  const famSnap = await famRef.get();
  if (!famSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const state = (famSnap.data()?.birthdays || {}) as Record<string, { name?: string; wishes?: BirthdayWishEntry[] }>;
  const day = state[personKey];
  if (!day) return NextResponse.json({ error: 'no-celebration' }, { status: 404 });

  const wish: BirthdayWishEntry = { uid: fromUid, name: senderName, text, at: Date.now() };
  await famRef.set({ birthdays: { [personKey]: { wishes: FieldValue.arrayUnion(wish) } } }, { merge: true });

  // Drop the wish into the family chat as the sender (visible celebration).
  const threadRef = famRef.collection('threads').doc('group');
  const threadSnap = await threadRef.get();
  if (threadSnap.exists) {
    const chatText = `🎂 To ${day.name || 'the birthday star'}: ${text}`;
    await threadRef.collection('messages').add({
      senderUid: fromUid, senderName, text: chatText, createdAt: FieldValue.serverTimestamp(),
    });
    await threadRef.update({
      lastText: chatText, lastSenderUid: fromUid, lastAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
      [`reads.${fromUid}`]: FieldValue.serverTimestamp(),
    }).catch(() => {});
  }

  const count = (Array.isArray(day.wishes) ? day.wishes.length : 0) + 1;
  return NextResponse.json({ ok: true, wishes: count });
}
