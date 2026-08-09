// 🔧 Meeting finish gateway (approved 2026-08-09).
//
// WHY THIS EXISTS: the `meetings` collection is CREATE-only for family
// members in Firestore rules — there is no update rule. The presenter
// saves tonight's meeting under a fixed id (`weekly-<date>`) so retries
// stay idempotent, which means the SECOND save of a night (tap "Finish
// again" after a hiccup, or re-running the presenter) is an UPDATE — and
// got permission-denied ("Could not save…", 2026-08-02 report). The Goals
// Review write-backs (`goalsDone` onto older meetings) and Sunday Surprise
// mission patches hit the same wall silently.
//
// This route does those writes server-side (Admin SDK bypasses rules)
// after verifying the caller's ID token + family membership — the same
// gateway pattern as Diary/Birthdays. Zero rules deploys.
//
// Actions:
//   { action: 'upsert', familyId, meeting }            → set meetings/weekly-<date>
//   { action: 'patch',  familyId, meetingId, updates } → merge fields onto a meeting

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only these fields may be patched onto an existing meeting — the
// write-back surface (goal review + surprise missions), not a free-for-all.
const PATCHABLE = new Set(['goalsDone', 'surprise']);

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

  let body: {
    action?: string;
    familyId?: string;
    meeting?: Record<string, unknown>;
    meetingId?: string;
    updates?: Record<string, unknown>;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 400 }); }

  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  if (!familyId) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });

  // Membership: a users doc in this family (parents, helpers, kids with
  // their own auth) or a children doc carrying this uid (kid logins).
  const callerSnap = await db.collection('users').doc(callerUid).get();
  let belongs = callerSnap.exists && callerSnap.data()?.familyId === familyId;
  if (!belongs) {
    const kid = await db.collection('families').doc(familyId)
      .collection('children').where('uid', '==', callerUid).limit(1).get();
    belongs = !kid.empty;
  }
  if (!belongs) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const meetingsCol = db.collection('families').doc(familyId).collection('meetings');

  if (body.action === 'upsert') {
    const meeting = body.meeting;
    const date = meeting && typeof meeting.date === 'string' ? meeting.date : '';
    if (!meeting || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ ok: false, error: 'bad-meeting' }, { status: 400 });
    }
    // Same idempotent id the client used — one weekly record per night.
    const id = `weekly-${date}`;
    // JSON round-trip already stripped undefined (Admin rejects it).
    await meetingsCol.doc(id).set({ ...meeting, createdAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ ok: true, id });
  }

  if (body.action === 'patch') {
    const meetingId = typeof body.meetingId === 'string' ? body.meetingId : '';
    const updates = body.updates && typeof body.updates === 'object' ? body.updates : null;
    if (!meetingId || !updates) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (PATCHABLE.has(k) && v !== undefined) clean[k] = v;
    }
    if (Object.keys(clean).length === 0) return NextResponse.json({ ok: false, error: 'nothing-patchable' }, { status: 400 });
    const ref = meetingsCol.doc(meetingId);
    if (!(await ref.get()).exists) return NextResponse.json({ ok: false, error: 'not-found' }, { status: 404 });
    await ref.set(clean, { merge: true });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ ok: false, error: 'bad-action' }, { status: 400 });
}
