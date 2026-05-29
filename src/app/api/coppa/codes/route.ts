// Kaya · COPPA + Login — manage a child's Kaya Code (parent-only).
//
//   GET  ?childId=…             → current status (never the plaintext — gone).
//   POST { childId, action }    → pause | resume | revoke | regenerate.
//
// `regenerate` returns a fresh plaintext code ONCE (same one-time-view contract
// as first issue). Everything runs server-side with the Admin SDK, so the
// childCodes collection stays fully closed to clients.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { getChildCodeStatus, setChildCodeStatus, issueChildCode } from '@/lib/coppa/codes';
import { getServerUserProfile } from '@/lib/coppa/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Verify Bearer token → parent profile → child is in their family. Returns the
// parent uid + familyId, or a NextResponse to short-circuit with.
async function authParentForChild(
  req: NextRequest,
  childId: string,
): Promise<{ uid: string; familyId: string } | NextResponse> {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-sdk-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });

  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  const profile = await getServerUserProfile(uid);
  if (!profile || profile.role !== 'parent' || !profile.familyId) {
    return NextResponse.json({ ok: false, error: 'not-a-parent' }, { status: 403 });
  }
  if (!childId) return NextResponse.json({ ok: false, error: 'missing-childId' }, { status: 400 });
  const childSnap = await db.collection('families').doc(profile.familyId).collection('children').doc(childId).get();
  if (!childSnap.exists) return NextResponse.json({ ok: false, error: 'child-not-in-family' }, { status: 403 });

  return { uid, familyId: profile.familyId };
}

export async function GET(req: NextRequest) {
  const childId = (req.nextUrl.searchParams.get('childId') || '').trim();
  const authed = await authParentForChild(req, childId);
  if (authed instanceof NextResponse) return authed;

  const { status, createdAt } = await getChildCodeStatus(childId);
  return NextResponse.json({ ok: true, status, createdAt: createdAt ? createdAt.toISOString() : null });
}

export async function POST(req: NextRequest) {
  let body: { childId?: string; action?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const childId = (body.childId || '').trim();
  const action = body.action || '';

  const authed = await authParentForChild(req, childId);
  if (authed instanceof NextResponse) return authed;

  if (action === 'regenerate') {
    try {
      const { code, expiresAt } = await issueChildCode({ childId, familyId: authed.familyId, createdBy: authed.uid });
      return NextResponse.json({ ok: true, status: 'active', code, expiresAt: expiresAt.toISOString() });
    } catch {
      return NextResponse.json({ ok: false, error: 'issue-failed' }, { status: 500 });
    }
  }

  if (action === 'pause' || action === 'resume' || action === 'revoke') {
    const status = await setChildCodeStatus(childId, action);
    if (!status) return NextResponse.json({ ok: false, error: 'no-code-to-update' }, { status: 409 });
    return NextResponse.json({ ok: true, status });
  }

  return NextResponse.json({ ok: false, error: 'bad-action' }, { status: 400 });
}
