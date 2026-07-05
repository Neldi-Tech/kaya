// Kaya Pulse · missed-task scanner (server cron).
//
// Runs hourly. Marks any still-'pending' task whose due time passed more than a
// 30-min grace ago as 'missed'. For a kid owner, missing an owned task breaks
// their Pulse streak (reset to 0) — per the engine spec. Each task is processed
// once (the query only matches 'pending'). No-ops cleanly without admin creds.
//
// (Helper performance dinging is the next engine piece. The threshold
// auto-top-up landed — HHR PR1: runAutoTopupSweep below backstops the
// per-reading trigger in lib/pulseLogApply.server.)

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { notifyPulseOwner, notifyFamilyParents } from '@/lib/pulseGenerate';
import { runAutoTopupSweep } from '@/lib/autoTopup.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GRACE_MS = 30 * 60 * 1000;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const now = Date.now();
  let families;
  try {
    families = await db.collection('families').get();
  } catch (e) {
    return NextResponse.json({ error: 'families-read-failed', detail: String(e) }, { status: 500 });
  }

  let missed = 0;
  let lowFired = 0;
  let lowRequests = 0;
  for (const fam of families.docs) {
    let taskSnap;
    try {
      taskSnap = await fam.ref.collection('pulseTasks').where('status', '==', 'pending').get();
    } catch {
      continue;
    }
    let missedThisFam = 0;
    for (const taskDoc of taskSnap.docs) {
      const t = taskDoc.data() as { dueAt?: FirebaseFirestore.Timestamp; ownerKind?: string; ownerId?: string };
      const dueAt = t.dueAt?.toMillis?.();
      if (!dueAt || dueAt + GRACE_MS >= now) continue; // not overdue past grace yet

      try {
        await taskDoc.ref.update({ status: 'missed', missedAt: new Date() });
        missed++;
        missedThisFam++;
        // Kid: missing an owned task breaks the streak.
        if (t.ownerKind === 'kid' && t.ownerId) {
          await fam.ref.collection('pulseProfiles').doc(t.ownerId).set({ currentStreak: 0 }, { merge: true });
        }
        // Nudge the reader that they missed it.
        if (t.ownerId) {
          await notifyPulseOwner(fam.ref, { kind: t.ownerKind, id: t.ownerId }, {
            type: 'pulse-missed',
            title: '⚠ Missed reading',
            message: 'A reading task was missed today.',
            link: '/pulse/today',
          });
        }
        // Helper: performance ding lands with helper owners (next engine piece).
      } catch {
        /* best-effort per task */
      }
    }

    // One summary alert to the family's parents so they can step in + log the
    // unfilled reading on the reader's behalf (parent oversight).
    if (missedThisFam > 0) {
      await notifyFamilyParents(fam.ref, {
        type: 'pulse-missed-parent',
        title: '⚠ Reading missed',
        message: `${missedThisFam} reading${missedThisFam === 1 ? '' : 's'} ${missedThisFam === 1 ? 'was' : 'were'} missed today — tap to review or log.`,
        link: '/pulse',
      });
    }
  
    // 🔔 Low-balance sweep (HHR PR1) — the backstop when nobody logs: every
    // protected prepaid meter is re-checked from its latest reading, so the
    // days-left forecast keeps counting down between readings.
    try {
      const r = await runAutoTopupSweep(db, fam.ref);
      lowFired += r.fired;
      lowRequests += r.requests;
    } catch { /* best-effort per family */ }
  }

  return NextResponse.json({ ok: true, missed, lowFired, lowRequests });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
