// Kaya Pulse · helper-assist on a Kid + Helper reading (server, Admin SDK).
//
// Three actions:
//   • submit  (helper) — the backup helper proposes a value for the kid's
//     reading. NO reading is written yet; the task goes to 'review' (pending
//     parent approval) and the family's parents are notified.
//   • approve (parent) — writes the proposed reading via the shared log path,
//     attributed to the helper, with NO kid points (the kid didn't do it).
//   • reject  (parent) — clears the proposal; the task goes back to 'pending'
//     so the kid (or helper) can try again.
//
// Open like the other /api/pulse/* routes (Phase 1); the UI only offers
// approve/reject to parents. `submit` verifies the actor IS the task's backup
// helper so a stranger can't propose.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { applyReadingLog } from '@/lib/pulseLogApply.server';
import { notifyPulseOwner, notifyFamilyParents } from '@/lib/pulseGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: { familyId?: string; taskId?: string; action?: string; value?: number; actorUid?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const { familyId, taskId, action } = body;
  const actorUid = typeof body.actorUid === 'string' ? body.actorUid : '';
  if (!familyId || !taskId || !action) return NextResponse.json({ error: 'missing-fields' }, { status: 400 });

  const famRef = db.collection('families').doc(familyId);
  const taskRef = famRef.collection('pulseTasks').doc(taskId);
  const snap = await taskRef.get();
  if (!snap.exists) return NextResponse.json({ error: 'task-not-found' }, { status: 404 });
  const task = snap.data() as {
    ownerId?: string; ownerKind?: string; assistHelperUid?: string; status?: string;
    assistProposedValue?: number; assistLoggedBy?: string;
  };
  const logLink = `/pulse/log/${taskId}`;

  // ── Helper proposes a value (→ pending parent approval) ──
  if (action === 'submit') {
    const value = Number(body.value);
    if (!Number.isFinite(value)) return NextResponse.json({ error: 'bad-value' }, { status: 400 });
    if (!task.assistHelperUid || task.assistHelperUid !== actorUid) {
      return NextResponse.json({ error: 'not-the-backup-helper' }, { status: 403 });
    }
    if (task.status === 'logged' || task.status === 'closed') {
      return NextResponse.json({ ok: true, alreadyLogged: true });
    }
    await taskRef.update({
      status: 'review',
      assistProposedValue: value,
      assistLoggedBy: actorUid,
      assistSubmittedAt: new Date(),
    });
    await notifyFamilyParents(famRef, {
      type: 'pulse-assist-review',
      title: '📝 Reading to approve',
      message: 'A helper logged a reading on a kid’s behalf — tap to review + approve.',
      link: '/pulse',
    });
    return NextResponse.json({ ok: true, submitted: true });
  }

  // ── Parent approves the helper's proposal (→ write reading, no kid points) ──
  if (action === 'approve') {
    if (task.status !== 'review' || typeof task.assistProposedValue !== 'number' || !task.assistLoggedBy) {
      return NextResponse.json({ error: 'nothing-to-approve' }, { status: 400 });
    }
    const res = await applyReadingLog(db, {
      familyId, taskId, value: task.assistProposedValue,
      capturedBy: task.assistLoggedBy, capturedByKind: 'helper', loggedBy: task.assistLoggedBy,
      awardKid: false, note: 'Helper logged · parent-approved', forceClose: true,
    });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.errorStatus ?? 500 });
    // Tell the helper it was approved.
    await notifyPulseOwner(famRef, { kind: 'helper', id: task.assistLoggedBy }, {
      type: 'pulse-assist-approved',
      title: '✅ Reading approved',
      message: 'A parent approved the reading you logged. Thank you for helping!',
      link: '/pulse/today',
    });
    return NextResponse.json({ ok: true, approved: true });
  }

  // ── Parent rejects (→ back to pending for a redo) ──
  if (action === 'reject') {
    const helperUid = task.assistLoggedBy;
    await taskRef.update({
      status: 'pending',
      assistProposedValue: null,
      assistLoggedBy: null,
      assistSubmittedAt: null,
    });
    if (helperUid) {
      await notifyPulseOwner(famRef, { kind: 'helper', id: helperUid }, {
        type: 'pulse-assist-rejected',
        title: '🔁 Reading needs a redo',
        message: 'A parent asked for that reading to be checked again.',
        link: logLink,
      });
    }
    // Nudge the primary kid that it's back to them.
    if (task.ownerKind === 'kid' && task.ownerId) {
      await notifyPulseOwner(famRef, { kind: 'kid', id: task.ownerId }, {
        type: 'pulse-reading-due',
        title: '📈 Reading to log',
        message: 'Your meter reading is waiting — please log it.',
        link: logLink,
      });
    }
    return NextResponse.json({ ok: true, rejected: true });
  }

  return NextResponse.json({ error: 'bad-action' }, { status: 400 });
}
