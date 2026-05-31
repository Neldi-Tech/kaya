// Kaya Games — server-side House Points award (Admin SDK).
//
// Kids can't write to children/awards directly (parent-only in the rules),
// and we never trust the client for the points value or the target kid. This
// route verifies the caller's Firebase ID token, derives the kid from their
// own profile, looks the points up from the catalog, enforces the family's
// daily points cap + age multiplier SERVER-SIDE, then writes the gamePlay +
// the House Points award atomically. No-ops cleanly without admin creds.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { getGame } from '@/lib/gamesCatalog';
import { resolveGamesConfig, ageFromBirthday, pointsMultiplier, localDateKey } from '@/lib/games';

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

  // Identity — points ALWAYS go to the authed kid; never trust a client childId.
  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user?.role !== 'kid' || !user.childId) {
    // Parents/helpers can play (e.g. previewing) but no House Points are minted.
    return NextResponse.json({ ok: true, skipped: true, reason: 'not-a-kid', pointsAwarded: 0 });
  }
  const kidId = user.childId;

  const famSnap = await db.collection('families').doc(familyId).get();
  if (!famSnap.exists) return NextResponse.json({ error: 'no-family-doc' }, { status: 404 });
  const cfg = resolveGamesConfig(famSnap.data()?.gamesConfig);

  const childRef = db.collection('families').doc(familyId).collection('children').doc(kidId);
  const childSnap = await childRef.get();
  if (!childSnap.exists) return NextResponse.json({ error: 'no-child' }, { status: 404 });
  const child = childSnap.data() as { totalPoints?: number; weeklyPoints?: number; birthday?: string };

  const age = ageFromBirthday(child.birthday);
  const mult = pointsMultiplier(cfg, game.world, age);
  const basePoints = game.points;
  let points = Math.max(0, Math.round(basePoints * mult));

  const durationSec = Math.max(0, Math.min(60 * 60, Math.round(Number(body.durationSec) || 0)));
  const dateKey = localDateKey(Date.now(), Number(body.tzOffsetMinutes) || 0);

  // One query for today's plays drives both the cap math and the calm guard.
  const todaySnap = await db.collection('families').doc(familyId).collection('gamePlays')
    .where('kidId', '==', kidId).where('dateKey', '==', dateKey).get();

  const calmExempt = game.world === 'calm' && cfg.calmUncapped;
  let capped = false;
  if (calmExempt) {
    // Uncapped on the daily total, but each calm game pays out once per day,
    // so it can't be farmed for endless points.
    const alreadyPaidThisGame = todaySnap.docs.some((d) => {
      const p = d.data() as { gameId?: string; pointsAwarded?: number };
      return p.gameId === game.id && (Number(p.pointsAwarded) || 0) > 0;
    });
    if (alreadyPaidThisGame) { points = 0; capped = true; }
  } else if (cfg.dailyPointsCap > 0) {
    let earnedToday = 0;
    todaySnap.forEach((d) => {
      const p = d.data() as { world?: string; pointsAwarded?: number };
      // Calm-uncapped plays never consume the shared daily cap.
      if (!(p.world === 'calm' && cfg.calmUncapped)) earnedToday += Number(p.pointsAwarded) || 0;
    });
    const remaining = Math.max(0, cfg.dailyPointsCap - earnedToday);
    if (points > remaining) { points = remaining; capped = true; }
  }

  // Write the play (+ the award + balance bump when any points land) atomically.
  const playRef = db.collection('families').doc(familyId).collection('gamePlays').doc();
  const batch = db.batch();
  batch.set(playRef, {
    kidId, gameId: game.id, world: game.world,
    score: body.score == null ? null : Number(body.score),
    durationSec, pointsAwarded: points, basePoints, multiplier: mult,
    dateKey, capped, createdAt: new Date(),
  });
  if (points > 0) {
    const awardRef = db.collection('families').doc(familyId).collection('awards').doc();
    batch.set(awardRef, {
      childId: kidId, kind: 'regular', points,
      reason: `Kaya Games — ${game.name}`, category: 'game',
      awardedBy: 'system', awardedByName: 'Kaya Games', senderRole: 'parent',
      createdAt: new Date(),
    });
    batch.update(childRef, {
      totalPoints: (child.totalPoints || 0) + points,
      weeklyPoints: (child.weeklyPoints || 0) + points,
    });
  }
  try { await batch.commit(); }
  catch (e) { return NextResponse.json({ error: 'award-failed', detail: String(e) }, { status: 500 }); }

  return NextResponse.json({
    ok: true,
    pointsAwarded: points,
    basePoints,
    multiplier: mult,
    capped,
    newTotal: (child.totalPoints || 0) + points,
    dateKey,
  });
}
