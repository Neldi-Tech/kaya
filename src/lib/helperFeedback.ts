// Parent feedback on a helper — the 4th performance metric (v3 —
// 2026-05-18). One doc per day at:
//   /families/{f}/helpers/{uid}/feedbackNotes/{YYYY-MM-DD}
// so a parent tapping "👍 today" twice is idempotent (upsert).
//
// Metric: clamp((positive% − negative%), 0, 100) across the window.
// Null when there are no notes — no penalty for unmeasured days.

'use client';

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc,
  query, orderBy, limit, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { HelperFeedbackNote, FeedbackSentiment } from './firestore';
import { todayDateString } from './workplan';

const feedbackCol = (familyId: string, helperUid: string) =>
  collection(db, 'families', familyId, 'helpers', helperUid, 'feedbackNotes');

const feedbackDoc = (familyId: string, helperUid: string, date: string) =>
  doc(db, 'families', familyId, 'helpers', helperUid, 'feedbackNotes', date);

/** Upsert today's (or any day's) feedback note for a helper. Same
 *  date = overwrite, so a parent can switch their tap from 😐 to
 *  👍 without spawning a second note. */
export async function setFeedbackNote(
  familyId: string,
  helperUid: string,
  args: {
    sentiment: FeedbackSentiment;
    note?: string;
    byUid: string;
    date?: string;        // YYYY-MM-DD; defaults to today
  },
): Promise<void> {
  if (isGuestActive()) return;
  const date = args.date ?? todayDateString();
  const ref = feedbackDoc(familyId, helperUid, date);
  const existing = await getDoc(ref);
  await setDoc(ref, {
    date,
    sentiment: args.sentiment,
    ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
    createdBy: existing.exists() ? existing.data().createdBy : args.byUid,
    updatedAt: serverTimestamp(),
    updatedBy: args.byUid,
  });
}

/** Remove a feedback note (parent realised they tapped the wrong
 *  one). Idempotent. */
export async function deleteFeedbackNote(
  familyId: string,
  helperUid: string,
  date: string,
): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(feedbackDoc(familyId, helperUid, date));
}

/** Most-recent feedback notes for one helper, newest-first. Cap at
 *  60 to keep payloads bounded; the metric only needs the window. */
export async function listRecentFeedback(
  familyId: string,
  helperUid: string,
  max = 60,
): Promise<HelperFeedbackNote[]> {
  if (isGuestActive()) return [];
  const q = query(feedbackCol(familyId, helperUid), orderBy('date', 'desc'), limit(max));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ ...(d.data() as HelperFeedbackNote) }));
}

/** Feedback note (if any) for a given day — defaults to today. Used by
 *  the quick-toggle strip on /pantry/workplan (today) and its read-only
 *  variant when the day-stepper is pointed at a past day. */
export async function getTodaysFeedback(
  familyId: string,
  helperUid: string,
  date: string = todayDateString(),
): Promise<HelperFeedbackNote | null> {
  if (isGuestActive()) return null;
  const ref = feedbackDoc(familyId, helperUid, date);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as HelperFeedbackNote) : null;
}

// ── Metric calc ──────────────────────────────────────────────────

export interface FeedbackWindow {
  /** 0-100 score, null when no notes in window. Computed as
   *  clamp((positive% − negative%), 0, 100). Neutrals count toward
   *  the denominator but neither raise nor lower the score. */
  scorePct: number | null;
  /** Counts in the window — for the breakdown on PerformanceCard. */
  positive: number;
  neutral: number;
  negative: number;
  /** Total notes in the window. */
  notesCount: number;
}

/** Score across the last `days` days. Reads `listRecentFeedback`
 *  (bounded) then filters in-memory by date — cheap, no extra
 *  composite index. */
export async function getHelperFeedbackMetric(
  familyId: string,
  helperUid: string,
  opts: { days?: number; from?: Date } = {},
): Promise<FeedbackWindow> {
  const days = opts.days ?? 7;
  const from = opts.from ?? new Date();
  const sinceIso = (() => {
    const d = new Date(from);
    d.setDate(d.getDate() - (days - 1));
    return todayDateString(d);
  })();
  const fromIso = todayDateString(from);

  let notes: HelperFeedbackNote[];
  try {
    notes = await listRecentFeedback(familyId, helperUid, 60);
  } catch {
    // Rule denial or transient error → "no data". Don't break the
    // surrounding perf card.
    return { scorePct: null, positive: 0, neutral: 0, negative: 0, notesCount: 0 };
  }
  const inWindow = notes.filter((n) => n.date >= sinceIso && n.date <= fromIso);
  if (inWindow.length === 0) {
    return { scorePct: null, positive: 0, neutral: 0, negative: 0, notesCount: 0 };
  }
  let positive = 0, neutral = 0, negative = 0;
  for (const n of inWindow) {
    if (n.sentiment === 'positive') positive++;
    else if (n.sentiment === 'negative') negative++;
    else neutral++;
  }
  const total = inWindow.length;
  // Per-note contribution: 👍 = +1, 😐 = 0, 👎 = -1.
  // Normalise to [-1, 1] then remap to [0, 100] so the score
  // matches the 0-100 convention every other metric uses.
  //   score = 50 + 50 × (positive − negative) / total
  // Examples:
  //   all 👍       →  50 + 50            = 100
  //   half 👍/👎  →  50 + 0              =  50
  //   75% 👍 25% 👎 (n=4: pos=3 neg=1) → 50 + 50×2/4 = 75
  //   all 👎       →  50 − 50            =   0
  const balance = (positive - negative) / total;
  const scorePct = Math.max(0, Math.min(100, Math.round(50 + 50 * balance)));
  return { scorePct, positive, neutral, negative, notesCount: total };
}

// Re-export the type-only symbols for ergonomic imports.
export type { HelperFeedbackNote, FeedbackSentiment, Timestamp };
