// Household · Subscription cycle advancer (daily cron).
//
// Two passes per run:
//   1. PROMOTE OVERDUE — for each Manual/Auto cycle past its dueDate
//      without a payment, status 'upcoming'/'due' → 'overdue'.
//   2. SEND REMINDERS — for each Manual sub with cycles whose dueDate
//      sits in a reminderDaysBefore window from today (default [7,2,0]),
//      write an in-app notification to the account holder + log into
//      cycle.remindersSent[] for idempotency. Re-runs the same day are
//      no-ops because we check the log before writing.
//
// Auth: standard CRON_SECRET bearer.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** Number of whole days from `from` to `to`, treating both at local-day
 *  granularity. Positive = `to` is in the future. */
function daysBetween(from: Date, to: Date): number {
  const a = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime();
  const b = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime();
  return Math.round((b - a) / 86_400_000);
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-not-configured' });

  const now = Timestamp.now();
  const nowDate = now.toDate();
  let promotedOverdue = 0;
  let remindersSent = 0;
  let scanned = 0;

  try {
    // ── Pass 1: promote overdue ──────────────────────────────────────
    const overdueSnap = await db.collectionGroup('cycles')
      .where('status', 'in', ['upcoming', 'due'])
      .where('dueDate', '<', now)
      .get();

    scanned += overdueSnap.size;
    if (overdueSnap.size > 0) {
      const batch = db.batch();
      for (const doc of overdueSnap.docs) {
        batch.update(doc.ref, { status: 'overdue' });
        promotedOverdue += 1;
      }
      await batch.commit();
    }

    // ── Pass 2: send pre-due reminders ───────────────────────────────
    // Pull cycles that are still open AND within the maximum reminder
    // window (7 days out by default). Each cycle is checked against its
    // parent sub's reminderDaysBefore array.
    const maxWindowDate = new Date(nowDate);
    maxWindowDate.setDate(maxWindowDate.getDate() + 7);
    const maxWindow = Timestamp.fromDate(maxWindowDate);

    const upcomingSnap = await db.collectionGroup('cycles')
      .where('status', 'in', ['upcoming', 'due'])
      .where('dueDate', '<=', maxWindow)
      .get();

    scanned += upcomingSnap.size;

    for (const cycleDoc of upcomingSnap.docs) {
      const cycle = cycleDoc.data();
      const subRef = cycleDoc.ref.parent.parent;        // /subscriptions/{subId}
      if (!subRef) continue;

      const subSnap = await subRef.get();
      if (!subSnap.exists) continue;
      const sub = subSnap.data()!;

      // Manual subs only — Auto subs are tracked, not reminded.
      if (sub.billingMode !== 'manual') continue;
      if (!Array.isArray(sub.reminderDaysBefore) || sub.reminderDaysBefore.length === 0) continue;

      const due = cycle.dueDate as Timestamp;
      const dueDays = daysBetween(nowDate, due.toDate());

      // Does today match a reminder window?
      if (!sub.reminderDaysBefore.includes(dueDays)) continue;

      // Idempotency: skip if a reminder for this daysBefore was already sent
      const already = (cycle.remindersSent ?? []).some(
        (r: { daysBefore: number }) => r.daysBefore === dueDays,
      );
      if (already) continue;

      // Compose the notification. The shape matches Kaya's existing
      // in-app bell collection (other modules write here too — utility
      // bill-due, workplan reminders, etc.).
      const familyId = subRef.parent.parent?.id;
      if (!familyId) continue;
      const notifRef = db.collection('families').doc(familyId)
        .collection('notifications').doc();

      const window =
        dueDays === 0 ? 'today' :
        dueDays === 1 ? 'tomorrow' :
        `in ${dueDays} days`;

      const body = db.batch();
      body.set(notifRef, {
        type: 'subscription-reminder',
        forUserId: sub.accountHolderUid,
        title: `${sub.name} payment due ${window}`,
        body: `Manual subscription — pay before ${due.toDate().toLocaleDateString('en-GB')} to keep it active.`,
        href: `/household/subscriptions/${subRef.id}`,
        meta: {
          subId: subRef.id,
          cycleId: cycleDoc.id,
          daysBefore: dueDays,
        },
        createdAt: now,
        read: false,
      });
      body.update(cycleDoc.ref, {
        remindersSent: FieldValue.arrayUnion({
          daysBefore: dueDays,
          sentAt: now,
          channel: 'in-app',
        }),
      });
      await body.commit();
      remindersSent += 1;
    }
  } catch (e) {
    console.error('[cron/cycle-advancer] scan failed:', e);
    return NextResponse.json({ error: 'scan-failed' }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    scanned,
    promotedOverdue,
    remindersSent,
    note: 'In-app bell only for v1. FCM web-push + WhatsApp share layer next.',
  });
}

export async function GET(req: NextRequest)  { return run(req); }
export async function POST(req: NextRequest) { return run(req); }
