// Kaya · COPPA + Login — redeem a Kaya Code (kid-facing, PUBLIC).
//
// This is the only COPPA route with no caller auth — the whole point is that a
// child signs in WITHOUT an email or password. They type the code their
// grown-up gave them; we:
//   1. resolve it to an ACTIVE code (paused/revoked are rejected),
//   2. ensure a kid UserProfile exists (uid === childId, role 'kid'),
//   3. mint a Firebase custom token and hand it back.
//
// The client then calls signInWithCustomToken. This COEXISTS with the legacy
// email/password kid login — both resolve to the same childId/familyId, so the
// rest of the app behaves identically regardless of how a kid signed in.
//
// Max-Privacy: a kid session record is written for the 30-day retention sweep;
// no analytics/ad SDKs ever load on the surfaces a child touches.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { findActiveCodeByPlaintext } from '@/lib/coppa/codes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-sdk-not-configured' }, { status: 503 });

  let body: { code?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const raw = (body.code || '').trim();
  if (!raw) return NextResponse.json({ ok: false, error: 'missing-code' }, { status: 400 });

  const match = await findActiveCodeByPlaintext(raw);
  if (!match) return NextResponse.json({ ok: false, error: 'invalid-code' }, { status: 404 });

  // Load the child for name/profile seeding.
  const childRef = db.collection('families').doc(match.familyId).collection('children').doc(match.childId);
  const childSnap = await childRef.get();
  if (!childSnap.exists) return NextResponse.json({ ok: false, error: 'child-missing' }, { status: 404 });
  const child = childSnap.data() || {};
  const childName = (child.name as string) || 'Kaya kid';

  // Kid identity uses the childId as the auth uid (stable, derivable). Upsert
  // (merge) the profile so existing fields are preserved and the app can read
  // role/familyId/childId immediately after sign-in.
  const uid = match.childId;
  try {
    await db.collection('users').doc(uid).set(
      {
        role: 'kid',
        familyId: match.familyId,
        childId: match.childId,
        name: childName,
        lastKidLoginAt: new Date(),
      },
      { merge: true },
    );
    // Kid session record — minimal, subject to the 30-day Max-Privacy sweep.
    await db.collection('childSessions').add({
      childId: match.childId,
      familyId: match.familyId,
      createdAt: new Date(),
    });
  } catch {
    return NextResponse.json({ ok: false, error: 'session-failed' }, { status: 500 });
  }

  let customToken: string;
  try {
    customToken = await auth.createCustomToken(uid, { role: 'kid', familyId: match.familyId, childId: match.childId });
  } catch {
    return NextResponse.json({ ok: false, error: 'token-failed' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, token: customToken, childName });
}
