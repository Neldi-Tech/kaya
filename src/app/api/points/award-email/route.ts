// 🎖️ Points Emails 2.0 — award email gateway (R11, approved 23-Aug-2026).
//
// POST { awardId, mode?: 'send' | 'preview' } + Firebase ID token.
//
// Family + outside tiers for a bonus-point award, composed server-side from
// the award DOC (reason card · kind meaning · this week's trail). The kid
// tier keeps riding giveAward → /api/kids/reward-email (every award source,
// no double sends). Replaces the award page's client fan-out. Idempotent via
// an `emailedAt` stamp on the award doc. Best-effort — never breaks an award.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { processAwardEmail } from '@/lib/pointsEmail.server';

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

  let body: { awardId?: string; mode?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const awardId = typeof body.awardId === 'string' ? body.awardId.slice(0, 200) : '';
  const mode = body.mode === 'preview' ? 'preview' : 'send';
  if (!awardId) return NextResponse.json({ error: 'awardId required' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string; role?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user?.role === 'kid') return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  if (mode === 'preview' && user?.role !== 'parent') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const ref = db.collection('families').doc(familyId).collection('awards').doc(awardId);
  if (mode === 'send') {
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if ((snap.data() as { emailedAt?: number } | undefined)?.emailedAt) return NextResponse.json({ ok: true, skipped: 'already-emailed' });
    try { await ref.set({ emailedAt: Date.now() }, { merge: true }); } catch { /* best-effort */ }
  }
  try {
    const result = await processAwardEmail(db, familyId, awardId, mode);
    if (!result) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
