// Household · Create a contribution (server, Admin SDK).
//
// POST { CreateContributionInput } → writes both
//   /families/{f}/contributions/{clientToken}
//   /families/{f}/spend_ledger/{clientToken}
// in a single Firestore transaction. Idempotent on `clientToken` — a
// retry with the same UUID returns the existing doc instead of writing
// a duplicate.
//
// Why the API: client cannot write /spend_ledger (Firestore rules deny
// — server-only). Co-writing entry + ledger atomically here keeps the
// roll-up dashboards in sync with the contribution list without a
// second-pass trigger.

import { NextRequest, NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface Body {
  familyId?: string;
  recipientName?: string;
  recipientType?: 'person' | 'organization' | 'cause' | 'community';
  anonymousFlag?: boolean;

  category?: string;
  subCategory?: string;

  occasionName?: string;
  occasionDateIso?: string;
  occasionGroupId?: string | null;

  amountOriginalCents?: number;
  currencyOriginal?: string;
  fxRate?: number;

  frequency?: 'monthly' | 'quarterly' | 'annual' | 'one_off' | 'custom';
  customMonths?: number | null;
  dateGivenIso?: string;

  givenByUid?: string;
  givenOnBehalfOf?: string;
  /** 2026-05-30 — per-parent attribution; null = Shared. */
  paidByUid?: string | null;

  paymentMethod?: 'mpesa' | 'bank' | 'cash' | 'cheque' | 'in_kind' | 'other';
  inKindDescription?: string;
  estimatedValueCents?: number;

  isPercentOfIncome?: boolean;
  percentRate?: number | null;
  incomeBasisCents?: number | null;

  taxDeductible?: boolean;
  receiptHeld?: boolean;

  visibility?: 'parents_only' | 'family' | 'private_to_giver';

  notes?: string;
  tags?: string[];

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
    case 'monthly':   return amountCents;
    case 'quarterly': return Math.round(amountCents / 3);
    case 'annual':    return Math.round(amountCents / 12);
    case 'one_off':   return 0;
    case 'custom':    return customMonths && customMonths > 0
                        ? Math.round(amountCents / customMonths)
                        : amountCents;
  }
}

function isoToTimestamp(iso: string): Timestamp {
  // Treat the YYYY-MM-DD date as LOCAL midnight (Kaya helpers are global —
  // never compute day boundaries in UTC). Matches the convention in
  // lib/dates.ts.
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return Timestamp.now();
  const d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return Timestamp.fromDate(d);
}

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const required = ['familyId', 'recipientName', 'category', 'subCategory',
                    'amountOriginalCents', 'currencyOriginal', 'fxRate', 'frequency',
                    'dateGivenIso', 'givenByUid', 'paymentMethod', 'clientToken'] as const;
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
  const monthlyEq = monthlyEquivalentCents(
    amountHousehold,
    body.frequency!,
    body.customMonths,
  );
  const dateGiven = isoToTimestamp(body.dateGivenIso!);
  const now = Timestamp.now();

  const familyRef = db.collection('families').doc(body.familyId!);
  const contribRef = familyRef.collection('contributions').doc(body.clientToken!);
  const ledgerRef  = familyRef.collection('spend_ledger').doc(body.clientToken!);

  const recurring = body.frequency !== 'one_off';

  const contribData = {
    recipientName:        body.recipientName!,
    recipientType:        body.recipientType ?? 'organization',
    recipientSupplierId:  null,
    catalogueRef:         null,
    anonymousFlag:        !!body.anonymousFlag,

    category:             body.category!,
    subCategory:          body.subCategory!,

    occasion: body.occasionName
      ? {
          name:    body.occasionName,
          date:    body.occasionDateIso ? isoToTimestamp(body.occasionDateIso) : dateGiven,
          groupId: body.occasionGroupId ?? null,
        }
      : null,

    amountOriginal:    body.amountOriginalCents!,
    currencyOriginal:  body.currencyOriginal!,
    fxRate:            body.fxRate!,
    amountHousehold,
    monthlyEquivalent: monthlyEq,

    frequency:    body.frequency!,
    customMonths: body.customMonths ?? null,
    dateGiven,

    givenByUid:      body.givenByUid!,
    givenOnBehalfOf: body.givenOnBehalfOf ?? '',
    paidByUid:       body.paidByUid ?? null,

    paymentMethod:     body.paymentMethod!,
    inKindDescription: body.inKindDescription ?? null,
    estimatedValue:    body.estimatedValueCents ?? null,

    isPercentOfIncome: !!body.isPercentOfIncome,
    percentRate:       body.percentRate ?? null,
    incomeBasis:       body.incomeBasisCents ?? null,
    incomeSourceRef:   null,

    taxDeductible: !!body.taxDeductible,
    receiptHeld:   !!body.receiptHeld,

    visibility: body.visibility ?? 'parents_only',

    notes: body.notes ?? '',
    tags:  body.tags ?? [],

    remembranceRecurring: false,
    remembranceDate:      null,

    createdBy: body.createdByUid!,
    createdAt: now,
    updatedAt: now,
  };

  const ledgerData = {
    sourceModule: 'contributions' as const,
    sourceId:     body.clientToken!,
    cycleId:      null,

    category:    body.category!,
    subCategory: body.subCategory!,

    amountHousehold,
    amountOriginal:   body.amountOriginalCents!,
    currencyOriginal: body.currencyOriginal!,
    fxRateUsed:       body.fxRate!,
    monthlyEquivalent: monthlyEq,
    recurring,

    occurredOn: dateGiven,
    bookedOn:   now,

    accountHolderUid:      body.givenByUid!,
    recipientPageId:       null,
    taxDeductible:         !!body.taxDeductible,
    isProfessionalExpense: false,
  };

  try {
    await db.runTransaction(async (tx) => {
      const existing = await tx.get(contribRef);
      if (existing.exists) return;  // idempotent on clientToken
      tx.set(contribRef, contribData);
      tx.set(ledgerRef,  ledgerData);
    });
  } catch (e) {
    console.error('[contributions/create] transaction failed:', e);
    return NextResponse.json({ error: 'write-failed' }, { status: 500 });
  }

  return NextResponse.json({ contribId: body.clientToken! });
}

export async function POST(req: NextRequest) { return run(req); }
