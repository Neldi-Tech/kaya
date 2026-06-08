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
  doc, getDoc, updateDoc, serverTimestamp, collection, query, where, limit, getDocs,
  Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { todayDateString } from './workplan';
import {
  type HelperLink, type HelperPayrollConfig, type PayBasis, type PayFrequency,
  type PayrollDeduction, type PayrollAllowance,
} from './firestore';
import { listHelpers } from './helpers';
import { createDraftRequest, approveRequest, listPayrollCycleKeys } from './purchase';
import { listApprovedCheckIns, sumApprovedHours, countApprovedDays } from './payCheckIns';
import { toDisplayDate } from './dates';

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
  // 2026-05-27 — endDate uses `'endDate' in patch` (not `??`) so a caller
  // can pass undefined / '' to EXPLICITLY clear it. Before this, clearing
  // the date in the Settings UI silently preserved the stored value
  // because nullish-coalescing fell back to current.endDate. Firestore's
  // ignoreUndefinedProperties drops the field on write, so omitting it
  // from `next` is enough to clear it on disk.
  // Carry ALL existing fields through, then apply the patch — so optional
  // fields (autoApproveToBudget, payWindow, raiseDaysBeforeCycleEnd,
  // lastGeneratedCycle, …) persist instead of being dropped by a whitelist.
  const next: HelperPayrollConfig = {
    ...current,
    ...patch,
    basis:      patch.basis      ?? current.basis      ?? 'monthly',
    rateCents:  patch.rateCents  ?? current.rateCents  ?? 0,
    frequency:  patch.frequency  ?? current.frequency  ?? 'monthly',
    payAnchor:  patch.payAnchor  ?? current.payAnchor  ?? 1,
    startDate:  patch.startDate  ?? current.startDate  ?? todayDateString(),
    // endDate uses `'endDate' in patch` so a caller can clear it (undefined).
    endDate:    ('endDate' in patch) ? (patch.endDate || undefined) : current.endDate,
    payAnchorBufferDays: ('payAnchorBufferDays' in patch)
      ? Math.max(0, Math.min(7, Math.round(patch.payAnchorBufferDays ?? 0)))
      : current.payAnchorBufferDays,
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
 *  Monthly: the full calendar month containing the pay date — the pay
 *           anchor (e.g. "5th of the month") is just when payment happens,
 *           NOT a period boundary. Before 2026-05-27 we clamped the first
 *           cycle to startDate, which produced confusing "01-May → 05-May"
 *           windows for a monthly salary; that's gone now.
 *  Weekly:  from (payDate − 7 days + 1 day)  to payDate
 *  Biweekly: from (payDate − 14 days + 1 day) to payDate */
export function periodForPayDate(
  config: HelperPayrollConfig,
  payDate: Date,
): { periodStart: Date; periodEnd: Date } {
  const startBoundary = parseIso(config.startDate);
  if (config.frequency === 'monthly') {
    // Full calendar month the salary covers. By default that's the month of
    // the pay date. In ARREARS mode (salaryCoversPreviousMonth) it's the
    // month BEFORE the pay date — so a salary paid on 1–5 June covers MAY and
    // lands in May's budget (2026-06-08, Elia: "May's pay → May's budget").
    const y = payDate.getFullYear();
    const m = payDate.getMonth() - (config.salaryCoversPreviousMonth ? 1 : 0);
    const periodStart = startOfDay(new Date(y, m, 1));
    const periodEnd = startOfDay(new Date(y, m + 1, 0));
    // First cycle still respects startDate so check-ins from before the
    // contract began aren't counted (only matters for per-day-worked /
    // per-hour bases; a fixed-monthly salary doesn't read check-ins).
    if (periodStart < startBoundary) return { periodStart: startBoundary, periodEnd };
    return { periodStart, periodEnd };
  }
  // Weekly / biweekly stay window-based off the pay date.
  const periodEnd = startOfDay(payDate);
  const periodStart = new Date(periodEnd);
  if (config.frequency === 'weekly') {
    periodStart.setDate(periodStart.getDate() - 6); // 7-day inclusive
  } else {
    periodStart.setDate(periodStart.getDate() - 13); // 14-day inclusive
  }
  if (periodStart < startBoundary) {
    return { periodStart: startBoundary, periodEnd };
  }
  return { periodStart, periodEnd };
}

// ── Cycle model (2026-06-08) ─────────────────────────────────────
// A monthly salary covers a WORK CYCLE (the whole month) and is RAISED a
// few days before the cycle ends — so May is raised ~24 May, not on the pay
// day. The PAY WINDOW (when you actually pay) is separate and only governs
// when "Mark paid" shows. Weekly/biweekly are unchanged (they stay
// window-based off the pay date — see nextDuePayDate / periodForPayDate).

export interface DueCycle {
  cycleStart: Date;        // 1st of the work month
  cycleEnd: Date;          // last day of the work month
  cycleKey: string;        // 'YYYY-MM' — the budget month
  raiseDate: Date;         // cycleEnd − raiseDaysBeforeCycleEnd
  payWindowStart: Date;
  payWindowEnd: Date;
}

function monthKeyOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** When the salary for a given work cycle is actually paid. */
export function payWindowFor(
  config: HelperPayrollConfig,
  cycleStart: Date,
): { payWindowStart: Date; payWindowEnd: Date } {
  const mode = config.payWindow ?? 'next_month';
  if (mode === 'same_month') {
    const day = Math.min(28, Math.max(1, config.payAnchor || 28));
    const d = startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth(), day));
    return { payWindowStart: d, payWindowEnd: d };
  }
  // next_month → 1st–5th of the month after the cycle.
  const s = startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 1));
  const e = startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 5));
  return { payWindowStart: s, payWindowEnd: e };
}

/** Monthly cycle model: the work cycle due to be RAISED now — today is on or
 *  after (cycleEnd − raiseDays) and the cycle hasn't been raised yet. Returns
 *  null when nothing is due (future, ended, or already raised). Does NOT
 *  back-fill cycles older than ~a month, so flipping the model on never
 *  retro-raises a year of salaries. Monthly only. */
export function nextDueCycle(
  config: HelperPayrollConfig,
  now: Date = new Date(),
): DueCycle | null {
  if (config.frequency !== 'monthly') return null;
  const today = startOfDay(now);
  const start = parseIso(config.startDate);
  const raiseDays = Math.min(28, Math.max(0, Math.round(config.raiseDaysBeforeCycleEnd ?? 7)));
  const endBoundary = config.endDate ? parseIso(config.endDate) : null;
  const lastCycle = config.lastGeneratedCycle ?? '';
  // Don't back-fill cycles whose raise date is more than ~5 weeks ago.
  const oldestRaise = startOfDay(new Date(today));
  oldestRaise.setDate(oldestRaise.getDate() - 35);

  const firstMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  for (let i = 0; i < 240; i++) {
    const cycleStart = startOfDay(new Date(firstMonth.getFullYear(), firstMonth.getMonth() + i, 1));
    const cycleEnd = startOfDay(new Date(cycleStart.getFullYear(), cycleStart.getMonth() + 1, 0));
    const raiseDate = startOfDay(new Date(cycleEnd));
    raiseDate.setDate(raiseDate.getDate() - raiseDays);
    if (raiseDate > today) return null;                 // reached future cycles
    const cycleKey = monthKeyOf(cycleStart);
    if (cycleKey <= lastCycle) continue;                // already raised
    if (raiseDate < oldestRaise) continue;              // too old — don't back-fill
    if (endBoundary && cycleStart > endBoundary) return null;
    const { payWindowStart, payWindowEnd } = payWindowFor(config, cycleStart);
    return { cycleStart, cycleEnd, cycleKey, raiseDate, payWindowStart, payWindowEnd };
  }
  return null;
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

function ordinal(day: number): string {
  return day === 1 ? '1st' : day === 2 ? '2nd' : day === 3 ? '3rd' :
         day === 21 ? '21st' : day === 22 ? '22nd' : day === 23 ? '23rd' :
         `${day}th`;
}

export function payAnchorLabel(config: HelperPayrollConfig): string {
  if (config.frequency === 'monthly') {
    const day = Math.min(Math.max(1, config.payAnchor), 28);
    return `${ordinal(day)} of each month`;
  }
  const dow = ((config.payAnchor % 7) + 7) % 7;
  return `Every ${config.frequency === 'biweekly' ? 'other ' : ''}${DAY_NAMES[dow]}`;
}

/** Human-readable expectation including the optional buffer.
 *  Monthly with no buffer:  "On the 5th of each month"
 *  Monthly with buffer 2:   "5th of each month — paid by the 7th"
 *  Weekly buffer 1:         "Every Friday — by Saturday"
 *  Used in the helper-facing view so the buffer sets a clear "paid-by". */
export function payExpectationLabel(config: HelperPayrollConfig): string {
  const base = payAnchorLabel(config);
  const buf = Math.max(0, Math.min(7, Math.round(config.payAnchorBufferDays ?? 0)));
  if (buf <= 0) return base;
  if (config.frequency === 'monthly') {
    const anchor = Math.min(Math.max(1, config.payAnchor), 28);
    const by = Math.min(28, anchor + buf);
    return `${base} — paid by the ${ordinal(by)}`;
  }
  // weekly / biweekly — name the weekday `buf` days later.
  const dow = ((config.payAnchor + buf) % 7 + 7) % 7;
  return `${base} — by ${DAY_NAMES[dow]}`;
}

// ── Allowance schedule (2026-05-27) ──────────────────────────────
//
// Allowances can now ride the salary cycle OR run their own cadence
// (monthly day-of-month / twice-monthly / weekly / biweekly / one-time).
// Off-cycle allowances generate their OWN payroll request on the matching
// date; the salary request only includes salary-bound allowances. The
// allowance's `lastPaidMonth` / `lastPaidMonthSlots` / `lastPaidWeek` /
// `paidAt` field prevents same-day double-pay.

/** True when this allowance has its own pay schedule (creates its own
 *  request). Legacy rows without a cadence are salary-bound — they ride
 *  the existing salary cycle exactly as before. */
export function isAllowanceOffCycle(a: PayrollAllowance, config: HelperPayrollConfig): boolean {
  if (!a.cadence) return false;
  if (a.cadence === 'monthly') {
    const day = a.payDay ?? config.payAnchor;
    return day !== config.payAnchor;       // same day as salary = bundle into salary
  }
  return true;                             // twice_monthly / weekly / biweekly / one_time always off-cycle
}

/** ISO 8601 week key (YYYY-Www) for weekly / biweekly bookkeeping. */
function isoWeekKey(d: Date): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/** Whether the allowance should fire on `today`. Compares YYYY-MM-DD strings
 *  (not millisecond timestamps) so DST / timezone wobbles don't double-fire. */
export function isAllowanceDueOn(
  a: PayrollAllowance,
  today: Date,
  config: HelperPayrollConfig,
): boolean {
  if (!isAllowanceOffCycle(a, config)) return false;
  const todayIso = isoOf(today);
  if (config.startDate && todayIso < config.startDate) return false;
  if (config.endDate && todayIso > config.endDate) return false;
  const todayMonth = todayIso.slice(0, 7);
  const todayDom = today.getDate();
  const todayDow = today.getDay();
  const todayWeek = isoWeekKey(today);
  switch (a.cadence) {
    case 'monthly': {
      const day = Math.min(28, Math.max(1, a.payDay ?? config.payAnchor));
      if (todayDom < day) return false;
      if (a.lastPaidMonth === todayMonth) return false;
      return true;
    }
    case 'twice_monthly': {
      const days = (a.payDaysOfMonth ?? []).map((d) => Math.min(28, Math.max(1, d)));
      const slots = a.lastPaidMonthSlots ?? {};
      for (const d of days) {
        if (todayDom < d) continue;
        if (slots[String(d)] === todayMonth) continue;
        return true;
      }
      return false;
    }
    case 'weekly': {
      const dow = ((a.payDayOfWeek ?? 5) % 7 + 7) % 7;     // 5 = Friday default
      if (todayDow !== dow) return false;
      if (a.lastPaidWeek === todayWeek) return false;
      return true;
    }
    case 'biweekly': {
      const dow = ((a.payDayOfWeek ?? 5) % 7 + 7) % 7;
      if (todayDow !== dow) return false;
      if (a.lastPaidWeek === todayWeek) return false;
      if (!config.startDate) return true;
      const start = parseIso(config.startDate);
      const weeks = Math.floor((today.getTime() - start.getTime()) / (7 * 86400000));
      return weeks % 2 === 0;                              // pay on the even week from startDate
    }
    case 'one_time': {
      if (!a.payDate || a.paidAt) return false;
      // Fire on or after the scheduled date (so a missed day still pays the next run).
      return todayIso >= a.payDate;
    }
  }
  return false;
}

/** Immutable bookkeeping update for an allowance after it fires today. */
function markAllowancePaid(a: PayrollAllowance, today: Date): PayrollAllowance {
  const todayMonth = isoOf(today).slice(0, 7);
  switch (a.cadence) {
    case 'monthly':       return { ...a, lastPaidMonth: todayMonth };
    case 'twice_monthly': {
      const day = today.getDate();
      const slots = { ...(a.lastPaidMonthSlots ?? {}) };
      slots[String(day)] = todayMonth;
      return { ...a, lastPaidMonthSlots: slots };
    }
    case 'weekly':
    case 'biweekly':      return { ...a, lastPaidWeek: isoWeekKey(today) };
    case 'one_time':      return { ...a, paidAt: Timestamp.now() };
    default:              return a;
  }
}

/** Create a focused payroll request for a single off-cycle allowance. */
async function generateAllowanceRequest(
  familyId: string,
  helper: HelperLink,
  allowance: PayrollAllowance,
  payDate: Date,
  byUid: string,
): Promise<void> {
  const payDateIso = isoOf(payDate);
  const items: import('./purchase').PurchaseRequestItem[] = [{
    id: `pay-${Date.now()}-0`,
    name: `Allowance · ${allowance.label}`,
    qty: 1,
    unit: 'cycle',
    estimatedCents: allowance.amountCents,
    category: 'other',
  }];
  await createDraftRequest(familyId, {
    name: `${allowance.label} · ${helper.displayName} · ${toDisplayDate(payDateIso)}`,
    module: 'payroll',
    helperUid: helper.uid,
    createdBy: byUid,
    createdByRole: 'parent',
    items,
    initialStatus: 'pending_approval',
    generatedBy: 'system',
  });
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
  // Cycles a helper already has a salary for (incl. manual entries) — never
  // raise a second salary for the same month. Prevents double-pay.
  const existingCycles = await listPayrollCycleKeys(familyId).catch(() => new Set<string>());
  for (const helper of helpers) {
    if (helper.status === 'removed') continue;
    const config = helper.payrollConfig;
    if (!config) {
      run.skipped.push({ helperUid: helper.uid, helperName: helper.displayName, reason: 'No payroll config' });
      continue;
    }
    // Monthly → cycle model (raise before month-end); weekly/biweekly → the
    // pay-date window model.
    if (config.frequency === 'monthly') {
      const cycle = nextDueCycle(config, today);
      if (!cycle) {
        run.skipped.push({ helperUid: helper.uid, helperName: helper.displayName, reason: 'Not due yet' });
        continue;
      }
      // Dedupe: a salary for this helper + month already exists (e.g. a manual
      // entry). Skip raising another — but do NOT stamp lastGeneratedCycle, so
      // if the parent deletes that entry the proper cycle can still be raised
      // on the next run. The re-check is one cheap query per run.
      if (existingCycles.has(`${helper.uid}|${cycle.cycleKey}`)) {
        run.skipped.push({ helperUid: helper.uid, helperName: helper.displayName, reason: 'Already raised for this cycle' });
        continue;
      }
      try {
        await generateOneRequest(familyId, helper, { cycle }, byUid);
        run.generated.push({ helperUid: helper.uid, helperName: helper.displayName, payDate: cycle.cycleKey });
      } catch (e) {
        run.skipped.push({
          helperUid: helper.uid, helperName: helper.displayName,
          reason: `Generation failed: ${String(e)}`,
        });
      }
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
      await generateOneRequest(familyId, helper, { payDate }, byUid);
      run.generated.push({ helperUid: helper.uid, helperName: helper.displayName, payDate: payDateIso });
    } catch (e) {
      run.skipped.push({
        helperUid: helper.uid, helperName: helper.displayName,
        reason: `Generation failed: ${String(e)}`,
      });
    }
  }

  // ── Off-cycle allowances (2026-05-27) ──
  // After the salary cycle, walk every helper's allowances for ones due today
  // on their own schedule. Each creates its own payroll request, and we
  // persist bookkeeping back to the helper's config so today doesn't double-fire.
  for (const helper of helpers) {
    if (helper.status === 'removed') continue;
    const config = helper.payrollConfig;
    if (!config) continue;
    const due = (config.allowances ?? []).filter((a) => isAllowanceDueOn(a, today, config));
    if (due.length === 0) continue;
    let updated: PayrollAllowance[] = (config.allowances ?? []).slice();
    for (const a of due) {
      try {
        await generateAllowanceRequest(familyId, helper, a, today, byUid);
        updated = updated.map((x) => (x === a ? markAllowancePaid(a, today) : x));
        run.generated.push({
          helperUid: helper.uid,
          helperName: `${helper.displayName} — ${a.label}`,
          payDate: isoOf(today),
        });
      } catch (e) {
        run.skipped.push({
          helperUid: helper.uid,
          helperName: `${helper.displayName} — ${a.label}`,
          reason: `Allowance generation failed: ${String(e)}`,
        });
      }
    }
    try {
      await setPayrollConfig(familyId, helper.uid, { allowances: updated });
    } catch (e) {
      run.skipped.push({
        helperUid: helper.uid,
        helperName: `${helper.displayName} — bookkeeping`,
        reason: `Failed to persist allowance bookkeeping: ${String(e)}`,
      });
    }
  }

  return run;
}

async function generateOneRequest(
  familyId: string,
  helper: HelperLink,
  when: { cycle: DueCycle } | { payDate: Date },
  byUid: string,
): Promise<void> {
  const config = helper.payrollConfig!;
  // Monthly salaries use the CYCLE model (full work month + pay window);
  // weekly/biweekly keep the pay-date window model.
  const cycle = 'cycle' in when ? when.cycle : null;
  const { periodStart, periodEnd } = 'cycle' in when
    ? { periodStart: when.cycle.cycleStart, periodEnd: when.cycle.cycleEnd }
    : periodForPayDate(config, when.payDate);
  const periodStartIso = isoOf(periodStart);
  const periodEndIso = isoOf(periodEnd);
  const payWindowStartIso = cycle ? isoOf(cycle.payWindowStart) : undefined;
  const payWindowEndIso = cycle ? isoOf(cycle.payWindowEnd) : undefined;
  // Cycle salaries read as the month ("Salary · Catherine · May 2026");
  // weekly/biweekly keep the date-range name.
  const cycleName = cycle
    ? new Date(cycle.cycleStart).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : null;

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
  // Off-cycle allowances (those with their own pay schedule) get their own
  // payroll request created in runPayrollGenerator's second pass — exclude
  // them here so they're not double-paid on the salary cycle.
  const allowances = (config.allowances ?? []).filter((a) => !isAllowanceOffCycle(a, config));
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
  const requestId = await createDraftRequest(familyId, {
    name: cycleName
      ? `Salary · ${helper.displayName} · ${cycleName}`
      : `Salary · ${helper.displayName} · ${toDisplayDate(periodStartIso)} → ${toDisplayDate(periodEndIso)}`,
    module: 'payroll',
    helperUid: helper.uid,
    createdBy: byUid,
    createdByRole: 'parent',  // generator runs in the parent's session
    items,
    initialStatus: 'pending_approval',
    generatedBy: 'system',
    // Budget month = the WORK CYCLE month, so May's pay counts in May even
    // though it's paid in early June.
    budgetMonth: periodStartIso.slice(0, 7),
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
      ...(payWindowStartIso ? { payWindowStart: payWindowStartIso } : {}),
      ...(payWindowEndIso ? { payWindowEnd: payWindowEndIso } : {}),
      deductionRefs,
    },
  });

  // Parent authority (2026-06-08): unless the parent opted out, auto-approve
  // the salary straight to the budget. createdByRole is 'parent', so
  // approveRequest posts it directly to budget as "Processing" (no reconcile,
  // no manual approve tap) — the parent just confirms payment in the window.
  if (config.autoApproveToBudget !== false) {
    try {
      await approveRequest(familyId, requestId, byUid, 'either');
    } catch (e) {
      // Non-fatal: the salary stays as pending_approval for a manual nod.
      // eslint-disable-next-line no-console
      console.error('[payroll] auto-approve to budget failed:', e);
    }
  }

  // ── Stamp the idempotency guard ──
  // Monthly cycle salaries track the work-cycle key; weekly/biweekly keep
  // stamping the pay date.
  await setPayrollConfig(familyId, helper.uid, {
    ...(cycle
      ? { lastGeneratedCycle: cycle.cycleKey }
      : { lastGeneratedDate: isoOf((when as { payDate: Date }).payDate) }),
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
    // Count only, so no orderBy — 3 equality filters use Firestore's
    // merge-join (no composite index). Adding orderBy(createdAt) would
    // need an undeployed composite index and throw.
    const q = query(
      collection(db, 'families', familyId, 'purchaseRequests'),
      where('module', '==', 'payroll'),
      where('helperUid', '==', helperUid),
      where('status', '==', 'pending_approval'),
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
