// 💭 Badge wishes (BDG PR5 · B21) — a kid asks for a badge in their own
// words; it lands in the parent's 🪄 Badge Studio as a proposal to shape and
// release. Same shape as 💡 Reward Ideas from Kids: the kid suggests, the
// parent decides.
//
// POST (kid or parent) → create a wish, with a small daily quota so the
//   Studio never fills up with spam.
// GET  (parent)        → the open wish list.
// PATCH (parent)       → mark one done/dismissed (kept, never deleted, so the
//   kid's ask stays visible in the trail).
//
// Admin-gateway only: kids can't write family collections under the rules and
// this needs zero rules deploys. Index-free (one equality filter, sorted in
// memory) so no index deploy either.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const DAILY_QUOTA = 3;

async function who(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return { error: NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 }) };
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return { error: NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 }) };
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return { error: NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }) }; }
  const prof = (await db.collection('users').doc(uid).get()).data() as
    { role?: string; familyId?: string; childId?: string; displayName?: string; name?: string } | undefined;
  if (!prof?.familyId) return { error: NextResponse.json({ ok: false, error: 'no-family' }, { status: 403 }) };
  return { db, uid, prof, familyId: prof.familyId };
}

export async function POST(req: NextRequest) {
  const ctx = await who(req);
  if ('error' in ctx) return ctx.error;
  const { db, uid, prof, familyId } = ctx;

  let body: { text?: string; childId?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const text = (body.text || '').trim().slice(0, 240);
  if (!text) return NextResponse.json({ ok: false, error: 'missing-text' }, { status: 400 });

  const isKid = prof!.role === 'kid';
  const childId = isKid ? (prof!.childId || '') : (body.childId || '').trim();
  if (!childId) return NextResponse.json({ ok: false, error: 'missing-childId' }, { status: 400 });

  const col = db!.collection('families').doc(familyId).collection('badgeWishes');

  // Daily quota per kid — counted in memory off a single equality filter.
  const since = Date.now() - 24 * 60 * 60 * 1000;
  try {
    const mine = await col.where('childId', '==', childId).limit(60).get();
    const recent = mine.docs.filter((d) => {
      const at = (d.data() as { createdAtMs?: number }).createdAtMs;
      return typeof at === 'number' && at >= since;
    }).length;
    if (recent >= DAILY_QUOTA) {
      return NextResponse.json({ ok: false, error: 'quota', quota: DAILY_QUOTA }, { status: 429 });
    }
  } catch { /* quota check is best-effort; never blocks a genuine wish */ }

  const ref = await col.add({
    childId,
    text,
    byUid: uid,
    byName: prof!.displayName || prof!.name || 'Kid',
    status: 'open',
    createdAt: FieldValue.serverTimestamp(),
    // Plain ms too: the quota window above must not wait on a serverTimestamp.
    createdAtMs: Date.now(),
  });

  // 🔔 tell the parents there's something to look at.
  try {
    const parents = await db!.collection('users')
      .where('familyId', '==', familyId).where('role', '==', 'parent').limit(5).get();
    for (const p of parents.docs) {
      await db!.collection('families').doc(familyId).collection('notifications').add({
        type: 'reward',
        forUserId: p.id,
        title: '💭 A badge wish came in',
        message: `"${text.slice(0, 80)}" — open 🪄 Badge Studio to shape it.`,
        read: false,
        link: '/parent/rewards#badge-studio',
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  } catch { /* bell is best-effort */ }

  return NextResponse.json({ ok: true, id: ref.id });
}

export async function GET(req: NextRequest) {
  const ctx = await who(req);
  if ('error' in ctx) return ctx.error;
  const { db, prof, familyId } = ctx;
  if (prof!.role !== 'parent') return NextResponse.json({ ok: false, error: 'parents-only' }, { status: 403 });

  try {
    const snap = await db!.collection('families').doc(familyId).collection('badgeWishes')
      .where('status', '==', 'open').limit(100).get();
    const rows = snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        childId: String(v.childId ?? ''),
        text: String(v.text ?? ''),
        byName: String(v.byName ?? 'Kid'),
        createdAtMs: typeof v.createdAtMs === 'number' ? v.createdAtMs : 0,
      };
    }).sort((a, b) => b.createdAtMs - a.createdAtMs);
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'wishes-failed' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const ctx = await who(req);
  if ('error' in ctx) return ctx.error;
  const { db, uid, prof, familyId } = ctx;
  if (prof!.role !== 'parent') return NextResponse.json({ ok: false, error: 'parents-only' }, { status: 403 });

  let body: { id?: string; status?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const id = (body.id || '').trim();
  const status = body.status === 'granted' ? 'granted' : 'dismissed';
  if (!id) return NextResponse.json({ ok: false, error: 'missing-id' }, { status: 400 });

  try {
    await db!.collection('families').doc(familyId).collection('badgeWishes').doc(id)
      .set({ status, resolvedBy: uid, resolvedAt: FieldValue.serverTimestamp() }, { merge: true });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'update-failed' }, { status: 500 });
  }
}
