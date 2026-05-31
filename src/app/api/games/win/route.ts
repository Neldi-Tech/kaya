// Kaya Games — record a multi-device win (Admin SDK).
//
// When a multi-device game finishes, the host POSTs the sessionId here. The
// route reads the session (forge-proof — it derives the winner itself from
// the session's own winnerUid [board games set it] or top score [Trivia],
// never from the caller), then bumps the winner's gameWins + streak on their
// child doc and resets the other players' streaks. Idempotent via
// session.winRecorded. Child docs are write:false for clients, so this runs
// under the Admin SDK. No rules deploy (child docs already family-readable).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { sessionId?: string }
interface SPlayer { uid: string; name: string }

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

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const sessionId = (body.sessionId || '').trim();
  if (!sessionId) return NextResponse.json({ error: 'no-session' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const sRef = db.collection('families').doc(familyId).collection('gameSessions').doc(sessionId);
  const sSnap = await sRef.get();
  if (!sSnap.exists) return NextResponse.json({ error: 'no-session' }, { status: 404 });
  const s = sSnap.data() as {
    status?: string; players?: SPlayer[]; state?: Record<string, unknown>;
    winnerUid?: string; winRecorded?: boolean;
  };
  if (s.status !== 'done') return NextResponse.json({ ok: true, skipped: true, reason: 'not-done' });
  if (s.winRecorded) return NextResponse.json({ ok: true, alreadyRecorded: true, winnerUid: s.winnerUid ?? null });

  const players = s.players || [];

  // Derive the winner from the session itself: board games stamped winnerUid;
  // Trivia → the single top scorer; collaborative games (Story Builder) → none.
  let winnerUid = s.winnerUid || '';
  if (!winnerUid && s.state && s.state.scores) {
    const scores = s.state.scores as Record<string, number>;
    let best = -1;
    for (const p of players) {
      const v = Number(scores[p.uid] || 0);
      if (v > best) { best = v; winnerUid = p.uid; }
    }
    if (players.filter((p) => Number(scores[p.uid] || 0) === best).length !== 1) winnerUid = '';
  }
  if (winnerUid && !players.some((p) => p.uid === winnerUid)) winnerUid = '';

  // Map each player's auth uid → their child doc id.
  const childOf: Record<string, string> = {};
  await Promise.all(players.map(async (p) => {
    const u = (await db.collection('users').doc(p.uid).get()).data() as { childId?: string } | undefined;
    if (u?.childId) childOf[p.uid] = u.childId;
  }));

  let winnerStreak = 0;
  const batch = db.batch();
  for (const p of players) {
    const childId = childOf[p.uid];
    if (!childId) continue;
    const cRef = db.collection('families').doc(familyId).collection('children').doc(childId);
    if (p.uid === winnerUid) {
      const c = ((await cRef.get()).data() || {}) as { gameWins?: number; gameWinStreak?: number; gameWinBest?: number };
      const streak = (c.gameWinStreak || 0) + 1;
      winnerStreak = streak;
      batch.set(cRef, {
        gameWins: (c.gameWins || 0) + 1,
        gameWinStreak: streak,
        gameWinBest: Math.max(c.gameWinBest || 0, streak),
      }, { merge: true });
    } else {
      batch.set(cRef, { gameWinStreak: 0 }, { merge: true });
    }
  }
  batch.update(sRef, { winRecorded: true, ...(winnerUid ? { winnerUid } : {}) });
  try { await batch.commit(); }
  catch (e) { return NextResponse.json({ error: 'record-failed', detail: String(e) }, { status: 500 }); }

  return NextResponse.json({ ok: true, winnerUid: winnerUid || null, winnerStreak });
}
