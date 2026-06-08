// Kaya Games — answer the Question of the Day (Admin SDK).
//
// Everyone (parents + kids) answers the day's shared question from My Day.
// Answering keeps a personal STREAK alive and pays Fun-Points. gameStats is
// client-write-false, so the streak + Fun-Points are credited HERE, server-
// side, and can't be forged. Idempotent per local day: re-answering the same
// day awards nothing (it just returns the current state).
//
// Fun-Points only — House Points stay reserved for mind-strengthening games.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { resolveGamesConfig, localDateKey, localWeekStartKey } from '@/lib/games';
import { nextFun, QOTD_DAILY_FUN, QOTD_CORRECT_FUN, QOTD_MILESTONE_FUN } from '@/lib/gamesFun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Body { choice?: number; tzOffsetMinutes?: number }

/** The calendar day before a YYYY-MM-DD label (used for streak continuity). */
function prevDayKey(dayKey: string): string {
  const d = new Date(dayKey + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
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

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const choice = Number(body.choice);
  if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
    return NextResponse.json({ error: 'bad-choice' }, { status: 400 });
  }

  // Identity — name + role for the board; gameStats is keyed by auth uid, so
  // PARENTS and kids both accrue a streak.
  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; displayName?: string; name?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const name = user?.displayName || user?.name || 'Player';
  const role = user?.role || 'parent';

  const tz = Number(body.tzOffsetMinutes) || 0;
  const today = localDateKey(Date.now(), tz);

  // Today's shared question — the answer is read server-side, never trusted from
  // the client.
  const qSnap = await db.collection('families').doc(familyId).collection('gameMeta').doc('qotd').get();
  const q = qSnap.data() as { date?: string; answer?: number; fact?: string } | undefined;
  if (!q || q.date !== today || typeof q.answer !== 'number') {
    return NextResponse.json({ error: 'no-question-today' }, { status: 409 });
  }
  const correct = choice === q.answer;

  const cfg = resolveGamesConfig((await db.collection('families').doc(familyId).get()).data()?.gamesConfig);
  const target = Math.max(1, Math.round(cfg.qotdStreakTarget || 3));

  const statRef = db.collection('families').doc(familyId).collection('gameStats').doc(uid);
  const cur = ((await statRef.get()).data() || {}) as {
    qotdLast?: string; qotdStreak?: number; qotdBest?: number;
    funPoints?: number; funWeekly?: number; funWeekKey?: string;
  };

  // Idempotent: already answered today → return current state, award nothing.
  if (cur.qotdLast === today) {
    return NextResponse.json({
      ok: true, alreadyAnswered: true, correct, answer: q.answer, fact: q.fact || '',
      streak: cur.qotdStreak || 0, best: cur.qotdBest || 0, funAwarded: 0, milestone: false, target,
    });
  }

  const streak = cur.qotdLast === prevDayKey(today) ? (cur.qotdStreak || 0) + 1 : 1;
  const best = Math.max(cur.qotdBest || 0, streak);
  const milestone = streak % target === 0;
  const funAwarded =
    QOTD_DAILY_FUN + (correct ? QOTD_CORRECT_FUN : 0) + (milestone ? QOTD_MILESTONE_FUN * target : 0);

  const weekKey = localWeekStartKey(Date.now(), tz);
  const fun = nextFun(cur, funAwarded, weekKey);

  try {
    await statRef.set({
      uid, name, role, updatedAt: Date.now(),
      qotdLast: today, qotdStreak: streak, qotdBest: best,
      funPoints: fun.funPoints, funWeekly: fun.funWeekly, funWeekKey: fun.funWeekKey,
    }, { merge: true });
  } catch (e) {
    return NextResponse.json({ error: 'record-failed', detail: String(e) }, { status: 500 });
  }

  return NextResponse.json({
    ok: true, correct, answer: q.answer, fact: q.fact || '',
    streak, best, funAwarded, milestone, target,
  });
}
