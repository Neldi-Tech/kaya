// POST { familyId, byUid, personKey, action } — birthday-day surprises (B3).
//
//   action 'drop'         → stamp dropAt (the birthday person opens their Drop;
//                           family-membership gated, idempotent).
//   action 'nochores-on'  → set noChores = true   (PARENT only).
//   action 'nochores-off' → set noChores = false  (PARENT only).
//
// Admin SDK: the birthday person is often a kid (can't write the family doc),
// and the no-chores gift is a parent decision. State lives on
// family.birthdays[personKey] — no firestore-rules change. No undefined writes.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';

const ACTIONS = ['drop', 'nochores-on', 'nochores-off'] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: { familyId?: string; byUid?: string; personKey?: string; action?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const byUid = typeof body.byUid === 'string' ? body.byUid : '';
  const personKey = typeof body.personKey === 'string' ? body.personKey : '';
  const action = body.action as Action;
  if (!familyId || !byUid || !personKey || !ACTIONS.includes(action))
    return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  const famRef = db.collection('families').doc(familyId);

  // Resolve caller — a user (parent/helper/adult) or a kid (children.uid).
  const senderSnap = await db.collection('users').doc(byUid).get();
  const senderRole = senderSnap.exists && senderSnap.data()?.familyId === familyId
    ? String(senderSnap.data()?.role || '') : '';
  let belongs = !!senderRole;
  if (!belongs) {
    const childMatch = await famRef.collection('children').where('uid', '==', byUid).limit(1).get();
    belongs = !childMatch.empty;
  }
  if (!belongs) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // The chore-free gift is a parent decision.
  if (action !== 'drop' && senderRole !== 'parent')
    return NextResponse.json({ error: 'parent-only' }, { status: 403 });

  const famSnap = await famRef.get();
  if (!famSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const state = (famSnap.data()?.birthdays || {}) as Record<string, { dropAt?: number; noChores?: boolean }>;
  if (!state[personKey]) return NextResponse.json({ error: 'no-celebration' }, { status: 404 });

  if (action === 'drop') {
    if (state[personKey]?.dropAt) return NextResponse.json({ ok: true, already: true });
    await famRef.set({ birthdays: { [personKey]: { dropAt: Date.now() } } }, { merge: true });
  } else {
    await famRef.set({ birthdays: { [personKey]: { noChores: action === 'nochores-on' } } }, { merge: true });
  }
  return NextResponse.json({ ok: true });
}
