// Gmail connect — resolve suggestions (authed).
//
// The review sheet calls this after the parent confirms: addedIds are the
// suggestions they turned into subscriptions (client created them), and
// dismissedIds are the ones they skipped. We mark each so it never
// re-appears — dismissed docs stay as dedupe tombstones. familyId is derived
// from the caller's own profile.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { resolveSuggestions } from '@/lib/gmailConnections';

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

  let body: { addedIds?: unknown; dismissedIds?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { body = {}; }

  const clean = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : [];

  await resolveSuggestions(familyId, clean(body.addedIds), clean(body.dismissedIds));
  return NextResponse.json({ ok: true });
}
