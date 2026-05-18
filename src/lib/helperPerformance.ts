// Helper performance computation — v3 (2026-05-18).
//
// Four metrics, each scored 0–100 OR null (when there's no data),
// then combined into a single consolidated % using per-family
// configurable weights:
//
//   1. workplan          — % of daily-scheduled tasks completed
//   2. budget            — grocery-shop adherence (under/over estimate)
//   3. ratingCompletion  — % of expected morning+evening ratings logged
//   4. parentFeedback    — aggregated 👍 / 😐 / 👎 from parent
//
// Defaults: 25/25/25/25 weights, 90/70/50 face thresholds, 7-day window.
// All configurable via /settings/performance (parent-only). Per-helper
// overrides let a family exclude a metric for one helper ("tutor
// doesn't shop, exclude budget"). When a metric is null OR excluded,
// it drops out of the consolidated calc + the remaining weights are
// renormalised to 100 so the score stays comparable across helpers.

'use client';

import {
  getDoc, doc, collection, query, where, getDocs, orderBy, limit, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  listWorkplanItems, itemsScheduledOn, dailyCompletionPct,
  todayDateString,
} from './workplan';
import { getPerformancePolicy, effectiveWeights } from './performancePolicy';
import { getHelperFeedbackMetric, type FeedbackWindow } from './helperFeedback';
import { getHelperLink } from './helpers';
import type { WorkplanItem, WorkplanCompletion, PerformancePolicy } from './firestore';
import type { PurchaseRequest } from './purchase';

// ── Metric window shapes ─────────────────────────────────────────

export interface HelperBudgetWindow {
  /** Score 0–100 across the window, or null when the helper hasn't
   *  closed any shops in the window. Computed across SUMMED totals
   *  (not per-shop average) so one big overspend can't be cancelled
   *  by lots of tiny under-spend. */
  scorePct: number | null;
  shopsCount: number;
  totalEstimatedCents: number;
  totalActualCents: number;
  /** Positive = over, negative = under. */
  varianceCents: number;
}

export interface HelperRatingCompletionWindow {
  /** 0–100 score, null when no ratings were expected (helper has
   *  no kids assigned OR expectedFrequency wasn't set). */
  scorePct: number | null;
  /** Number of (period × kid × day) slots the helper was expected
   *  to log a rating for, given expectedFrequency + assigned kids
   *  + the window length. */
  expected: number;
  /** Number of slots actually logged in the window. */
  logged: number;
  /** Helper's expectedFrequency at the time the metric was computed —
   *  surfaced on the card so parents see "expected 14, logged 11"
   *  alongside the helper's role (e.g. Morning helper = 1/day). */
  perDayExpected: number;
}

export interface HelperPerformanceWindow {
  days: number;
  // ── Workplan metric ────────────────────────────────────────────
  todayPct: number | null;
  avgPct: number | null;
  scheduledDays: number;
  activeDays: number;
  tasksDone: number;
  tasksScheduled: number;
  // ── Budget metric ──────────────────────────────────────────────
  budget: HelperBudgetWindow;
  // ── Rating-completion metric (v3) ──────────────────────────────
  ratingCompletion: HelperRatingCompletionWindow;
  // ── Parent feedback metric (v3) ────────────────────────────────
  feedback: FeedbackWindow;
  // ── Consolidated score (weighted average, policy-driven) ───────
  /** Final 0–100 score. Weighted average across metrics that have
   *  data and aren't excluded for this helper. Null when EVERY
   *  metric is null/excluded. */
  consolidatedPct: number | null;
  /** Snapshot of the policy used for this computation. Lets the UI
   *  show "Excellent threshold = 88%" / "weights: 30/30/20/20" etc.
   *  without re-fetching the doc. */
  policy: PerformancePolicy;
  /** Metrics that were excluded for this helper (via policy
   *  helperOverrides). Surfaced as small "n/a" chips on the card. */
  excludedMetrics: string[];
}

// ── Main entry ───────────────────────────────────────────────────

export async function getHelperPerformance(
  familyId: string,
  helperUid: string,
  opts: { days?: number; from?: Date } = {},
): Promise<HelperPerformanceWindow> {
  const policy = await getPerformancePolicy(familyId);
  const days = opts.days ?? policy.windowDays;
  const from = opts.from ?? new Date();

  // Fetch everything in parallel — each metric is independent.
  const [
    items,
    budget,
    ratingCompletion,
    feedback,
  ] = await Promise.all([
    listWorkplanItems(familyId, helperUid),
    getHelperBudgetMetric(familyId, helperUid, { days, from }),
    getHelperRatingMetric(familyId, helperUid, { days, from }),
    getHelperFeedbackMetric(familyId, helperUid, { days, from }),
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

  // Consolidated score — weighted average per policy.
  const { weights, excluded } = effectiveWeights(policy, helperUid);
  const scores: { score: number; weight: number }[] = [];
  if (avgPct                      !== null && weights.workplan         > 0) scores.push({ score: avgPct,                       weight: weights.workplan });
  if (budget.scorePct             !== null && weights.budget           > 0) scores.push({ score: budget.scorePct,              weight: weights.budget });
  if (ratingCompletion.scorePct   !== null && weights.ratingCompletion > 0) scores.push({ score: ratingCompletion.scorePct,    weight: weights.ratingCompletion });
  if (feedback.scorePct           !== null && weights.parentFeedback   > 0) scores.push({ score: feedback.scorePct,            weight: weights.parentFeedback });
  let consolidatedPct: number | null = null;
  if (scores.length > 0) {
    const wSum = scores.reduce((a, s) => a + s.weight, 0);
    if (wSum > 0) {
      consolidatedPct = Math.round(scores.reduce((a, s) => a + s.score * s.weight, 0) / wSum);
    }
  }

  return {
    days,
    todayPct, avgPct, scheduledDays, activeDays, tasksDone, tasksScheduled,
    budget, ratingCompletion, feedback,
    consolidatedPct, policy, excludedMetrics: excluded,
  };
}

// ── Budget metric ────────────────────────────────────────────────

/** Budget adherence metric for one helper. Pulls every closed
 *  PurchaseRequest the helper created in the window, sums estimated
 *  + actual across them, scores by overage:
 *    actual ≤ estimated → 100 (on or under budget)
 *    actual > estimated → 100 − 2 × (overage %), floored at 0
 *  Returns scorePct = null when the helper has no closed shops in
 *  the window — null is "no data", NOT "zero score". */
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
    scorePct = 100;
  } else if (varianceCents <= 0) {
    scorePct = 100;
  } else {
    const overagePct = (varianceCents / totalEstimatedCents) * 100;
    scorePct = Math.max(0, Math.round(100 - overagePct * 2));
  }

  return { scorePct, shopsCount: helperShops.length, totalEstimatedCents, totalActualCents, varianceCents };
}

// ── Rating-completion metric (v3 — new) ──────────────────────────

/** What fraction of expected morning/evening ratings the helper has
 *  actually logged in the window. Pulls all DailyRating docs where
 *  ratedBy === helperUid then scores against:
 *    expected = assignedKidsCount × perDayExpected × windowDays
 *  perDayExpected from HelperLink.expectedFrequency:
 *    'morning' or 'evening' → 1
 *    'both'                  → 2
 *    'flexible' / undef      → 1 (treat as morning-only baseline)
 *
 *  Returns scorePct = null when the helper has NO kids assigned or
 *  the helper-link doc doesn't exist (legacy helpers).
 *
 *  Rule note: ratings are queryable by parents + helpers in the same
 *  family — no extra rule needed for this metric. */
export async function getHelperRatingMetric(
  familyId: string,
  helperUid: string,
  opts: { days?: number; from?: Date } = {},
): Promise<HelperRatingCompletionWindow> {
  const days = opts.days ?? 7;
  const from = opts.from ?? new Date();

  // Resolve helper-link to figure out expected frequency + scope.
  let perDayExpected = 1;
  let assignedKids = 0;
  try {
    const link = await getHelperLink(familyId, helperUid);
    if (!link) {
      // Legacy helper with no HelperLink doc — score unmeasurable.
      return { scorePct: null, expected: 0, logged: 0, perDayExpected: 0 };
    }
    assignedKids = (link.kidIds ?? []).length;
    if (link.expectedFrequency === 'both') perDayExpected = 2;
    else if (link.expectedFrequency === 'morning' || link.expectedFrequency === 'evening') perDayExpected = 1;
    else perDayExpected = 1;
  } catch {
    return { scorePct: null, expected: 0, logged: 0, perDayExpected: 0 };
  }

  if (assignedKids === 0 || perDayExpected === 0) {
    return { scorePct: null, expected: 0, logged: 0, perDayExpected };
  }

  // Pull the helper's ratings in the window.
  const sinceIso = (() => {
    const d = new Date(from);
    d.setDate(d.getDate() - (days - 1));
    return todayDateString(d);
  })();
  const fromIso = todayDateString(from);
  let logged = 0;
  try {
    // Query is filtered by ratedBy first (server-side) so the helper
    // only sees their own ratings; date filter is in-memory because
    // DailyRating uses a `date: string` field (sorted lex equals
    // chronological for YYYY-MM-DD).
    const q = query(
      collection(db, 'families', familyId, 'dailyRatings'),
      where('ratedBy', '==', helperUid),
      orderBy('date', 'desc'),
      limit(200),
    );
    const snap = await getDocs(q);
    snap.forEach((d) => {
      const data = d.data() as { date?: string };
      const date = data.date;
      if (!date) return;
      if (date >= sinceIso && date <= fromIso) logged++;
    });
  } catch {
    // Composite index likely missing for (ratedBy + date desc) — fail
    // soft so the rest of the card still renders.
    return { scorePct: null, expected: 0, logged: 0, perDayExpected };
  }

  const expected = assignedKids * perDayExpected * days;
  const scorePct = expected === 0 ? null : Math.max(0, Math.min(100, Math.round((logged / expected) * 100)));
  return { scorePct, expected, logged, perDayExpected };
}

// ── Face ─────────────────────────────────────────────────────────

export interface PerfFace {
  emoji: string;
  label: string;
  tone: 'great' | 'ok' | 'low' | 'none';
}

/** Friendly emoji + label for a perf %, using the family's policy
 *  thresholds (or the v2 hardcoded 90/70/50 when no policy was
 *  passed — keeps callers that don't yet thread the policy through
 *  working without code change). */
export function perfFace(
  pct: number | null,
  thresholds: { excellent: number; good: number; okay: number } = { excellent: 90, good: 70, okay: 50 },
): PerfFace {
  if (pct === null)              return { emoji: '🟡', label: 'No data',   tone: 'none' };
  if (pct >= thresholds.excellent) return { emoji: '😀', label: 'Excellent', tone: 'great' };
  if (pct >= thresholds.good)      return { emoji: '🙂', label: 'Good',      tone: 'great' };
  if (pct >= thresholds.okay)      return { emoji: '😐', label: 'Okay',      tone: 'ok' };
  return                                   { emoji: '🙁', label: 'Low',       tone: 'low' };
}
