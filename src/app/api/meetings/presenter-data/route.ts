// 🧒 Kid-led meetings — presenter data gateway (2026-08-16).
//
// WHY: `upcomingMeetingSubmissions` + `meetingSubmissionHistory` are
// readable by parents/helpers, but a KID may read only their OWN doc —
// and a collection listen under that rule is denied outright (rules are
// not filters). So a kid running the Sunday meeting saw NO prep at all:
// no gratitudes, appreciations, goals, topics, no crown, no goal review.
//
// This route returns the family's prep + history to ANY verified member
// (same membership check as /api/meetings/finish) — the meeting is a
// family activity; the leader must see everything. Zero rules deploys.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let callerUid: string;
  try { callerUid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  const familyId = req.nextUrl.searchParams.get('familyId') || '';
  if (!familyId) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });

  const callerSnap = await db.collection('users').doc(callerUid).get();
  let belongs = callerSnap.exists && callerSnap.data()?.familyId === familyId;
  if (!belongs) {
    const kid = await db.collection('families').doc(familyId)
      .collection('children').where('uid', '==', callerUid).limit(1).get();
    belongs = !kid.empty;
  }
  if (!belongs) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });

  const fam = db.collection('families').doc(familyId);
  const [subs, hist] = await Promise.all([
    fam.collection('upcomingMeetingSubmissions').get(),
    fam.collection('meetingSubmissionHistory').get(),
  ]);
  return NextResponse.json({
    ok: true,
    submissions: subs.docs.map((d) => d.data()),
    history: hist.docs.map((d) => d.data()),
  });
}
