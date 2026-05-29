// Kaya · COPPA + Login — issue a Kaya Code for a child (parent-only).
//
// Two callers:
//   • /family/add-child — first issue. `recordConsent: true`, so this also
//     writes the verifiable-parental-consent record AND requires a FRESH
//     password re-auth (token auth_time within the window). That re-auth is
//     the COPPA verification mechanism (16 C.F.R. § 312.5(b)).
//   • /family/codes/[childId] — "regenerate". Parent role is enough; no new
//     consent record (consent already on file for this child).
//
// Runs server-side with the Admin SDK: the plaintext code is returned to the
// parent exactly once and never persisted (only its bcrypt hash + lookup are).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { issueChildCode } from '@/lib/coppa/codes';
import { recordCoppaConsent, getServerUserProfile, isFreshReauth } from '@/lib/coppa/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-sdk-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });

  let uid: string;
  let authTime: number | undefined;
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = decoded.uid;
    authTime = decoded.auth_time;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 });
  }

  let body: { childId?: string; childFirstName?: string; childDateOfBirth?: string; recordConsent?: boolean };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const childId = (body.childId || '').trim();
  if (!childId) return NextResponse.json({ ok: false, error: 'missing-childId' }, { status: 400 });

  // Caller must be a PARENT, and the child must live in their family.
  const profile = await getServerUserProfile(uid);
  if (!profile || profile.role !== 'parent' || !profile.familyId) {
    return NextResponse.json({ ok: false, error: 'not-a-parent' }, { status: 403 });
  }
  const familyId = profile.familyId;
  const childSnap = await db.collection('families').doc(familyId).collection('children').doc(childId).get();
  if (!childSnap.exists) {
    return NextResponse.json({ ok: false, error: 'child-not-in-family' }, { status: 403 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent');

  // First issue → record verifiable parental consent, gated on a fresh re-auth.
  if (body.recordConsent) {
    if (!isFreshReauth(authTime)) {
      return NextResponse.json({ ok: false, error: 'reauth-required' }, { status: 401 });
    }
    const childData = childSnap.data() || {};
    const firstName = (body.childFirstName || (childData.name as string) || '').split(' ')[0] || 'your child';
    const dob = body.childDateOfBirth || (childData.birthday as string) || '';
    await recordCoppaConsent({
      familyId,
      childId,
      parentUserId: uid,
      childFirstName: firstName,
      childDateOfBirth: dob,
      verificationAt: authTime ? new Date(authTime * 1000) : new Date(),
      userAgent,
      ip,
    });
  }

  try {
    const { code, expiresAt } = await issueChildCode({ childId, familyId, createdBy: uid });
    return NextResponse.json({ ok: true, code, expiresAt: expiresAt.toISOString() });
  } catch {
    return NextResponse.json({ ok: false, error: 'issue-failed' }, { status: 500 });
  }
}
