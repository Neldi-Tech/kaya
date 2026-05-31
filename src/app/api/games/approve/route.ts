// Kaya Games — parent approval of a pending game (Admin SDK).
//
// A finished game worth > 0 HP sits as a 'pending' gamePlay (see
// /api/games/award) and credits NOTHING until a parent says yes — HP carries
// real cash value. This route is that yes/no.
//
// gamePlays are write:false for every client (forge-proof), so approval can't
// be a client write; it runs here under the Admin SDK with a verified PARENT
// token. On approve it applies the family's daily + weekly caps AT APPROVAL
// TIME (the parent's own guardrail), writes the House Points award + bumps the
// kid's balance, and stamps the play approved — all atomically. On reject it
// just stamps the play rejected. An optional parent note rides along to the
// kid either way.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { getGame } from '@/lib/gamesCatalog';
import { resolveGamesConfig } from '@/lib/games';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ApproveBody {
  playId?: string;
  action?: 'approve' | 'reject';
  note?: string;
}

interface PlayDoc {
  kidId?: string;
  gameId?: string;
  gameName?: string;
  world?: string;
  status?: string;
  pointsPending?: number;
  pointsAwarded?: number;
  dateKey?: string;
  weekKey?: string;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: ApproveBody;
  try { body = (await req.json()) as ApproveBody; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const playId = (body.playId || '').trim();
  const action = body.action;
  if (!playId) return NextResponse.json({ error: 'no-play-id' }, { status: 400 });
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json({ error: 'bad-action' }, { status: 400 });
  }
  const note = typeof body.note === 'string' ? body.note.trim().slice(0, 280) : '';

  // Only a PARENT in the family may approve/reject — this is a money action.
  const parent = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; displayName?: string; name?: string } | undefined;
  const familyId = parent?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (parent?.role !== 'parent') {
    return NextResponse.json({ error: 'not-a-parent' }, { status: 403 });
  }
  const parentName = parent.displayName || parent.name || 'Parent';

  const playRef = db.collection('families').doc(familyId).collection('gamePlays').doc(playId);
  const playSnap = await playRef.get();
  if (!playSnap.exists) return NextResponse.json({ error: 'no-play' }, { status: 404 });
  const play = playSnap.data() as PlayDoc;
  if (play.status !== 'pending') {
    // Someone (another parent / a refresh) already handled it — idempotent.
    return NextResponse.json({ ok: true, alreadyResolved: true, status: play.status });
  }

  // ── Reject ───────────────────────────────────────────────────────────────
  if (action === 'reject') {
    await playRef.update({
      status: 'rejected', pointsPending: 0, pointsAwarded: 0,
      resolvedAt: Date.now(), resolvedBy: uid,
      ...(note ? { parentNote: note } : {}),
    });
    return NextResponse.json({ ok: true, status: 'rejected' });
  }

  // ── Approve ────────────────────────────────────────────────────────────
  const kidId = play.kidId || '';
  if (!kidId) return NextResponse.json({ error: 'play-missing-kid' }, { status: 422 });

  const famSnap = await db.collection('families').doc(familyId).get();
  const cfg = resolveGamesConfig(famSnap.data()?.gamesConfig);

  const childRef = db.collection('families').doc(familyId).collection('children').doc(kidId);
  const childSnap = await childRef.get();
  if (!childSnap.exists) return NextResponse.json({ error: 'no-child' }, { status: 404 });
  const child = childSnap.data() as { totalPoints?: number; weeklyPoints?: number };

  let credit = Math.max(0, Math.round(Number(play.pointsPending) || 0));
  let capped = false;

  // Caps are the parent's own guardrail; they clip even at approval. Calm
  // Corner is exempt when the family leaves it uncapped.
  const calmExempt = play.world === 'calm' && cfg.calmUncapped;
  if (!calmExempt && (cfg.dailyPointsCap > 0 || cfg.weeklyPointsCap > 0)) {
    // One equality-only query (kidId + status) — no composite index needed.
    const approvedSnap = await db.collection('families').doc(familyId).collection('gamePlays')
      .where('kidId', '==', kidId).where('status', '==', 'approved').get();

    let earnedToday = 0;
    let earnedWeek = 0;
    approvedSnap.forEach((d) => {
      const p = d.data() as PlayDoc;
      if (p.world === 'calm' && cfg.calmUncapped) return; // calm never consumes a cap
      const pts = Number(p.pointsAwarded) || 0;
      if (p.dateKey && play.dateKey && p.dateKey === play.dateKey) earnedToday += pts;
      if (p.weekKey && play.weekKey && p.weekKey === play.weekKey) earnedWeek += pts;
    });

    if (cfg.dailyPointsCap > 0) {
      const remainingDay = Math.max(0, cfg.dailyPointsCap - earnedToday);
      if (credit > remainingDay) { credit = remainingDay; capped = true; }
    }
    if (cfg.weeklyPointsCap > 0) {
      const remainingWeek = Math.max(0, cfg.weeklyPointsCap - earnedWeek);
      if (credit > remainingWeek) { credit = remainingWeek; capped = true; }
    }
  }

  const game = getGame(play.gameId || '');
  const gameName = play.gameName || game?.name || 'a game';

  const batch = db.batch();
  batch.update(playRef, {
    status: 'approved', pointsAwarded: credit, pointsPending: 0, capped,
    resolvedAt: Date.now(), resolvedBy: uid,
    ...(note ? { parentNote: note } : {}),
  });
  // Only mint an award + bump the balance when something actually lands.
  if (credit > 0) {
    const awardRef = db.collection('families').doc(familyId).collection('awards').doc();
    batch.set(awardRef, {
      childId: kidId, kind: 'regular', points: credit,
      reason: `Kaya Games — ${gameName}`, category: 'game',
      awardedBy: uid, awardedByName: parentName, senderRole: 'parent',
      createdAt: new Date(),
    });
    batch.update(childRef, {
      totalPoints: (child.totalPoints || 0) + credit,
      weeklyPoints: (child.weeklyPoints || 0) + credit,
    });
  }
  try { await batch.commit(); }
  catch (e) { return NextResponse.json({ error: 'approve-failed', detail: String(e) }, { status: 500 }); }

  return NextResponse.json({
    ok: true, status: 'approved', pointsAwarded: credit, capped,
    newTotal: (child.totalPoints || 0) + credit,
  });
}
