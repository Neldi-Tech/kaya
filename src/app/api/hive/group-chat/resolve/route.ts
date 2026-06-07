// POST { familyId, requestId, decision: 'approved'|'rejected', approverUid, note? }
//
// Resolves a kid's create_group_chat approval SERVER-SIDE (Admin SDK).
//
// Why a route: approving creates the group thread with the KID members in
// memberUids, but the PARENT runs the write — and the client `threads` create
// rule requires the writer to be in memberUids, so the parent's client write is
// rejected ("Missing or insufficient permissions"). The Admin SDK bypasses
// rules, so the parent can approve without a rules deploy. Authorisation is
// enforced here: the caller must be a parent of the family.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';

interface Body { familyId?: string; requestId?: string; decision?: string; approverUid?: string; note?: string }

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const approverUid = typeof body.approverUid === 'string' ? body.approverUid : '';
  const decision = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : '';
  const note = typeof body.note === 'string' ? body.note : '';
  if (!familyId || !requestId || !approverUid || !decision) {
    return NextResponse.json({ error: 'bad-args' }, { status: 400 });
  }

  // Authorise: the caller must be a parent of this family.
  const userSnap = await db.collection('users').doc(approverUid).get();
  const u = userSnap.data();
  if (!u || u.role !== 'parent' || u.familyId !== familyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const reqRef = db.collection('families').doc(familyId).collection('approvalRequests').doc(requestId);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const r = reqSnap.data() as Record<string, unknown>;
  if (r.type !== 'create_group_chat') return NextResponse.json({ error: 'wrong-type' }, { status: 400 });
  if (r.status !== 'pending') return NextResponse.json({ error: 'already-resolved' }, { status: 409 });

  const now = FieldValue.serverTimestamp();

  if (decision === 'rejected') {
    await reqRef.update({ status: 'rejected', rejectionReason: note || '', resolvedAt: now, resolvedBy: approverUid });
    return NextResponse.json({ ok: true });
  }

  // Approved → create the group thread (Admin SDK bypasses the member rule).
  const title = String(r.proposedTitle || '').trim().slice(0, 60);
  const members = Array.isArray(r.proposedMembers) ? (r.proposedMembers as Array<{ uid?: string; name?: string; role?: string; avatar?: string }>) : [];
  if (!title) return NextResponse.json({ error: 'no-title' }, { status: 400 });
  const seen = new Set<string>();
  const cleanMembers = members
    .filter((m) => m?.uid && !seen.has(m.uid) && (seen.add(m.uid), true))
    .map((m) => ({ uid: m.uid as string, name: m.name || 'Member', role: m.role || 'kid', ...(m.avatar ? { avatar: m.avatar } : {}) }));
  if (cleanMembers.length < 2) return NextResponse.json({ error: 'too-few-members' }, { status: 400 });

  const threadRef = db.collection('families').doc(familyId).collection('threads').doc();
  await threadRef.set({
    kind: 'group',
    title,
    memberUids: cleanMembers.map((m) => m.uid),
    members: cleanMembers,
    createdByUid: typeof r.createdBy === 'string' ? r.createdBy : approverUid,
    createdByRole: 'kid',
    createdAt: now,
    updatedAt: now,
  });
  await reqRef.update({ status: 'approved', resolvedAt: now, resolvedBy: approverUid, resultingThreadId: threadRef.id });

  return NextResponse.json({ ok: true, threadId: threadRef.id });
}
