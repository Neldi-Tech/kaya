// Gmail connect — state for the Subscriptions page (authed).
//
// One call powers the whole UI: whether THIS parent has Gmail connected
// (so we show a "connected" chip + disconnect), and the family's PENDING
// suggestions (so we show the review banner). familyId is derived from the
// caller's own profile — never trusted from the client.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { getConnection, listPendingSuggestions } from '@/lib/gmailConnections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ connected: false, suggestions: [] });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const familyId = (await db.collection('users').doc(uid).get()).data()?.familyId as string || '';
  if (!familyId) return NextResponse.json({ connected: false, suggestions: [] });

  const [conn, suggestions] = await Promise.all([
    getConnection(familyId, uid),
    listPendingSuggestions(familyId),
  ]);

  return NextResponse.json({
    connected: !!conn,
    email: conn?.email ?? null,
    lastScanAtMs: conn?.lastScanAtMs ?? null,
    suggestions,
  });
}
