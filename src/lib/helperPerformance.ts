// Helper performance computation. v1 = workplan completion only.
// Future iterations layer on: rating completion, budget adherence,
// parent feedback. Each metric returns 0–100 OR null (when no data).
// The consolidated % is a weighted average per family config (default
// 25/25/25/25 across the 4 metrics).
//
// Designed to be cheap: workplan completion loads a small number of
// per-day docs (one per day in the window). For the default 7-day
// window that's 7 + (items count) reads per helper.

'use client';

import { getDoc, doc, collection } from 'firebase/firestore';
import { db } from './firebase';
import {
  listWorkplanItems, itemsScheduledOn, dailyCompletionPct,
  todayDateString,
} from './workplan';
import type { WorkplanItem, WorkplanCompletion } from './firestore';

export interface HelperPerformanceWindow {
  /** Last N days the metric considers. Default 7. */
  days: number;
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
}

/** Walk backwards from `from` (default today) for `days` days and
 *  compute today's % + window avg + activity counts. */
export async function getHelperPerformance(
  familyId: string,
  helperUid: string,
  opts: { days?: number; from?: Date } = {},
): Promise<HelperPerformanceWindow> {
  const days = opts.days ?? 7;
  const from = opts.from ?? new Date();
  const items = await listWorkplanItems(familyId, helperUid);

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

  return { days, todayPct, avgPct, scheduledDays, activeDays, tasksDone, tasksScheduled };
}

/** Friendly emoji + label for a perf %. Used by PerformanceCard so the
 *  visual is readable even before someone parses the number. */
export function perfFace(pct: number | null): { emoji: string; label: string; tone: 'great' | 'ok' | 'low' | 'none' } {
  if (pct === null) return { emoji: '🟡', label: 'No tasks',  tone: 'none' };
  if (pct >= 90)    return { emoji: '😀', label: 'Excellent', tone: 'great' };
  if (pct >= 70)    return { emoji: '🙂', label: 'Good',      tone: 'great' };
  if (pct >= 50)    return { emoji: '😐', label: 'Okay',      tone: 'ok' };
  return                     { emoji: '🙁', label: 'Low',       tone: 'low' };
}
