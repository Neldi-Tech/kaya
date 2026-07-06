// Kids' Workplan · parent reviews a "proof for points" submission
// (server, Admin SDK).
//
// POST { familyId, childId, itemId, date, decision:'approve'|'reject',
//        note, reviewerUid }
//
// approve → status:'approved' + review fields; if the task carries points
//   and they weren't already granted (e.g. it was 'approve' mode, still
//   pending), award them now — same award-doc + child-totals pattern as
//   complete/route.ts, idempotent via the completion's awardedItemIds.
//
// reject → status:'rejected' + review fields. If points WERE already
//   granted (instant mode), CLAW BACK: decrement child.totalPoints &
//   weeklyPoints, drop the item from awardedItemIds, and write a
//   COMPENSATING award doc with negative points (kind:'regular',
//   points:-pointsValue) so the ledger + totals stay consistent. We do
//   NOT delete the original historical award doc.
//
// Both decisions carry a parent note shown to the kid. Award writes are
// server-side only — parents can't write awards under the rules.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { sendKidRewardEmail } from '@/lib/kidEmails.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: {
    familyId?: string; childId?: string; itemId?: string; date?: string;
    decision?: string; note?: string; reviewerUid?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const { familyId, childId, itemId, date, reviewerUid } = body;
  const note = (body.note ?? '').trim();
  const decision = body.decision === 'approve' ? 'approve' : body.decision === 'reject' ? 'reject' : null;
  if (!familyId || !childId || !itemId || !date || !reviewerUid || !decision) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }

  const famRef = db.collection('families').doc(familyId);
  const childRef = famRef.collection('children').doc(childId);
  const itemRef = childRef.collection('workplanItems').doc(itemId);
  const compRef = childRef.collection('workplanCompletions').doc(date);
  const proofRef = childRef.collection('workplanProofs').doc(`${date}_${itemId}`);
  const now = new Date();

  const [proofSnap, compSnap, itemSnap] = await Promise.all([proofRef.get(), compRef.get(), itemRef.get()]);
  if (!proofSnap.exists) return NextResponse.json({ error: 'proof-not-found' }, { status: 404 });
  const proof = proofSnap.data() as { pointsValue?: number; status?: string };
  // pointsValue is snapshotted on the proof at submit; the item may be
  // gone/edited later, so trust the proof's value for award math.
  const points = Number(proof.pointsValue ?? 0);
  const itemLabel = (itemSnap.exists ? (itemSnap.data() as { label?: string }).label : undefined) ?? 'task';

  const comp = compSnap.exists
    ? (compSnap.data() as { completedItemIds?: string[]; awardedItemIds?: string[] })
    : {};
  const awarded = new Set(comp.awardedItemIds ?? []);

  if (decision === 'approve') {
    // Grant points if any and not already granted (idempotent). Same
    // award-doc + child-totals pattern as complete/route.ts.
    if (points > 0 && !awarded.has(itemId)) {
      try {
        await famRef.collection('awards').add({
          childId,
          kind: 'regular',
          points,
          reason: `Workplan proof — ${itemLabel}`,
          category: 'workplan',
          awardedBy: 'system',
          awardedByName: 'Kaya Workplan',
          senderRole: 'parent',
          createdAt: now,
        });
        const cSnap = await childRef.get();
        const c = cSnap.exists ? (cSnap.data() as { totalPoints?: number; weeklyPoints?: number }) : {};
        await childRef.update({
          totalPoints: (c.totalPoints ?? 0) + points,
          weeklyPoints: (c.weeklyPoints ?? 0) + points,
        });
        awarded.add(itemId);
        // 📬 KID PR2 — reward email (already server-side here; best-effort).
        await sendKidRewardEmail(db, familyId, childId, {
          emoji: '🏅',
          headline: `+${points} House Points!`,
          detail: `${itemLabel} — approved ✅`,
        });
      } catch {
        /* best-effort: the approval still lands even if the award write fails */
      }
    }
    await proofRef.set(
      { status: 'approved', reviewNote: note, reviewedBy: reviewerUid, reviewedAt: now },
      { merge: true },
    );
  } else {
    // reject — claw back if points were already granted (instant mode).
    if (points > 0 && awarded.has(itemId)) {
      try {
        // Compensating negative award keeps the ledger + totals consistent;
        // we never delete the original historical award doc.
        await famRef.collection('awards').add({
          childId,
          kind: 'regular',
          points: -points,
          reason: 'Workplan proof rejected',
          category: 'workplan',
          awardedBy: 'system',
          awardedByName: 'Kaya Workplan',
          senderRole: 'parent',
          createdAt: now,
        });
        const cSnap = await childRef.get();
        const c = cSnap.exists ? (cSnap.data() as { totalPoints?: number; weeklyPoints?: number }) : {};
        await childRef.update({
          totalPoints: (c.totalPoints ?? 0) - points,
          weeklyPoints: (c.weeklyPoints ?? 0) - points,
        });
        awarded.delete(itemId);
      } catch {
        /* best-effort: the rejection still lands even if the claw-back write fails */
      }
    }
    await proofRef.set(
      { status: 'rejected', reviewNote: note, reviewedBy: reviewerUid, reviewedAt: now },
      { merge: true },
    );
  }

  // Persist the (possibly changed) awardedItemIds set.
  await compRef.set(
    { awardedItemIds: Array.from(awarded), updatedAt: now, updatedBy: reviewerUid },
    { merge: true },
  );

  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  return run(req);
}
