// Household · Create a subscription (server, Admin SDK).
//
// POST { CreateSubscriptionInput } → writes
//   /families/{f}/subscriptions/{clientToken}
//   /families/{f}/subscriptions/{clientToken}/cycles/{cycleId}   (first cycle, status='upcoming')
// in a single Firestore transaction. Idempotent on `clientToken` — a
// retry with the same UUID returns the existing doc instead of writing
// a duplicate.
//
// No spend_ledger write here — ledger is written when a CYCLE is marked
// paid (post-due check), which lands in P4. A new subscription on its
// own doesn't generate spend until a cycle closes.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Body {
  familyId?: string;
  name?: string;
  catalogueRef?: string | null;

  category?: string;
  subCategory?: string;
  platform?: 'ios' | 'android' | 'web' | 'other' | null;

  billingMode?: 'auto' | 'manual';
  status?: 'active' | 'trial' | 'paused' | 'cancelled';
  trialEndsOnIso?: string | null;

  amountOriginalCents?: number;
  currencyOriginal?: string;
  fxRate?: number;

  frequency?: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'semi_annual' | 'annual' | 'one_off' | 'custom';
  customMonths?: number | null;
  nextBillingDateIso?: string;
  startedOnIso?: string;

  accountHolderUid?: string;
  beneficiaryUids?: string[];
  paymentMethodId?: string;
  /** 2026-05-30 — per-parent cost attribution; null = Shared. */
  paidByUid?: string | null;

  vendorSupplierId?: string | null;
  isProfessionalExpense?: boolean;

  reminderDaysBefore?: number[];

  createdByUid?: string;
  clientToken?: string;
}

function monthlyEquivalentCents(
  amountCents: number,
  frequency: NonNullable<Body['frequency']>,
  customMonths?: number | null,
): number {
  if (amountCents <= 0) return 0;
  switch (frequency) {
    case 'daily':       return Math.round(amountCents * 30);
    case 'weekly':      return Math.round(amountCents * 4.33);
    case 'monthly':     return amountCents;
    case 'quarterly':   return Math.round(amountCents / 3);
    case 'semi_annual': return Math.round(amountCents / 6);
    case 'annual':      return Math.round(amountCents / 12);
    case 'one_off':     return 0;
    case 'custom':      return customMonths && customMonths > 0
                          ? Math.round(amountCents / customMonths)
                          : amountCents;
  }
}

function isoToTimestamp(iso: string): Timestamp {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Timestamp.now();
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Timestamp.fromDate(d);
}

/** Build the cycle id (e.g. "2026-06" for monthly). One row per billing
 *  cycle; the post-due check writes to this same row to mark it paid. */
function cycleIdFor(frequency: NonNullable<Body['frequency']>, dueIso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueIso);
  if (!m) return `cycle_${Date.now()}`;
  const [, y, mo, d] = m;
  switch (frequency) {
    case 'daily':       return `${y}-${mo}-${d}`;
    case 'weekly':      return `${y}-${mo}-${d}`;
    case 'monthly':     return `${y}-${mo}`;
    case 'quarterly':   return `${y}-Q${Math.ceil(parseInt(mo, 10) / 3)}`;
    case 'semi_annual': return `${y}-H${parseInt(mo, 10) <= 6 ? 1 : 2}`;
    case 'annual':      return `${y}`;
    case 'one_off':     return `${y}-${mo}-${d}`;
    case 'custom':      return `${y}-${mo}`;
  }
}

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const required = ['familyId', 'name', 'category', 'subCategory', 'billingMode',
                    'amountOriginalCents', 'currencyOriginal', 'fxRate', 'frequency',
                    'nextBillingDateIso', 'startedOnIso', 'accountHolderUid',
                    'createdByUid', 'clientToken'] as const;
  for (const k of required) {
    if (body[k] == null || body[k] === '') {
      return NextResponse.json({ error: `missing: ${k}` }, { status: 400 });
    }
  }
  if (!Number.isFinite(body.amountOriginalCents!) || body.amountOriginalCents! <= 0) {
    return NextResponse.json({ error: 'amount-must-be-positive' }, { status: 400 });
  }
  if (!Number.isFinite(body.fxRate!) || body.fxRate! <= 0) {
    return NextResponse.json({ error: 'fx-rate-must-be-positive' }, { status: 400 });
  }

  const amountHousehold = Math.round(body.amountOriginalCents! * body.fxRate!);
  const monthlyEq = monthlyEquivalentCents(amountHousehold, body.frequency!, body.customMonths);
  const nextBilling = isoToTimestamp(body.nextBillingDateIso!);
  const startedOn   = isoToTimestamp(body.startedOnIso!);
  const now = Timestamp.now();

  // Reminder defaults per spec §3.7
  const remDefaults = body.billingMode === 'manual' ? [7, 2, 0] : [];
  const reminders   = body.reminderDaysBefore ?? remDefaults;

  const familyRef = db.collection('families').doc(body.familyId!);
  const subRef    = familyRef.collection('subscriptions').doc(body.clientToken!);
  const cycleRefId = cycleIdFor(body.frequency!, body.nextBillingDateIso!);
  const cycleRef  = subRef.collection('cycles').doc(cycleRefId);

  const subData = {
    name: body.name!,
    catalogueRef: body.catalogueRef ?? null,

    category: body.category!,
    subCategory: body.subCategory!,
    platform: body.platform ?? null,

    billingMode: body.billingMode!,
    status: body.status ?? 'active',
    trialEndsOn: body.trialEndsOnIso ? isoToTimestamp(body.trialEndsOnIso) : null,

    amountOriginal: body.amountOriginalCents!,
    currencyOriginal: body.currencyOriginal!,
    fxRate: body.fxRate!,
    amountHousehold,
    monthlyEquivalent: monthlyEq,

    frequency: body.frequency!,
    customMonths: body.customMonths ?? null,
    nextBillingDate: nextBilling,
    startedOn,
    endedOn: null,

    accountHolderUid: body.accountHolderUid!,
    beneficiaryUids: body.beneficiaryUids ?? [],
    paymentMethodId: body.paymentMethodId ?? '',
    // Per-parent attribution — null = Shared (default for legacy +
    // new entries until the parent explicitly picks Dad / Mum).
    paidByUid: body.paidByUid ?? null,

    vendorSupplierId: body.vendorSupplierId ?? null,
    linkedWealthAssetId: null,
    sourceModule: 'household' as const,
    isProfessionalExpense: !!body.isProfessionalExpense,

    reminderDaysBefore: reminders,
    postDueCheckEnabled: body.billingMode === 'manual',
    utilisationCheckDays: amountHousehold >= 5000_00 ? 30 : 60,  // higher-cost subs checked more often

    hasReceipt: false,
    receiptCount: 0,

    createdBy: body.createdByUid!,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };

  const cycleData = {
    dueDate: nextBilling,
    amountDue: amountHousehold,
    amountPaid: null,
    paidOn: null,
    paymentMethodId: body.paymentMethodId ?? '',
    receiptIds: [] as string[],
    status: 'upcoming' as const,
    remindersSent: [] as { daysBefore: number; sentAt: Timestamp; channel: string }[],
    postDueCheckResult: null,
  };

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(subRef);
      if (existing.exists) return;  // idempotent on clientToken
      tx.set(subRef, subData);
      tx.set(cycleRef, cycleData);
    });
  } catch (e) {
    console.error('[subscriptions/create] transaction failed:', e);
    return NextResponse.json({ error: 'write-failed' }, { status: 500 });
  }

  return NextResponse.json({ subId: body.clientToken!, cycleId: cycleRefId });
}

export async function POST(req: NextRequest) { return run(req); }
