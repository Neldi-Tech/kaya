// 💬 Rewards feedback (RWD PR2 · R15) — a KID reacts to their own enjoyed
// redemption (😍 loved / 🙂 ok / 😕 meh + an optional line). Kids can't
// write redemption docs client-side (rules), so the reaction lands here via
// the Admin SDK after verifying the redemption really is theirs. Overwriting
// an earlier reaction is allowed (kids change their minds).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REACTIONS = new Set(['loved', 'ok', 'meh']);

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  let body: { redemptionId?: string; reaction?: string; text?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const redemptionId = (body.redemptionId || '').trim();
  const reaction = (body.reaction || '').trim();
  const text = (body.text || '').trim().slice(0, 200);
  if (!redemptionId || !REACTIONS.has(reaction)) {
    return NextResponse.json({ ok: false, error: 'bad-input' }, { status: 400 });
  }

  const profSnap = await db.collection('users').doc(uid).get();
  const prof = profSnap.data() as { role?: string; familyId?: string; childId?: string } | undefined;
  if (!prof?.familyId || prof.role !== 'kid' || !prof.childId) {
    return NextResponse.json({ ok: false, error: 'not-a-linked-kid' }, { status: 403 });
  }

  const redRef = db.collection('families').doc(prof.familyId).collection('redemptions').doc(redemptionId);
  const redSnap = await redRef.get();
  if (!redSnap.exists) return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
  const red = redSnap.data() as { childId?: string; status?: string };
  if (red.childId !== prof.childId) return NextResponse.json({ ok: false, error: 'not-yours' }, { status: 403 });
  if (red.status === 'rejected') return NextResponse.json({ ok: false, error: 'not-redeemed' }, { status: 400 });

  await redRef.set({ feedback: { reaction, ...(text ? { text } : {}) } }, { merge: true });
  return NextResponse.json({ ok: true });
}
