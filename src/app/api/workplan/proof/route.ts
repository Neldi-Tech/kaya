// Kids' Workplan · submit "proof for points" (server, Admin SDK).
//
// POST { familyId, childId, itemId, date, note, mediaUrl, mediaType }
//
// A kid attached a NOTE + one media (photo/video) to a proof-required
// task. This route writes the proof doc (id `${date}_${itemId}`), marks
// the task complete for the day, and — in 'instant' family mode —
// awards the points right away. In the default 'approve' mode the proof
// lands `pending` and a parent grants points later via /proof/review.
//
// Runs server-side because a kid can't write awards / child totals or
// the proof doc under the rules (same constraint complete/route.ts and
// Kaya Pulse solve). The award write mirrors complete/route.ts exactly.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: {
    familyId?: string; childId?: string; itemId?: string; date?: string;
    note?: string; mediaUrl?: string; mediaType?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const { familyId, childId, itemId, date, mediaUrl } = body;
  const note = (body.note ?? '').trim();
  const mediaType = body.mediaType === 'video' ? 'video' : body.mediaType === 'photo' ? 'photo' : null;
  if (!familyId || !childId || !itemId || !date) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }
  if (!note || !mediaUrl || !mediaType) {
    return NextResponse.json({ error: 'proof-incomplete' }, { status: 400 });
  }

  const famRef = db.collection('families').doc(familyId);
  const childRef = famRef.collection('children').doc(childId);
  const itemRef = childRef.collection('workplanItems').doc(itemId);
  const compRef = childRef.collection('workplanCompletions').doc(date);
  const proofRef = childRef.collection('workplanProofs').doc(`${date}_${itemId}`);
  const now = new Date();

  const [itemSnap, compSnap, famSnap] = await Promise.all([itemRef.get(), compRef.get(), famRef.get()]);
  if (!itemSnap.exists) return NextResponse.json({ error: 'item-not-found' }, { status: 404 });
  const item = itemSnap.data() as { label?: string; pointsValue?: number };
  const fam = famSnap.exists ? (famSnap.data() as { workplanProofMode?: string }) : {};

  // Mode default = 'approve' (points wait for a parent). 'instant' grants now.
  const mode = fam.workplanProofMode === 'instant' ? 'instant' : 'approve';
  const points = Number(item.pointsValue ?? 0);
  const status: 'pending' | 'approved' = mode === 'instant' ? 'approved' : 'pending';

  const comp = compSnap.exists
    ? (compSnap.data() as { completedItemIds?: string[]; awardedItemIds?: string[] })
    : {};
  const completed = new Set(comp.completedItemIds ?? []);
  const awarded = new Set(comp.awardedItemIds ?? []);
  completed.add(itemId); // submitting proof marks the task done for the day

  // Instant mode: award immediately (idempotent via awardedItemIds), same
  // award-doc + child-totals pattern as complete/route.ts.
  let pointsAwarded = 0;
  if (mode === 'instant' && points > 0 && !awarded.has(itemId)) {
    try {
      await famRef.collection('awards').add({
        childId,
        kind: 'regular',
        points,
        reason: `Workplan proof — ${item.label ?? 'task'}`,
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
      pointsAwarded = points;
    } catch {
      /* best-effort: the proof + completion still land even if the award write fails */
    }
  }

  // Write the proof doc. Strip undefined before writing (existing convention).
  const proofDoc: Record<string, unknown> = {
    itemId,
    date,
    note,
    mediaUrl,
    mediaType,
    status,
    pointsValue: points,
    submittedAt: now,
  };
  await proofRef.set(proofDoc);

  await compRef.set(
    {
      completedItemIds: Array.from(completed),
      awardedItemIds: Array.from(awarded),
      updatedAt: now,
      updatedBy: childId,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, status, pointsAwarded });
}

export async function POST(req: NextRequest) {
  return run(req);
}
