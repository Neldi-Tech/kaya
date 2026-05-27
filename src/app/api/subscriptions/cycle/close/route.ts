// Household · Close a subscription cycle (post-due check).
//
// POST { CloseCycleInput } → atomically:
//   1. Update cycles/{cycleId}: status='paid', amountPaid, paidOn,
//      postDueCheckResult, paymentMethodId
//   2. Bump subscriptions/{subId}.nextBillingDate forward by frequency
//      (so the next cycle's "upcoming" date is correct)
//   3. Write spend_ledger/{cycleId}_{subId} with the cycle's actuals
//
// `result === 'snoozed'` postpones the post-due check by 3 days (sub's
// nextBillingDate stays put). `result === 'issue'` flags the cycle as
// problem; no ledger write.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Body {
  familyId?: string;
  subId?: string;
  cycleId?: string;
  result?: 'paid' | 'snoozed' | 'issue';
  paidAmountCents?: number;
  paidOnIso?: string;
  paymentMethodId?: string;
  closedByUid?: string;
}

function isoToTimestamp(iso: string): Timestamp {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Timestamp.now();
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Timestamp.fromDate(d);
}

/** Advance a date by one cycle of the given frequency. Mirrors the
 *  cycleIdFor / monthlyEquivalent helpers in subscriptions/create. */
function advanceDate(from: Date, frequency: string, customMonths: number | null): Date {
  const d = new Date(from);
  switch (frequency) {
    case 'daily':       d.setDate(d.getDate() + 1); break;
    case 'weekly':      d.setDate(d.getDate() + 7); break;
    case 'monthly':     d.setMonth(d.getMonth() + 1); break;
    case 'quarterly':   d.setMonth(d.getMonth() + 3); break;
    case 'semi_annual': d.setMonth(d.getMonth() + 6); break;
    case 'annual':      d.setFullYear(d.getFullYear() + 1); break;
    case 'one_off':     break;
    case 'custom':      if (customMonths && customMonths > 0) d.setMonth(d.getMonth() + customMonths); break;
  }
  return d;
}

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const required = ['familyId', 'subId', 'cycleId', 'result', 'closedByUid'] as const;
  for (const k of required) {
    if (body[k] == null || body[k] === '') {
      return NextResponse.json({ error: `missing: ${k}` }, { status: 400 });
    }
  }
  if (!['paid', 'snoozed', 'issue'].includes(body.result!)) {
    return NextResponse.json({ error: 'invalid-result' }, { status: 400 });
  }

  const famRef   = db.collection('families').doc(body.familyId!);
  const subRef   = famRef.collection('subscriptions').doc(body.subId!);
  const cycleRef = subRef.collection('cycles').doc(body.cycleId!);
  const ledgerRef = famRef.collection('spend_ledger').doc(`${body.cycleId!}_${body.subId!}`);
  const now = Timestamp.now();

  try {
    const ledgerId = await db.runTransaction(async (tx) => {
      const [subSnap, cycleSnap] = await Promise.all([tx.get(subRef), tx.get(cycleRef)]);
      if (!subSnap.exists)   throw new Error('sub-not-found');
      if (!cycleSnap.exists) throw new Error('cycle-not-found');

      const sub   = subSnap.data()!;
      const cycle = cycleSnap.data()!;

      // SNOOZED — push the cycle's dueDate by 3 days; cycle stays open
      if (body.result === 'snoozed') {
        const newDue = new Date(cycle.dueDate.toDate());
        newDue.setDate(newDue.getDate() + 3);
        tx.update(cycleRef, {
          dueDate: Timestamp.fromDate(newDue),
          postDueCheckResult: 'snoozed',
          status: 'due',
        });
        return null;
      }

      // ISSUE — flag and surface; no ledger write
      if (body.result === 'issue') {
        tx.update(cycleRef, {
          status: 'overdue',
          postDueCheckResult: 'issue',
        });
        return null;
      }

      // PAID — record payment + bump nextBillingDate + write ledger
      const paidAmount = body.paidAmountCents ?? cycle.amountDue;
      const paidOn = body.paidOnIso ? isoToTimestamp(body.paidOnIso) : now;
      const paymentMethodId = body.paymentMethodId ?? cycle.paymentMethodId ?? sub.paymentMethodId ?? '';

      tx.update(cycleRef, {
        status: 'paid',
        amountPaid: paidAmount,
        paidOn,
        paymentMethodId,
        postDueCheckResult: 'paid',
      });

      // Advance nextBillingDate on the parent sub
      const newNext = advanceDate(
        sub.nextBillingDate?.toDate?.() ?? new Date(),
        sub.frequency,
        sub.customMonths ?? null,
      );
      tx.update(subRef, {
        nextBillingDate: Timestamp.fromDate(newNext),
        updatedAt: now,
      });

      // Spend ledger entry — what Wealth sees for the cross-module dashboard
      tx.set(ledgerRef, {
        sourceModule: 'subscriptions',
        sourceId: body.subId!,
        cycleId: body.cycleId!,

        category: sub.category,
        subCategory: sub.subCategory,

        amountHousehold: paidAmount,
        amountOriginal: cycle.amountDue,        // best approximation pre-FX
        currencyOriginal: sub.currencyOriginal,
        fxRateUsed: sub.fxRate,
        monthlyEquivalent: sub.monthlyEquivalent,
        recurring: sub.frequency !== 'one_off',

        occurredOn: paidOn,
        bookedOn: now,

        accountHolderUid: sub.accountHolderUid,
        recipientPageId: null,
        taxDeductible: false,
        isProfessionalExpense: !!sub.isProfessionalExpense,
      });

      return ledgerRef.id;
    });

    return NextResponse.json({ ok: true, ledgerId });
  } catch (e) {
    const msg = (e as Error).message || 'write-failed';
    if (msg === 'sub-not-found' || msg === 'cycle-not-found') {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    console.error('[subscriptions/cycle/close] transaction failed:', e);
    return NextResponse.json({ error: 'write-failed' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return run(req); }
