import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

// Sparks · 📷 scan trace (2026-09-26).
//
// Kids told Elia "it does not accept the pictures" and there was no
// evidence anywhere of WHAT failed on THEIR phones. This is the missing
// eye: the reflection/diary scan flow reports each failure step
// (upload · ocr · capture) with the error text and the device UA to the
// family's 📜 alert log — best-effort, never blocking the kid. Admin
// gateway → zero rules deploys; kids can call it (own family only).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; displayName?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const body = await req.json().catch(() => ({})) as {
    kidId?: string; surface?: string; step?: string; error?: string; ua?: string;
  };
  const clamp = (v: unknown, n: number) => String(v ?? '').slice(0, n);
  const step = clamp(body.step, 40) || 'unknown';
  const kidId = clamp(body.kidId, 80);
  let childName = '';
  if (kidId) {
    const k = await db.collection('families').doc(familyId).collection('children').doc(kidId).get().catch(() => null);
    childName = String((k?.data() as { name?: string } | undefined)?.name || '').split(' ')[0];
  }

  await db.collection('families').doc(familyId).collection('alertLog').add({
    kind: 'scan_trace', firedAt: Date.now(), trigger: 'system',
    childId: kidId || null, childName: childName || (user?.displayName || '').split(' ')[0] || null,
    surface: clamp(body.surface, 20) || 'reflection',
    step, error: clamp(body.error, 300), ua: clamp(body.ua, 200),
    by: uid, byRole: user?.role || 'parent',
    sourceLabel: `📷 scan ${step} failed`,
  }).catch(() => { /* the trace must never block the kid */ });

  return NextResponse.json({ ok: true });
}
