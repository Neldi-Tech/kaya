// Gmail connect — disconnect (authed).
//
// Revokes the stored refresh token at Google (best-effort) and deletes the
// connection doc, so the weekly cron stops scanning this mailbox. The parent
// stays in full control: one tap removes all standing access. familyId +
// uid come from the verified token.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { getConnection, deleteConnection } from '@/lib/gmailConnections';
import { decryptToken } from '@/lib/gmailTokenCrypto';
import { revokeToken } from '@/lib/gmailSubscriptionScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const familyId = (await db.collection('users').doc(uid).get()).data()?.familyId as string || '';
  if (!familyId) return NextResponse.json({ ok: false });

  const conn = await getConnection(familyId, uid);
  if (conn?.refreshTokenEnc) {
    const refresh = decryptToken(conn.refreshTokenEnc);
    if (refresh) await revokeToken(refresh);
  }
  await deleteConnection(familyId, uid);
  return NextResponse.json({ ok: true });
}
