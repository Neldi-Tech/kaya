// Kaya Games — answer the Question of the Day (Admin SDK).
//
// Everyone (parents + kids) answers the day's shared question from My Day.
// Answering keeps a personal STREAK alive and pays Fun-Points. gameStats is
// client-write-false, so the streak + Fun-Points are credited HERE, server-
// side, and can't be forged. Idempotent per local day.
//
// 2026-07-19 fix pack (Elia-approved design):
//   • The whole read-modify-write now runs in a TRANSACTION — two rapid
//     taps / two devices can no longer double-award Fun-Points or
//     double-bump the streak.
//   • 🛡️ Streak Shield (surprise #1): one missed day per week is auto-
//     forgiven — miss a single day and answer the next, and the streak
//     carries on (the shield "absorbs" the gap; one per calendar week).
//   • One-time streak REPAIR: the old lazy-rotation bug silently dropped
//     days and reset everyone to 1. The first post-fix answer within 7
//     days of a player's last recorded day RESUMES their streak instead
//     of resetting it (marked `qotdRepaired` so it can't be farmed).
//   • `qotdDays` — the player's answered-day history (last 60) now
//     recorded, powering the card's 7-day dot strip.
//   • `answeredUids` appended on the day's question doc — powers the
//     "3 of 5 answered today" family line.
//   • tzOffsetMinutes is validated (clamped ±14h); a missing offset now
//     falls back to East Africa Time, never silently UTC.
//
// Fun-Points only — House Points stay reserved for mind-strengthening games.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
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

/** Whole days between two YYYY-MM-DD labels (b after a → positive). */
function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a + 'T00:00:00Z');
  const tb = Date.parse(b + 'T00:00:00Z');
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.NaN;
  return Math.round((tb - ta) / 86400000);
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

  // Validated local-day offset — EAT fallback, never silent UTC.
  const tzRaw = Number(body.tzOffsetMinutes);
  const tz = Number.isFinite(tzRaw) ? Math.max(-840, Math.min(840, tzRaw)) : 180;
  const today = localDateKey(Date.now(), tz);

  // Today's shared question — the answer is read server-side, never trusted
  // from the client.
  const qRef = db.collection('families').doc(familyId).collection('gameMeta').doc('qotd');
  const q = (await qRef.get()).data() as { date?: string; answer?: number; fact?: string } | undefined;
  if (!q || q.date !== today || typeof q.answer !== 'number') {
    return NextResponse.json({ error: 'no-question-today' }, { status: 409 });
  }
  const correct = choice === q.answer;

  const cfg = resolveGamesConfig((await db.collection('families').doc(familyId).get()).data()?.gamesConfig);
  const target = Math.max(1, Math.round(cfg.qotdStreakTarget || 3));
  const weekKey = localWeekStartKey(Date.now(), tz);

  const statRef = db.collection('families').doc(familyId).collection('gameStats').doc(uid);

  let out: {
    already: boolean; streak: number; best: number; funAwarded: number;
    milestone: boolean; shieldUsed: boolean; repaired: boolean; days: string[];
  };
  try {
    out = await db.runTransaction(async (tx) => {
      const cur = ((await tx.get(statRef)).data() || {}) as {
        qotdLast?: string; qotdStreak?: number; qotdBest?: number;
        qotdShieldWeek?: string; qotdRepaired?: boolean; qotdDays?: string[];
        funPoints?: number; funWeekly?: number; funWeekKey?: string;
      };
      const days = Array.isArray(cur.qotdDays) ? cur.qotdDays.filter((d) => typeof d === 'string') : [];

      // Idempotent: already answered today → award nothing.
      if (cur.qotdLast === today) {
        return {
          already: true, streak: cur.qotdStreak || 0, best: cur.qotdBest || 0,
          funAwarded: 0, milestone: false, shieldUsed: false, repaired: false, days,
        };
      }

      const last = cur.qotdLast || '';
      const gap = last ? daysBetween(last, today) : Number.NaN;
      let streak: number;
      let shieldUsed = false;
      let repaired = false;
      if (gap === 1) {
        streak = (cur.qotdStreak || 0) + 1;                 // consecutive day
      } else if (gap === 2 && cur.qotdShieldWeek !== weekKey) {
        streak = (cur.qotdStreak || 0) + 1;                 // 🛡️ shield absorbs ONE missed day/week
        shieldUsed = true;
      } else if (last && !cur.qotdRepaired && (cur.qotdStreak || 0) >= 1 && gap >= 2 && gap <= 7) {
        streak = (cur.qotdStreak || 0) + 1;                 // one-time repair for the rotation-bug era
        repaired = true;
      } else {
        streak = 1;
      }

      const best = Math.max(cur.qotdBest || 0, streak);
      const milestone = streak % target === 0;
      const funAwarded =
        QOTD_DAILY_FUN + (correct ? QOTD_CORRECT_FUN : 0) + (milestone ? QOTD_MILESTONE_FUN * target : 0);
      const fun = nextFun(cur, funAwarded, weekKey);
      const nextDays = [...days.filter((d) => d !== today), today].slice(-60);

      tx.set(statRef, {
        uid, name, role, updatedAt: Date.now(),
        qotdLast: today, qotdStreak: streak, qotdBest: best, qotdDays: nextDays,
        ...(shieldUsed ? { qotdShieldWeek: weekKey } : {}),
        ...(repaired ? { qotdRepaired: true } : {}),
        funPoints: fun.funPoints, funWeekly: fun.funWeekly, funWeekKey: fun.funWeekKey,
      }, { merge: true });

      return { already: false, streak, best, funAwarded, milestone, shieldUsed, repaired, days: nextDays };
    });
  } catch (e) {
    return NextResponse.json({ error: 'record-failed', detail: String(e) }, { status: 500 });
  }

  // Family progress line — best-effort, outside the transaction.
  if (!out.already) {
    try { await qRef.set({ answeredUids: FieldValue.arrayUnion(uid) }, { merge: true }); } catch { /* non-blocking */ }
  }

  return NextResponse.json({
    ok: true, alreadyAnswered: out.already || undefined, correct, answer: q.answer, fact: q.fact || '',
    streak: out.streak, best: out.best, funAwarded: out.funAwarded, milestone: out.milestone, target,
    shieldUsed: out.shieldUsed || undefined, repaired: out.repaired || undefined, days: out.days,
  });
}
