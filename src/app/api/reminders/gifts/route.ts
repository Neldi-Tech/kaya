// 🎁 Gift Brain (R2) — per-person gift-idea stash. PARENTS-ONLY: gift ideas
// must never spoil the surprise for the kid, so every action requires the
// caller to be a parent in the family. Admin SDK — no rules deploy needed
// (see lib/reminders header). POST { action: 'list' | 'save' | 'delete' }.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import type { GiftIdea } from '@/lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function clampStr(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

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
    { familyId?: string; role?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  // Parents only — keep the surprise.
  if (user?.role !== 'parent') return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  let body: { action?: string; idea?: Record<string, unknown>; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action = body.action || 'list';
  const col = db.collection('families').doc(familyId).collection('giftIdeas');

  if (action === 'list') {
    const snap = await col.get();
    const ideas: GiftIdea[] = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) } as GiftIdea));
    return NextResponse.json({ ideas });
  }

  if (action === 'delete') {
    const id = clampStr(body.id, 200);
    if (id) await col.doc(id).delete().catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // save (create or update)
  const g = (body.idea && typeof body.idea === 'object' ? body.idea : {}) as Record<string, unknown>;
  const personName = clampStr(g.personName, 120).trim();
  const text = clampStr(g.text, 400).trim();
  if (!personName || !text) return NextResponse.json({ error: 'personName + text required' }, { status: 400 });
  const base = {
    personName,
    linkedChildId: clampStr(g.linkedChildId, 120) || null,
    text,
    done: !!g.done,
    updatedAt: Date.now(),
  };

  const editId = clampStr(g.id as string, 200);
  if (editId) {
    await col.doc(editId).set(base, { merge: true });
    return NextResponse.json({ idea: { id: editId, familyId, ...base } });
  }
  const doc = await col.add({
    ...base,
    createdByUid: uid,
    createdByName: user?.displayName || '',
    createdAt: Date.now(),
  });
  return NextResponse.json({ idea: { id: doc.id, familyId, ...base } });
}
