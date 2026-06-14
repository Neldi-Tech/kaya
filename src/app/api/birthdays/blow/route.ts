// POST { familyId, byUid, personKey } — the birthday person blows out the
// candles. Stamps family.birthdays[personKey].blownOutAt (epoch ms), idempotent.
//
// Admin SDK: the birthday person is most often a KID, who can't write the family
// doc directly. The button is gated to the birthday person client-side; here we
// only require the caller to belong to the family (blowing candles is purely
// celebratory + idempotent — worst case a sibling does it on the day). Caller is
// matched either as a users/{uid} member OR a children doc whose `uid` == byUid
// (kids authenticate via Kaya Code and live under families/{id}/children).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { familyId?: string; byUid?: string; personKey?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const byUid = typeof body.byUid === 'string' ? body.byUid : '';
  const personKey = typeof body.personKey === 'string' ? body.personKey : '';
  if (!familyId || !byUid || !personKey) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  // Caller must belong to the family — as a user (parent/helper/adult) OR a kid.
  const senderSnap = await db.collection('users').doc(byUid).get();
  let belongs = senderSnap.exists && senderSnap.data()?.familyId === familyId;
  if (!belongs) {
    const childMatch = await db.collection('families').doc(familyId)
      .collection('children').where('uid', '==', byUid).limit(1).get();
    belongs = !childMatch.empty;
  }
  if (!belongs) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const famRef = db.collection('families').doc(familyId);
  const famSnap = await famRef.get();
  if (!famSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const state = (famSnap.data()?.birthdays || {}) as Record<string, { blownOutAt?: number }>;
  if (!state[personKey]) return NextResponse.json({ error: 'no-celebration' }, { status: 404 });
  if (state[personKey]?.blownOutAt) return NextResponse.json({ ok: true, already: true });

  await famRef.set({ birthdays: { [personKey]: { blownOutAt: Date.now() } } }, { merge: true });
  return NextResponse.json({ ok: true });
}
