// Kaya Games — server-side game completion (Admin SDK).
//
// Kids can't write to children/awards/gamePlays directly (parent-only in the
// rules), and we never trust the client for the points value or the target
// kid. This route verifies the caller's Firebase ID token, derives the kid
// from their own profile, and records the finished game.
//
// HP carries real cash value, so games mint NOTHING automatically:
//   • A game the parent hasn't opted in (value 0) is recorded as 'logged' —
//     history only, no HP, no approval needed.
//   • A game the parent valued (> 0) is recorded as 'pending' — it waits for
//     a parent to approve it before any HP is credited. The daily/weekly caps
//     are applied at APPROVAL time (see lib/gamesApprovals), not here.
// To stop a kid flooding the parent's queue, there is at most ONE pending
// entry per (kid, game): replaying a still-pending game just refreshes it.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { getGame } from '@/lib/gamesCatalog';
import {
  resolveGamesConfig, ageFromBirthday, pointsMultiplier,
  localDateKey, localWeekStartKey, gamePointsValue,
} from '@/lib/games';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AwardBody {
  gameId?: string;
  score?: number | null;
  durationSec?: number;
  tzOffsetMinutes?: number;
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

  let body: AwardBody;
  try { body = (await req.json()) as AwardBody; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const game = getGame((body.gameId || '').trim());
  if (!game) return NextResponse.json({ error: 'unknown-game' }, { status: 400 });
  if (!game.built) return NextResponse.json({ error: 'game-not-live' }, { status: 400 });

  // Identity — a completion ALWAYS belongs to the authed kid; never trust a
  // client childId.
  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user?.role !== 'kid' || !user.childId) {
    // Parents/helpers can play (e.g. previewing) but nothing is recorded.
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-a-kid', pointsAwarded: 0 });
  }
  const kidId = user.childId;

  const famSnap = await db.collection('families').doc(familyId).get();
  if (!famSnap.exists) return NextResponse.json({ error: 'no-family-doc' }, { status: 404 });
  const cfg = resolveGamesConfig(famSnap.data()?.gamesConfig);

  const childRef = db.collection('families').doc(familyId).collection('children').doc(kidId);
  const childSnap = await childRef.get();
  if (!childSnap.exists) return NextResponse.json({ error: 'no-child' }, { status: 404 });
  const child = childSnap.data() as
    { name?: string; displayName?: string; birthday?: string };
  const kidName = child.displayName || child.name || 'Your child';

  // The parent-assigned value (default 0) drives everything. The young-player
  // multiplier still applies, so the PROPOSED amount a parent sees already
  // reflects it.
  const age = ageFromBirthday(child.birthday);
  const mult = pointsMultiplier(cfg, game.world, age);
  const basePoints = gamePointsValue(cfg, game.id);
  const proposed = Math.max(0, Math.round(basePoints * mult));

  const durationSec = Math.max(0, Math.min(60 * 60, Math.round(Number(body.durationSec) || 0)));
  const tz = Number(body.tzOffsetMinutes) || 0;
  const dateKey = localDateKey(Date.now(), tz);
  const weekKey = localWeekStartKey(Date.now(), tz);
  const score = body.score == null ? null : Number(body.score);
  const playsCol = db.collection('families').doc(familyId).collection('gamePlays');

  // ── Value 0 → just log it. No HP, no approval. ───────────────────────────
  if (proposed <= 0) {
    await playsCol.add({
      kidId, kidName, gameId: game.id, gameName: game.name, world: game.world,
      score, durationSec, status: 'logged',
      pointsAwarded: 0, pointsPending: 0, basePoints, multiplier: mult,
      dateKey, weekKey, capped: false, createdAt: Date.now(),
    });
    return NextResponse.json({
      ok: true, status: 'logged', pointsAwarded: 0, pointsPending: 0,
      basePoints, multiplier: mult, dateKey,
    });
  }

  // ── Value > 0 → pending parent approval. NO HP credited here. ────────────
  // Collapse repeats: if a pending entry already exists for this (kid, game),
  // refresh it instead of stacking a new card in the parent's queue.
  const pendingSnap = await playsCol
    .where('kidId', '==', kidId).where('status', '==', 'pending').get();
  const existing = pendingSnap.docs.find((d) => (d.data() as { gameId?: string }).gameId === game.id);

  if (existing) {
    await existing.ref.update({
      score, durationSec, pointsPending: proposed, basePoints, multiplier: mult, dateKey, weekKey,
    });
    return NextResponse.json({
      ok: true, status: 'pending', pointsAwarded: 0, pointsPending: proposed,
      basePoints, multiplier: mult, dateKey,
    });
  }

  await playsCol.add({
    kidId, kidName, gameId: game.id, gameName: game.name, world: game.world,
    score, durationSec, status: 'pending',
    pointsAwarded: 0, pointsPending: proposed, basePoints, multiplier: mult,
    dateKey, weekKey, capped: false, createdAt: Date.now(),
  });
  return NextResponse.json({
    ok: true, status: 'pending', pointsAwarded: 0, pointsPending: proposed,
    basePoints, multiplier: mult, dateKey,
  });
}
