// 🔐 Security & privacy (SET PR4 · M16 / Bonus A) — "Sign out everywhere".
//
// The lost-phone button: a parent revokes the refresh tokens of EVERY auth
// account in the family (parents, kids, helpers). Live sessions die as soon
// as their current ID token expires (≤1h); new sign-ins need credentials.
// Parent-only, ID-token verified, traced in the 📜 alertLog.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let callerUid: string;
  try { callerUid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  const callerSnap = await db.collection('users').doc(callerUid).get();
  const caller = callerSnap.data() as { role?: string; familyId?: string } | undefined;
  if (!caller || caller.role !== 'parent' || !caller.familyId) {
    return NextResponse.json({ ok: false, error: 'not-a-parent' }, { status: 403 });
  }
  const familyId = caller.familyId;

  try {
    const members = await db.collection('users').where('familyId', '==', familyId).get();
    let revoked = 0;
    for (const m of members.docs) {
      try { await auth.revokeRefreshTokens(m.id); revoked++; } catch { /* ghost accounts skip */ }
    }
    try {
      await db.collection('families').doc(familyId).collection('alertLog').add({
        kind: 'security', trigger: 'system', at: Date.now(), byUid: callerUid,
        detail: `sign-out-everywhere: refresh tokens revoked for ${revoked} account(s)`,
      });
    } catch { /* trace is best-effort */ }
    return NextResponse.json({ ok: true, revoked });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
