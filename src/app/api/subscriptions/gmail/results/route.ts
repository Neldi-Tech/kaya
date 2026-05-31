// Gmail connect — step 3: hand the parsed drafts to the page.
//
// After the callback stashes drafts under the parent's uid, the
// subscriptions page (seeing ?gmailScan=done) calls this with the user's
// Firebase ID token. We verify the token, derive the familyId from the
// user's own profile (never trusting client input), read the stash, DELETE
// it (consume-once), and return the drafts for the review sheet.
//
// Admin-only read/write → no Firestore-rules deploy. A user can only ever
// fetch a stash keyed by their own verified uid.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ drafts: [] });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });

  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  // Derive familyId from the user's own profile — not from the client.
  const userSnap = await db.collection('users').doc(uid).get();
  const familyId = (userSnap.data()?.familyId as string) || '';
  if (!familyId) return NextResponse.json({ drafts: [] });

  const ref = db
    .collection('families').doc(familyId)
    .collection('subscriptionScans').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ drafts: [] });

  const drafts = (snap.data()?.drafts as unknown[]) || [];
  // Consume-once: delete the stash so a refresh can't replay it.
  await ref.delete().catch(() => {});

  return NextResponse.json({ drafts });
}
