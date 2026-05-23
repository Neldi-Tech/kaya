// Kaya Business · instant stock-take House Points (auto cadence, server).
//
// Kids can't grant themselves points (children/awards are parent-only in the
// rules), so the *auto* instant-award path runs here with the Admin SDK after
// verifying the caller's Firebase ID token. Only acts when the family is on
// hpAward.cadence === 'instant' && mode === 'auto', the caller owns the
// business (or is a parent), a stock-take exists for the date, and it hasn't
// already been granted (idempotent via the stock-take's `hpGranted` flag).
//
// No-ops cleanly (skipped:true) without admin creds — the client then falls
// back to filing a parent-review request so the point is never silently lost.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { businessId?: string; date?: string };
  try { body = (await req.json()) as { businessId?: string; date?: string }; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const businessId = (body.businessId || '').trim();
  const date = (body.date || '').trim();
  if (!businessId || !date) return NextResponse.json({ error: 'missing-params' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const bizRef = db.collection('families').doc(familyId).collection('businesses').doc(businessId);
  const bizSnap = await bizRef.get();
  if (!bizSnap.exists) return NextResponse.json({ error: 'no-business' }, { status: 404 });
  const ownerId = ((bizSnap.data() as { ownerId?: string }).ownerId) || '';

  const isParent = user?.role === 'parent';
  const isOwnerKid = user?.role === 'kid' && (user?.childId || '') === ownerId;
  if (!isParent && !isOwnerKid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const hp = ((await db.collection('families').doc(familyId).get()).data()?.businessConfig?.hpAward) as
    { mode?: string; cadence?: string; perDayHp?: number } | undefined;
  if ((hp?.cadence || 'instant') !== 'instant' || (hp?.mode || 'parent_review') !== 'auto') {
    return NextResponse.json({ skipped: true, reason: 'not-instant-auto' });
  }
  const points = Math.max(0, Math.round(Number(hp?.perDayHp ?? 1)));
  if (points <= 0) return NextResponse.json({ skipped: true, reason: 'zero-points' });

  const takeRef = bizRef.collection('stockTakes').doc(date);
  const takeSnap = await takeRef.get();
  if (!takeSnap.exists) return NextResponse.json({ error: 'no-stocktake' }, { status: 404 });
  if ((takeSnap.data() as { hpGranted?: boolean }).hpGranted) {
    return NextResponse.json({ ok: true, alreadyGranted: true, points: 0 });
  }

  const childRef = db.collection('families').doc(familyId).collection('children').doc(ownerId);
  const childSnap = await childRef.get();
  if (!childSnap.exists) return NextResponse.json({ error: 'no-child' }, { status: 404 });
  const child = childSnap.data() as { totalPoints?: number; weeklyPoints?: number };

  try {
    await db.collection('families').doc(familyId).collection('awards').add({
      childId: ownerId, kind: 'regular', points,
      reason: 'Kaya Business — stock-take done', category: 'business',
      awardedBy: 'system', awardedByName: 'Auto-award', senderRole: 'parent',
      createdAt: new Date(),
    });
    await childRef.update({
      totalPoints: (child.totalPoints || 0) + points,
      weeklyPoints: (child.weeklyPoints || 0) + points,
    });
    await takeRef.set({ hpGranted: true }, { merge: true });
  } catch (e) {
    return NextResponse.json({ error: 'award-failed', detail: String(e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, points });
}
