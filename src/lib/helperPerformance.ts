// Helper performance computation. v2 = workplan completion +
// grocery-budget adherence. Future iterations layer on: rating
// completion, parent feedback. Each metric returns 0–100 OR null
// (when there's no data to score).
//
// The consolidated % is currently a simple average of the metrics
// that HAVE data (so a helper without any shops doesn't get penalised
// for the missing budget metric). Once all four metrics ship + we
// build the weights UI, this becomes a weighted average per family
// config (default 25/25/25/25).
//
// Designed to be cheap: workplan loads N day-docs (default 7); the
// budget metric loads recent closed purchaseRequests via the existing
// composite index (status ASC + closedAt DESC). Both run in parallel.

'use client';

import {
  getDoc, doc, collection, query, where, getDocs, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  listWorkplanItems, itemsScheduledOn, dailyCompletionPct,
  todayDateString,
} from './workplan';
import type { WorkplanItem, WorkplanCompletion } from './firestore';
import type { PurchaseRequest } from './purchase';

export interface HelperBudgetWindow {
  /** Score 0–100 across the window, or null when the helper hasn't
   *  closed any shops in the window. Computed across SUMMED totals
   *  (not per-shop average) so one big overspend can't be cancelled
   *  by lots of tiny under-spend. */
  scorePct: number | null;
  /** Number of helper-attributed closed shops in the window. */
  shopsCount: number;
  /** Total estimated spend across those shops, in display-currency cents. */
  totalEstimatedCents: number;
  /** Total actual spend across those shops, in display-currency cents. */
  totalActualCents: number;
  /** Positive = over, negative = under. `totalActual - totalEstimated`. */
  varianceCents: number;
}

export interface HelperPerformanceWindow {
  /** Last N days the metric considers. Default 7. */
  days: number;
  // ── Workplan metric ────────────────────────────────────────────
  /** Today's workplan % (0–100), or null when nothing was scheduled. */
  todayPct: number | null;
  /** Average daily completion % over the window — only counts days
   *  that HAD scheduled tasks (vacuous-truth days are excluded). */
  avgPct: number | null;
  /** Number of scheduled days in the window (denominator of avgPct). */
  scheduledDays: number;
  /** Number of days the helper logged anything at all (touched the
   *  app). Useful as an engagement signal separate from completion. */
  activeDays: number;
  /** Total tasks completed across the window — for the badge count. */
  tasksDone: number;
  /** Total scheduled tasks across the window — denominator of overall. */
  tasksScheduled: number;
  // ── Budget metric ──────────────────────────────────────────────
  /** Budget adherence across the window. See HelperBudgetWindow. */
  budget: HelperBudgetWindow;
  // ── Consolidated score ─────────────────────────────────────────
  /** Simple average of the metrics that have data (avgPct + budget.scorePct).
   *  Null when neither metric has data. Once the remaining two
   *  metrics ship + the weights UI lands this becomes a weighted
   *  average per family config (default 25/25/25/25). */
  consolidatedPct: number | null;
}

/** Walk backwards from `from` (default today) for `days` days and
 *  compute today's % + window avg + activity counts + budget score.
 *  Workplan + budget run in parallel — no extra wall-clock cost. */
export async function getHelperPerformance(
  familyId: string,
  helperUid: string,
  opts: { days?: number; from?: Date } = {},
): Promise<HelperPerformanceWindow> {
  const days = opts.days ?? 7;
  const from = opts.from ?? new Date();
  const [items, budget] = await Promise.all([
    listWorkplanItems(familyId, helperUid),
    getHelperBudgetMetric(familyId, helperUid, { days, from }),
  ]);

  // Pull all completions for the window in parallel.
  const datesToRead: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    datesToRead.push(todayDateString(d));
  }
  const completionsRef = (date: string) =>
    doc(collection(db, 'families', familyId, 'helpers', helperUid, 'workplanCompletions'), date);
  const snaps = await Promise.all(datesToRead.map((d) => getDoc(completionsRef(d))));
  const completionByDate = new Map<string, WorkplanCompletion | null>();
  for (let i = 0; i < datesToRead.length; i++) {
    const s = snaps[i];
    completionByDate.set(
      datesToRead[i],
      s.exists() ? ({ date: s.id, ...s.data() } as WorkplanCompletion) : null,
    );
  }

  let scheduledDays = 0;
  let activeDays = 0;
  let pctSum = 0;
  let tasksDone = 0;
  let tasksScheduled = 0;
  for (let i = 0; i < days; i++) {
    const dateStr = datesToRead[i];
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    const scheduledThatDay = itemsScheduledOn(items, d);
    const completion = completionByDate.get(dateStr) ?? null;
    if (scheduledThatDay.length === 0) continue;
    scheduledDays++;
    const pct = dailyCompletionPct(scheduledThatDay, completion);
    pctSum += pct;
    tasksScheduled += scheduledThatDay.length;
    const doneIds = completion?.completedItemIds ?? [];
    tasksDone += scheduledThatDay.filter((i) => doneIds.includes(i.id)).length;
    if (completion && (completion.completedItemIds.length > 0 || completion.eodNote)) {
      activeDays++;
    }
  }

  const todayScheduled = itemsScheduledOn(items, from);
  const todayCompletion = completionByDate.get(todayDateString(from)) ?? null;
  const todayPct = todayScheduled.length === 0
    ? null
    : dailyCompletionPct(todayScheduled, todayCompletion);

  const avgPct = scheduledDays === 0 ? null : Math.round(pctSum / scheduledDays);

  // Consolidated score — simple average of metrics that have data.
  // Skips null metrics so a helper without any shops isn't penalised.
  const metrics: number[] = [];
  if (avgPct !== null) metrics.push(avgPct);
  if (budget.scorePct !== null) metrics.push(budget.scorePct);
  const consolidatedPct = metrics.length === 0
    ? null
    : Math.round(metrics.reduce((a, b) => a + b, 0) / metrics.length);

  return { days, todayPct, avgPct, scheduledDays, activeDays, tasksDone, tasksScheduled, budget, consolidatedPct };
}

/** Budget adherence metric for one helper. Pulls every closed
 *  PurchaseRequest the helper created in the window, sums estimated
 *  + actual across them, scores by overage:
 *    actual ≤ estimated → 100 (on or under budget)
 *    actual > estimated → 100 - 2 × (overage %), floored at 0
 *      (i.e. 10% over = 80, 25% over = 50, 50%+ over = 0)
 *  Returns scorePct = null when the helper has no closed shops in
 *  the window — null is "no data", NOT "zero score".
 *
 *  Per-shop attribution: each PurchaseRequest carries `createdBy` +
 *  `createdByRole` so the helper is identifiable without any schema
 *  change. The helper-filter is post-fetch (small N, ~100 docs cap)
 *  to avoid needing a composite index that includes createdBy.
 */
export async function getHelperBudgetMetric(
  familyId: string,
  helperUid: string,
  opts: { days?: number; from?: Date } = {},
): Promise<HelperBudgetWindow> {
  const days = opts.days ?? 7;
  const from = opts.from ?? new Date();
  const since = new Date(from);
  since.setDate(since.getDate() - days);
  const sinceTs = Timestamp.fromDate(since);

  const q = query(
    collection(db, 'families', familyId, 'purchaseRequests'),
    where('status', '==', 'closed'),
    where('closedAt', '>=', sinceTs),
    orderBy('closedAt', 'desc'),
    limit(100),
  );
  let snaps;
  try {
    snaps = await getDocs(q);
  } catch {
    // Missing composite index OR rules denied — degrade gracefully
    // to "no budget data" so the rest of the perf card still renders.
    return { scorePct: null, shopsCount: 0, totalEstimatedCents: 0, totalActualCents: 0, varianceCents: 0 };
  }

  const helperShops: PurchaseRequest[] = [];
  snaps.forEach((d) => {
    const data = { id: d.id, ...d.data() } as PurchaseRequest;
    if (data.createdBy === helperUid && data.createdByRole === 'helper') {
      helperShops.push(data);
    }
  });

  if (helperShops.length === 0) {
    return { scorePct: null, shopsCount: 0, totalEstimatedCents: 0, totalActualCents: 0, varianceCents: 0 };
  }

  const totalEstimatedCents = helperShops.reduce((acc, r) => acc + (r.estimatedTotalCents ?? 0), 0);
  const totalActualCents = helperShops.reduce(
    (acc, r) => acc + (r.actualTotalCents ?? r.estimatedTotalCents ?? 0),
    0,
  );
  const varianceCents = totalActualCents - totalEstimatedCents;

  let scorePct: number;
  if (totalEstimatedCents === 0) {
    scorePct = 100; // no plan to compare against → neutral
  } else if (varianceCents <= 0) {
    scorePct = 100;
  } else {
    const overagePct = (varianceCents / totalEstimatedCents) * 100;
    scorePct = Math.max(0, Math.round(100 - overagePct * 2));
  }

  return { scorePct, shopsCount: helperShops.length, totalEstimatedCents, totalActualCents, varianceCents };
}

/** Friendly emoji + label for a perf %. Used by PerformanceCard so the
 *  visual is readable even before someone parses the number. */
export function perfFace(pct: number | null): { emoji: string; label: string; tone: 'great' | 'ok' | 'low' | 'none' } {
  if (pct === null) return { emoji: '🟡', label: 'No data',   tone: 'none' };
  if (pct >= 90)    return { emoji: '😀', label: 'Excellent', tone: 'great' };
  if (pct >= 70)    return { emoji: '🙂', label: 'Good',      tone: 'great' };
  if (pct >= 50)    return { emoji: '😐', label: 'Okay',      tone: 'ok' };
  return                     { emoji: '🙁', label: 'Low',       tone: 'low' };
}
