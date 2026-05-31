// Kaya Games — record a multi-device win (Admin SDK).
//
// When a multi-device game finishes, the host POSTs the sessionId here. The
// route reads the session (forge-proof — it derives the winner itself from
// the session's own winnerUid [board games set it] or top score [Trivia],
// never from the caller), then bumps the winner's wins + streak in gameStats
// and resets the other players' streaks. gameStats is keyed by auth uid, so
// PARENTS and kids both accrue wins (the Games board's Wins tab reads it).
// Idempotent via session.winRecorded. gameStats is write:false for clients,
// so this runs under the Admin SDK.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { getGame } from '@/lib/gamesCatalog';
import { localWeekStartKey } from '@/lib/games';
import { gameFunValue, nextFun, FUN_WIN_MULT } from '@/lib/gamesFun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { sessionId?: string; tzOffsetMinutes?: number }
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
    winnerUid?: string; winRecorded?: boolean; gameId?: string;
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

  // Each player's role + display name. gameStats is keyed by auth uid, so it
  // covers PARENTS and kids alike — everyone invited to play shows on the board.
  const info: Record<string, { role: string; name: string }> = {};
  await Promise.all(players.map(async (p) => {
    const u = (await db.collection('users').doc(p.uid).get()).data() as
      { role?: string; displayName?: string; name?: string } | undefined;
    info[p.uid] = { role: u?.role || 'parent', name: u?.displayName || u?.name || p.name };
  }));

  // Fun-Points: every player earns the game's base; the winner earns FUN_WIN_MULT×.
  const game = getGame(s.gameId || '');
  const funBase = gameFunValue(game?.points);
  const weekKey = localWeekStartKey(Date.now(), Number(body.tzOffsetMinutes) || 0);
  const hasWinner = !!winnerUid;

  let winnerStreak = 0;
  const batch = db.batch();
  const statsCol = db.collection('families').doc(familyId).collection('gameStats');
  for (const p of players) {
    const ref = statsCol.doc(p.uid);
    const cur = ((await ref.get()).data() || {}) as
      { wins?: number; streak?: number; best?: number; funPoints?: number; funWeekly?: number; funWeekKey?: string };
    const i = info[p.uid] || { role: 'parent', name: p.name };
    const isWinner = hasWinner && p.uid === winnerUid;
    const fun = nextFun(cur, funBase * (isWinner ? FUN_WIN_MULT : 1), weekKey);
    const base = {
      uid: p.uid, name: i.name, role: i.role, updatedAt: Date.now(),
      funPoints: fun.funPoints, funWeekly: fun.funWeekly, funWeekKey: fun.funWeekKey,
    };
    if (isWinner) {
      const streak = (cur.streak || 0) + 1;
      winnerStreak = streak;
      batch.set(ref, { ...base, wins: (cur.wins || 0) + 1, streak, best: Math.max(cur.best || 0, streak) }, { merge: true });
    } else if (hasWinner) {
      batch.set(ref, { ...base, streak: 0 }, { merge: true }); // a real loser → streak resets
    } else {
      batch.set(ref, base, { merge: true }); // collaborative / tie → no winner: keep streaks, still bank Fun-Points
    }
  }
  batch.update(sRef, { winRecorded: true, ...(winnerUid ? { winnerUid } : {}) });
  try { await batch.commit(); }
  catch (e) { return NextResponse.json({ error: 'record-failed', detail: String(e) }, { status: 500 }); }

  return NextResponse.json({ ok: true, winnerUid: winnerUid || null, winnerStreak });
}
