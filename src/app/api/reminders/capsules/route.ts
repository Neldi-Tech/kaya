// 📮 Time Capsule (R3) — schedule a message (+ photo) to auto-deliver on a
// future date. Admin SDK — no rules deploy needed (see lib/reminders header).
// Any family member can create one. The daily reminders cron does the actual
// delivery. POST { action: 'list' | 'save' | 'delete' }.
//
// `list` returns capsules relevant to the caller — ones they created, plus
// ones addressed to them that have already been delivered (so a recipient can
// re-read a delivered capsule, but can't peek at a pending one for them).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import type { TimeCapsule, CapsuleAudience } from '@/lib/reminders';

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
    { familyId?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  let body: { action?: string; capsule?: Record<string, unknown>; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action = body.action || 'list';
  const col = db.collection('families').doc(familyId).collection('timeCapsules');

  if (action === 'list') {
    const snap = await col.get();
    const capsules: TimeCapsule[] = [];
    snap.forEach((d) => {
      const c = { id: d.id, ...(d.data() as Record<string, unknown>) } as TimeCapsule;
      const mine = c.createdByUid === uid;
      const toMeDelivered = c.delivered && (c.toUid === uid || c.audience === 'family');
      if (mine || toMeDelivered) capsules.push(c);
    });
    return NextResponse.json({ capsules });
  }

  if (action === 'delete') {
    const id = clampStr(body.id, 200);
    if (!id) return NextResponse.json({ error: 'bad-id' }, { status: 400 });
    const cur = (await col.doc(id).get()).data() as TimeCapsule | undefined;
    if (cur && cur.createdByUid !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (cur && cur.delivered) return NextResponse.json({ error: 'already-delivered' }, { status: 409 });
    await col.doc(id).delete().catch(() => {});
    return NextResponse.json({ ok: true });
  }

  // save (create or update a not-yet-delivered capsule)
  const c = (body.capsule && typeof body.capsule === 'object' ? body.capsule : {}) as Record<string, unknown>;
  const audience: CapsuleAudience = c.audience === 'family' ? 'family' : c.audience === 'member' ? 'member' : 'self';
  const deliverOn = clampStr(c.deliverOn, 10);
  const message = clampStr(c.message, 2000).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deliverOn)) return NextResponse.json({ error: 'valid deliverOn required' }, { status: 400 });
  if (!message && !clampStr(c.photoUrl, 1000)) return NextResponse.json({ error: 'message or photo required' }, { status: 400 });

  let toUid: string | null = null;
  let toName = clampStr(c.toName, 120);
  if (audience === 'self') { toUid = uid; toName = user?.displayName || 'You'; }
  else if (audience === 'member') {
    toUid = clampStr(c.toUid, 120) || null;
    if (!toUid) return NextResponse.json({ error: 'recipient required' }, { status: 400 });
    // Verify the recipient is in the family.
    const rec = (await db.collection('users').doc(toUid).get()).data() as { familyId?: string; displayName?: string } | undefined;
    if (!rec || rec.familyId !== familyId) return NextResponse.json({ error: 'recipient-not-in-family' }, { status: 403 });
    toName = toName || rec.displayName || 'Family member';
  }

  const base = {
    audience,
    toUid,
    toName: toName || null,
    deliverOn,
    message,
    photoUrl: clampStr(c.photoUrl, 1000) || null,
    voiceUrl: clampStr(c.voiceUrl, 1000) || null,
    updatedAt: Date.now(),
  };

  const editId = clampStr(c.id as string, 200);
  if (editId) {
    const cur = (await col.doc(editId).get()).data() as TimeCapsule | undefined;
    if (!cur) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (cur.createdByUid !== uid) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    if (cur.delivered) return NextResponse.json({ error: 'already-delivered' }, { status: 409 });
    await col.doc(editId).set(base, { merge: true });
    return NextResponse.json({ capsule: { id: editId, familyId, createdByUid: uid, ...base } });
  }

  const doc = await col.add({
    ...base,
    createdByUid: uid,
    createdByName: user?.displayName || '',
    delivered: false,
    createdAt: Date.now(),
  });
  return NextResponse.json({ capsule: { id: doc.id, familyId, createdByUid: uid, delivered: false, ...base } });
}
