// Kids' Workplan · complete/uncomplete a task (server, Admin SDK).
//
// POST { familyId, childId, itemId, date, on } → toggles the item's
// presence in that day's completion doc and, when an item carries
// pointsValue, awards the points the FIRST time it's completed (tracked
// in awardedItemIds for idempotency — re-ticking never double-awards;
// un-ticking never claws back). Runs server-side because a kid cannot
// write awards / child totals under the security rules (same constraint
// Kaya Pulse solved with /api/pulse/log).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: { familyId?: string; childId?: string; itemId?: string; date?: string; on?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const { familyId, childId, itemId, date } = body;
  const on = !!body.on;
  if (!familyId || !childId || !itemId || !date) {
    return NextResponse.json({ error: 'missing-fields' }, { status: 400 });
  }

  const famRef = db.collection('families').doc(familyId);
  const childRef = famRef.collection('children').doc(childId);
  const itemRef = childRef.collection('workplanItems').doc(itemId);
  const compRef = childRef.collection('workplanCompletions').doc(date);
  const now = new Date();

  const [itemSnap, compSnap] = await Promise.all([itemRef.get(), compRef.get()]);
  if (!itemSnap.exists) return NextResponse.json({ error: 'item-not-found' }, { status: 404 });
  const item = itemSnap.data() as { label?: string; pointsValue?: number };

  const comp = compSnap.exists
    ? (compSnap.data() as { completedItemIds?: string[]; awardedItemIds?: string[] })
    : {};
  const completed = new Set(comp.completedItemIds ?? []);
  const awarded = new Set(comp.awardedItemIds ?? []);

  if (on) completed.add(itemId); else completed.delete(itemId);

  // Award points the first time this item is completed for the day.
  let pointsAwarded = 0;
  const points = Number(item.pointsValue ?? 0);
  if (on && points > 0 && !awarded.has(itemId)) {
    try {
      await famRef.collection('awards').add({
        childId,
        kind: 'regular',
        points,
        reason: `Workplan — ${item.label ?? 'task'} done`,
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
      /* best-effort: the tick still lands even if the award write fails */
    }
  }

  await compRef.set(
    {
      completedItemIds: Array.from(completed),
      awardedItemIds: Array.from(awarded),
      updatedAt: now,
      updatedBy: childId,
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, completed: on, pointsAwarded });
}

export async function POST(req: NextRequest) {
  return run(req);
}
