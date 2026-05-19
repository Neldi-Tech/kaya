// Payroll automation — config + cycle math + generator (v1 — 2026-05-19).
//
// This module owns:
//   1. Reading + writing HelperPayrollConfig (stored on the HelperLink)
//   2. Cycle math — given a config + today, what's the next pay date,
//      what window does it cover, when was the last run
//   3. The generator — for each helper with a config, decide if a
//      pay request is due NOW and create one (pending_approval).
//   4. The "decrement loan balances on close" hook used by
//      closeReconcile in src/lib/purchase.ts.
//
// Runs entirely client-side for v1 — parent visits /pantry/payroll →
// page mounts → calls runPayrollGenerator(familyId). Idempotent via
// lastGeneratedDate on the helper's config + a same-day duplicate
// guard. Future: when this grows beyond hobby scale, lift the
// generator into a Cloud Function on a daily cron.

'use client';

import {
  doc, getDoc, updateDoc, serverTimestamp, collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { todayDateString } from './workplan';
import {
  type HelperLink, type HelperPayrollConfig, type PayBasis, type PayFrequency,
  type PayrollDeduction,
} from './firestore';
import { listHelpers } from './helpers';
import { createDraftRequest } from './purchase';
import { listApprovedCheckIns, sumApprovedHours, countApprovedDays } from './payCheckIns';

// ── Config CRUD ──────────────────────────────────────────────────

const helperRef = (familyId: string, helperUid: string) =>
  doc(db, 'families', familyId, 'helpers', helperUid);

/** Patch this helper's payrollConfig. Use partial updates by passing
 *  a partial — fields not in the patch stay untouched. */
export async function setPayrollConfig(
  familyId: string,
  helperUid: string,
  patch: Partial<HelperPayrollConfig>,
): Promise<void> {
  if (isGuestActive()) return;
  const ref = helperRef(familyId, helperUid);
  const snap = await getDoc(ref);
  const current = (snap.exists() ? (snap.data().payrollConfig ?? {}) : {}) as Partial<HelperPayrollConfig>;
  const next: HelperPayrollConfig = {
    basis:      patch.basis      ?? current.basis      ?? 'monthly',
    rateCents:  patch.rateCents  ?? current.rateCents  ?? 0,
    frequency:  patch.frequency  ?? current.frequency  ?? 'monthly',
    payAnchor:  patch.payAnchor  ?? current.payAnchor  ?? 1,
    startDate:  patch.startDate  ?? current.startDate  ?? todayDateString(),
    endDate:    patch.endDate    ?? current.endDate,
    allowances: patch.allowances ?? current.allowances,
    deductions: patch.deductions ?? current.deductions,
    lastGeneratedDate: patch.lastGeneratedDate ?? current.lastGeneratedDate,
    cyclesRemaining:   patch.cyclesRemaining   ?? current.cyclesRemaining,
  };
  await updateDoc(ref, { payrollConfig: next });
}

/** Disable payroll for a helper without losing the config (so it
 *  can be re-enabled later). v1 just clears the field — restore is
 *  re-entering. Keep simple. */
export async function clearPayrollConfig(
  familyId: string,
  helperUid: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(helperRef(familyId, helperUid), { payrollConfig: null });
}

// ── Cycle math ───────────────────────────────────────────────────

/** Given a config + today, return the END of the most-recent past
 *  pay period whose request hasn't been generated yet. Returns null
 *  if it's not yet payday (or never will be — endDate passed). */
export function nextDuePayDate(
  config: HelperPayrollConfig,
  now: Date = new Date(),
): Date | null {
  const today = startOfDay(now);
  const start = parseIso(config.startDate);
  if (today < start) return null;
  if (config.endDate) {
    const end = parseIso(config.endDate);
    if (today > end) return null;
  }
  // Walk pay-date candidates from startDate forward; the FIRST one
  // that is <= today AND > lastGenerated (or > startDate if never
  // generated) is the one that's due now.
  const last = config.lastGeneratedDate
    ? parseIso(config.lastGeneratedDate)
    : null;
  // Cap the walk so a misconfigured helper (10y old startDate) can't
  // hang the loop. 200 cycles ≈ 4y monthly / 8y biweekly / 4y weekly.
  for (let i = 0; i < 200; i++) {
    const candidate = payDateForOccurrence(config, i);
    if (candidate > today) return null;          // future; nothing due
    if (last && candidate <= last) continue;     // already generated
    return candidate;
  }
  return null;
}

/** Compute the period the next due request should cover.
 *  Monthly: from (payDate − 1 month + 1 day) to payDate
 *  Weekly:  from (payDate − 7 days + 1 day)   to payDate
 *  Biweekly: from (payDate − 14 days + 1 day) to payDate */
export function periodForPayDate(
  config: HelperPayrollConfig,
  payDate: Date,
): { periodStart: Date; periodEnd: Date } {
  const periodEnd = startOfDay(payDate);
  const periodStart = new Date(periodEnd);
  if (config.frequency === 'monthly') {
    periodStart.setMonth(periodStart.getMonth() - 1);
    periodStart.setDate(periodStart.getDate() + 1);
  } else if (config.frequency === 'weekly') {
    periodStart.setDate(periodStart.getDate() - 6); // 7-day inclusive
  } else {
    periodStart.setDate(periodStart.getDate() - 13); // 14-day inclusive
  }
  // Don't go earlier than startDate (first cycle is partial).
  const startBoundary = parseIso(config.startDate);
  if (periodStart < startBoundary) {
    return { periodStart: startBoundary, periodEnd };
  }
  return { periodStart, periodEnd };
}

// ── Internal cycle helpers ───────────────────────────────────────

function payDateForOccurrence(config: HelperPayrollConfig, occurrenceIndex: number): Date {
  const start = parseIso(config.startDate);
  if (config.frequency === 'monthly') {
    // Anchor: day-of-month. First pay on or after startDate that
    // matches payAnchor. Cap day at 28 to avoid Feb edge-cases.
    const safeAnchor = Math.min(Math.max(1, config.payAnchor), 28);
    const d = new Date(start);
    d.setMonth(d.getMonth() + occurrenceIndex);
    // If startDate's own day > anchor, the first occurrence is next month.
    if (occurrenceIndex === 0 && start.getDate() > safeAnchor) {
      d.setMonth(d.getMonth() + 1);
    }
    d.setDate(safeAnchor);
    return startOfDay(d);
  }
  // Weekly + biweekly: anchor = day-of-week (0..6). First pay is
  // the first matching dow on or after startDate.
  const step = config.frequency === 'weekly' ? 7 : 14;
  const safeAnchor = ((config.payAnchor % 7) + 7) % 7;
  const firstPay = new Date(start);
  while (firstPay.getDay() !== safeAnchor) {
    firstPay.setDate(firstPay.getDate() + 1);
  }
  const d = new Date(firstPay);
  d.setDate(d.getDate() + step * occurrenceIndex);
  return startOfDay(d);
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function parseIso(iso: string): Date {
  // Parse as local time (avoid UTC drift). YYYY-MM-DD only.
  const [y, m, d] = iso.split('-').map(Number);
  return startOfDay(new Date(y, (m ?? 1) - 1, d ?? 1));
}

function isoOf(d: Date): string {
  return todayDateString(d);
}

// ── Helpers for the UI: human-readable next-pay summary ──────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function payAnchorLabel(config: HelperPayrollConfig): string {
  if (config.frequency === 'monthly') {
    const day = Math.min(Math.max(1, config.payAnchor), 28);
    const ordinal = day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' :
                    day === 21 ? '21st' : day === 22 ? '22nd' : day === 23 ? '23rd' :
                    `${day}th`;
    return `${ordinal} of each month`;
  }
  const dow = ((config.payAnchor % 7) + 7) % 7;
  return `Every ${config.frequency === 'biweekly' ? 'other ' : ''}${DAY_NAMES[dow]}`;
}

// ── Generator ────────────────────────────────────────────────────

export interface GeneratorRun {
  /** Helpers that had a request generated. */
  generated: { helperUid: string; helperName: string; payDate: string }[];
  /** Helpers checked but skipped (not due yet, no config, etc.). */
  skipped: { helperUid: string; helperName: string; reason: string }[];
}

/** Walk every active helper. For each with a payrollConfig whose
 *  next-due date is today or earlier AND hasn't been generated
 *  yet (lastGeneratedDate guard), create a pending_approval
 *  PurchaseRequest. Returns a summary the page can render.
 *
 *  Safe to call repeatedly — same-day reruns are no-ops because
 *  lastGeneratedDate gets stamped on success. */
export async function runPayrollGenerator(
  familyId: string,
  byUid: string,
): Promise<GeneratorRun> {
  const run: GeneratorRun = { generated: [], skipped: [] };
  if (isGuestActive()) return run;

  const helpers = await listHelpers(familyId);
  const today = new Date();
  for (const helper of helpers) {
    if (helper.status === 'removed') continue;
    const config = helper.payrollConfig;
    if (!config) {
      run.skipped.push({ helperUid: helper.uid, helperName: helper.displayName, reason: 'No payroll config' });
      continue;
    }
    const payDate = nextDuePayDate(config, today);
    if (!payDate) {
      run.skipped.push({ helperUid: helper.uid, helperName: helper.displayName, reason: 'Not due yet' });
      continue;
    }
    const payDateIso = isoOf(payDate);
    // Same-day rerun guard.
    if (config.lastGeneratedDate && config.lastGeneratedDate >= payDateIso) {
      run.skipped.push({ helperUid: helper.uid, helperName: helper.displayName, reason: 'Already generated' });
      continue;
    }
    try {
      await generateOneRequest(familyId, helper, payDate, byUid);
      run.generated.push({ helperUid: helper.uid, helperName: helper.displayName, payDate: payDateIso });
    } catch (e) {
      run.skipped.push({
        helperUid: helper.uid, helperName: helper.displayName,
        reason: `Generation failed: ${String(e)}`,
      });
    }
  }
  return run;
}

async function generateOneRequest(
  familyId: string,
  helper: HelperLink,
  payDate: Date,
  byUid: string,
): Promise<void> {
  const config = helper.payrollConfig!;
  const { periodStart, periodEnd } = periodForPayDate(config, payDate);
  const periodStartIso = isoOf(periodStart);
  const periodEndIso = isoOf(periodEnd);

  // ── Basic pay ──
  let basicCents = 0;
  let hours: number | undefined;
  let daysWorked: number | undefined;
  if (config.basis === 'monthly') {
    basicCents = config.rateCents;
  } else {
    // Hourly + daily need check-ins in the window. Only APPROVED
    // check-ins count toward the basic.
    const approved = await listApprovedCheckIns(familyId, helper.uid, periodStartIso, periodEndIso);
    if (config.basis === 'hourly') {
      hours = sumApprovedHours(approved);
      basicCents = Math.round(hours * config.rateCents);
    } else {
      daysWorked = countApprovedDays(approved);
      basicCents = Math.round(daysWorked * config.rateCents);
    }
  }

  // ── Allowances ──
  const allowances = config.allowances ?? [];
  const allowancesCents = allowances.reduce((acc, a) => acc + (a.amountCents ?? 0), 0);

  // ── Deductions ──
  const activeDeductions = (config.deductions ?? []).filter((d) => d.active && d.balanceCents > 0);
  // Cap each deduction at the outstanding balance so the last cycle
  // doesn't overshoot.
  const effectiveDeductions = activeDeductions.map((d) => ({
    ...d,
    perCycleCents: Math.min(d.perCycleCents, d.balanceCents),
  }));
  const deductionsCents = effectiveDeductions.reduce((acc, d) => acc + d.perCycleCents, 0);
  const deductionRefs = effectiveDeductions.map((d) => d.sourceRequestId);

  // ── Net ──
  const netCents = Math.max(0, basicCents + allowancesCents - deductionsCents);

  // ── Item lines ──
  // We use the existing PurchaseRequestItem shape so the basket
  // renderer + budget hooks all work without special-casing.
  // Convention: positive items add to total; we cheat by using qty
  // = 1 + estimatedCents = signed cents. Deductions appear as
  // negative cents in their own row so the standard `sumEstimated`
  // computes the right total.
  const items: import('./purchase').PurchaseRequestItem[] = [];
  let idCounter = 0;
  const id = () => `pay-${Date.now()}-${idCounter++}`;
  // Basic line
  if (config.basis === 'monthly') {
    items.push({
      id: id(),
      name: 'Basic pay (monthly)',
      qty: 1,
      unit: 'cycle',
      estimatedCents: basicCents,
      category: 'other',
    });
  } else if (config.basis === 'hourly') {
    items.push({
      id: id(),
      name: `Basic pay · ${hours ?? 0}h × ${formatRate(config.rateCents)}`,
      qty: 1,
      unit: 'cycle',
      estimatedCents: basicCents,
      category: 'other',
    });
  } else {
    items.push({
      id: id(),
      name: `Basic pay · ${daysWorked ?? 0} day${daysWorked === 1 ? '' : 's'} × ${formatRate(config.rateCents)}`,
      qty: 1,
      unit: 'cycle',
      estimatedCents: basicCents,
      category: 'other',
    });
  }
  // Allowances
  for (const a of allowances) {
    items.push({
      id: id(),
      name: `Allowance · ${a.label}`,
      qty: 1,
      unit: 'cycle',
      estimatedCents: a.amountCents,
      category: 'other',
    });
  }
  // Deductions (negative). The detail page renders these in red.
  for (const d of effectiveDeductions) {
    items.push({
      id: id(),
      name: `Repayment · ${d.label}`,
      qty: 1,
      unit: 'cycle',
      estimatedCents: -d.perCycleCents,
      category: 'other',
    });
  }

  // ── Create request ──
  await createDraftRequest(familyId, {
    name: `Salary · ${helper.displayName} · ${periodStartIso} → ${periodEndIso}`,
    module: 'payroll',
    helperUid: helper.uid,
    createdBy: byUid,
    createdByRole: 'parent',  // generator runs in the parent's session
    items,
    initialStatus: 'pending_approval',
    generatedBy: 'system',
    payrollCycle: {
      basis: config.basis,
      hours,
      daysWorked,
      basicCents,
      allowancesCents,
      deductionsCents,
      netCents,
      periodStart: periodStartIso,
      periodEnd: periodEndIso,
      deductionRefs,
    },
  });

  // ── Stamp lastGeneratedDate ──
  await setPayrollConfig(familyId, helper.uid, {
    lastGeneratedDate: isoOf(payDate),
    ...(typeof config.cyclesRemaining === 'number'
      ? { cyclesRemaining: Math.max(0, config.cyclesRemaining - 1) }
      : {}),
  });
}

function formatRate(cents: number): string {
  // Lightweight — the request name needs a readable rate even
  // without a currency context (we don't have hive currency here).
  // Detail page uses formatCents with the proper currency.
  return cents >= 100
    ? `${(cents / 100).toFixed(0)}`
    : `${(cents / 100).toFixed(2)}`;
}

// ── Loan-balance decrement (called from closeReconcile) ──────────

/** When a system-generated payroll request closes, decrement the
 *  balance of every deduction it included. Marks deductions
 *  inactive when balance reaches zero so the next cycle doesn't
 *  include them.
 *
 *  Idempotency: the close itself is protected upstream (only fires
 *  on the status transition to 'closed'). Within this function we
 *  just compute new balances + write back. No double-decrement risk
 *  in normal flow. */
export async function applyDeductionsOnClose(
  familyId: string,
  helperUid: string,
  payrollCycle: {
    deductionRefs?: string[];
    deductionsCents?: number;
  } | undefined,
): Promise<void> {
  if (isGuestActive()) return;
  if (!payrollCycle?.deductionRefs?.length) return;
  const ref = helperRef(familyId, helperUid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const config = snap.data().payrollConfig as HelperPayrollConfig | undefined;
  if (!config?.deductions) return;
  const refs = new Set(payrollCycle.deductionRefs);
  const nextDeductions: PayrollDeduction[] = config.deductions.map((d) => {
    if (!refs.has(d.sourceRequestId) || !d.active) return d;
    // The amount we actually deducted is `perCycleCents` capped at
    // the balance at generation time. Recompute from current balance.
    const applied = Math.min(d.perCycleCents, d.balanceCents);
    const nextBalance = Math.max(0, d.balanceCents - applied);
    return {
      ...d,
      balanceCents: nextBalance,
      active: nextBalance > 0,
    };
  });
  await updateDoc(ref, { 'payrollConfig.deductions': nextDeductions });
}

// ── Find existing pending requests for a helper (UI hint) ────────

/** Are there ALREADY pending salary requests for this helper that
 *  the parent hasn't reviewed? Used to suppress regeneration + show
 *  a "1 waiting on you" pill on the payroll dashboard. */
export async function pendingPayrollFor(
  familyId: string,
  helperUid: string,
): Promise<number> {
  if (isGuestActive()) return 0;
  try {
    const q = query(
      collection(db, 'families', familyId, 'purchaseRequests'),
      where('module', '==', 'payroll'),
      where('helperUid', '==', helperUid),
      where('status', '==', 'pending_approval'),
      orderBy('createdAt', 'desc'),
      limit(20),
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch {
    return 0;
  }
}

// Re-export for ergonomic consumer imports.
export type { HelperPayrollConfig, PayBasis, PayFrequency };
