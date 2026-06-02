// Kaya Pulse · log a reading (server, Admin SDK).
//
// POST { familyId, taskId, value, actorUid?, actorRole? } → writes the reading,
// closes the task, awards the kid (if they logged their own). A parent logging
// on a reader's behalf (actorRole 'parent') is recorded + attributed to the
// parent with NO kid points. The actual write logic lives in
// lib/pulseLogApply.server (shared with the helper-assist approval path).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { applyReadingLog } from '@/lib/pulseLogApply.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: { familyId?: string; taskId?: string; value?: number; actorUid?: string; actorRole?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = body.familyId;
  const taskId = body.taskId;
  const value = Number(body.value);
  if (!familyId || !taskId || !Number.isFinite(value)) return NextResponse.json({ error: 'missing-fields' }, { status: 400 });

  // A parent can log on the reader's behalf (parent oversight): the reading is
  // recorded + attributed to the parent, but the kid earns no points/streak.
  const actorUid = typeof body.actorUid === 'string' ? body.actorUid : '';
  const onBehalf = body.actorRole === 'parent' && !!actorUid;

  const res = await applyReadingLog(db, {
    familyId, taskId, value,
    ...(onBehalf
      ? { capturedBy: actorUid, capturedByKind: 'parent' as const, loggedBy: actorUid, awardKid: false, note: 'Logged by parent' }
      : {}),
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.errorStatus ?? 500 });
  return NextResponse.json({
    ok: true,
    alreadyLogged: res.alreadyLogged,
    consumedUnits: res.consumedUnits,
    deltaCost: res.deltaCost,
    event: res.event,
    points: res.points,
    isAnomaly: res.isAnomaly,
    streak: res.streak,
    onBehalf,
  });
}

export async function POST(req: NextRequest) {
  return run(req);
}
