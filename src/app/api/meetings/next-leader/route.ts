// 🎡 Next-leader gateway (Sunday Meeting upgrade · PR1 · approved 2026-09-21).
//
// WHY THIS EXISTS: the Leader Wheel + name chips saved `nextMeetingLeader`
// with a client `updateFamily()` — and the family doc is parents-only in
// Firestore rules. When a KID led the meeting from their own login the
// wheel spun, celebrated… and saved nothing ("Missing or insufficient
// permissions", 2026-09-20 report), so the queue never changed and the
// 👑 crown had to be moved by hand every week.
//
// This route does the write server-side (Admin SDK) after verifying the
// caller's ID token + family membership — the same gateway idiom as
// /api/meetings/finish. Zero rules deploys.
//
// Rules it enforces (design R1–R5):
//   • `pick`  — parents only. Kids use the wheel (fair, no "I pick me").
//   • `spin`  — anyone in the family. THE SERVER DRAWS the winner; the
//               wheel on screen only animates to it. Non-parents get ONE
//               spin per meeting night; parents may re-spin freely.
//   • sit-out — tonight's leader + the current crown-wearer are left out
//               of the draw so the crown always moves (family switch
//               `meetingSetup.wheelSitOut`, default ON; switches itself
//               off when fewer than 2 people would remain).

import { NextRequest, NextResponse } from 'next/server';
import { randomInt } from 'crypto';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Kind = 'parent' | 'kid';
interface Member { id: string; name: string; emoji: string; kind: Kind }

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
    date?: string;
    memberId?: string;
    poolIds?: unknown;
    tonightLeaderId?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'bad-json' }, { status: 400 }); }

  const familyId = typeof body.familyId === 'string' ? body.familyId : '';
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : '';
  if (!familyId || !date) return NextResponse.json({ ok: false, error: 'bad-args' }, { status: 400 });

  const userSnap = await db.collection('users').doc(callerUid).get();
  const user = userSnap.data() as { familyId?: string; role?: string; displayName?: string } | undefined;
  if (!user || user.familyId !== familyId) return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  const isParent = user.role === 'parent';
  const callerName = (user.displayName || '').trim().slice(0, 60) || (isParent ? 'A parent' : 'The leader');

  const famRef = db.collection('families').doc(familyId);
  const fam = ((await famRef.get()).data() || {}) as {
    houseLeader?: { childId?: string } | null;
    meetingSetup?: { wheelSitOut?: boolean };
    leaderWheel?: { kidSpinDate?: string };
  };

  // The real roster — names + emoji come from the server's own data, so a
  // forged request can never write a made-up leader onto the family.
  const [parentsSnap, kidsSnap] = await Promise.all([
    db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get(),
    famRef.collection('children').get(),
  ]);
  const roster = new Map<string, Member>();
  parentsSnap.docs.forEach((d) => {
    const p = d.data() as { displayName?: string; avatarEmoji?: string };
    roster.set(d.id, { id: d.id, name: p.displayName || 'Parent', emoji: p.avatarEmoji || '👤', kind: 'parent' });
  });
  kidsSnap.docs.forEach((d) => {
    const c = d.data() as { name?: string; avatarEmoji?: string };
    roster.set(d.id, { id: d.id, name: c.name || 'Kid', emoji: c.avatarEmoji || '🧒', kind: 'kid' });
  });

  const save = async (m: Member, via: 'wheel' | 'pick', extra: Record<string, unknown> = {}) => {
    const nextMeetingLeader = {
      id: m.id, name: m.name, emoji: m.emoji, kind: m.kind,
      pickedBy: callerUid, pickedByName: callerName, pickedAt: Date.now(), via,
    };
    await famRef.set({ nextMeetingLeader, ...extra }, { merge: true });
    return nextMeetingLeader;
  };

  if (body.action === 'pick') {
    if (!isParent) return NextResponse.json({ ok: false, error: 'kids-use-wheel' }, { status: 403 });
    const m = roster.get(typeof body.memberId === 'string' ? body.memberId : '');
    if (!m) return NextResponse.json({ ok: false, error: 'not-in-family' }, { status: 400 });
    return NextResponse.json({ ok: true, leader: await save(m, 'pick') });
  }

  if (body.action === 'spin') {
    if (!isParent && fam.leaderWheel?.kidSpinDate === date) {
      return NextResponse.json({ ok: false, error: 'already-spun' }, { status: 409 });
    }
    // The pool the presenter shows (it applies the family's meeting age
    // gate); every id must still be a real member of THIS family.
    const asked = Array.isArray(body.poolIds) ? body.poolIds.filter((x): x is string => typeof x === 'string').slice(0, 40) : [];
    const pool = (asked.length ? asked : Array.from(roster.keys()))
      .map((id) => roster.get(id))
      .filter((m): m is Member => !!m);
    if (pool.length === 0) return NextResponse.json({ ok: false, error: 'empty-pool' }, { status: 400 });

    const sitOutOn = fam.meetingSetup?.wheelSitOut !== false;
    const sitOut = new Set<string>();
    if (sitOutOn) {
      if (typeof body.tonightLeaderId === 'string' && roster.has(body.tonightLeaderId)) sitOut.add(body.tonightLeaderId);
      if (fam.houseLeader?.childId) sitOut.add(fam.houseLeader.childId);
    }
    let eligible = pool.filter((m) => !sitOut.has(m.id));
    let sitOutApplied = true;
    if (eligible.length < 2) { eligible = pool; sitOutApplied = false; }

    const winner = eligible[randomInt(eligible.length)];
    const leader = await save(winner, 'wheel', isParent ? {} : {
      leaderWheel: { kidSpinDate: date, byUid: callerUid, byName: callerName, at: Date.now() },
    });
    return NextResponse.json({
      ok: true,
      leader,
      eligibleIds: eligible.map((m) => m.id),
      sitOutIds: sitOutApplied ? pool.filter((m) => sitOut.has(m.id)).map((m) => m.id) : [],
    });
  }

  return NextResponse.json({ ok: false, error: 'bad-action' }, { status: 400 });
}
