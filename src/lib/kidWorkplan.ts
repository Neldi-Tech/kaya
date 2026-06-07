// Kids' Workplan engine. Mirrors the helper Workplan model
// (lib/workplan.ts) but scoped under the CHILD and tuned for kids:
//   • a real clock TIME per item (timeLocal "HH:MM") — "timing is key
//     for kids" (school schedule), so the kid view is a time-ordered
//     timeline, not coarse morning/anytime/evening tiles.
//   • a playful CATEGORY (school / homework / chore / business / play /
//     meal / routine / health) — including PLAY as a first-class
//     plannable item, per Elia.
//   • optional pointsValue per task → awarded server-side on tick
//     (kids can't write awards under the rules, same constraint Pulse
//     solved with /api/pulse/log; here it's /api/workplan/complete).
//
// Data:
//   families/{fid}/children/{childId}/workplanItems/{id}
//   families/{fid}/children/{childId}/workplanCompletions/{YYYY-MM-DD}
//
// Parents author items (recurring weekly, repeatable; plus ad-hoc
// one-offs). Kids tick them off in their My Workplan view.

'use client';

import {
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, serverTimestamp, query, orderBy, deleteField,
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { DayOfWeek, WorkplanPause, WorkplanPauseMode } from './firestore';
import { todayDayOfWeek, todayDateString } from './workplan';

export { todayDayOfWeek, todayDateString };
export type { WorkplanPause, WorkplanPauseMode };

// ── Types ─────────────────────────────────────────
export type KidTaskKind = 'recurring' | 'adhoc';

export type KidTaskCategory =
  | 'school' | 'study' | 'chore' | 'business'
  | 'play' | 'meal' | 'routine' | 'health' | 'other';

export interface KidWorkplanItem {
  id: string;
  label: string;
  icon: string;                  // emoji
  category: KidTaskCategory;
  daysOfWeek: DayOfWeek[];       // recurring: which weekdays repeat
  /** 24h local clock anchor, "HH:MM". Optional — items without a time
   *  fall into the "Anytime" group at the end of the kid's day. */
  timeLocal?: string;
  active: boolean;               // soft on/off
  pointsValue?: number;          // optional reward, server-awarded on tick
  /** Opt-in "proof for points" gate. When true the kid must attach a
   *  NOTE + one media (photo OR video) to earn the task's points — a
   *  plain tick no longer awards. Absent/false = one-tap as before. */
  requiresProof?: boolean;
  kind?: KidTaskKind;            // absent = recurring
  scheduledDates?: string[];     // adhoc only: YYYY-MM-DD list
  note?: string;
  /** Per-task pause (holidays/pause). On covered days this task is simply
   *  not scheduled — never a miss — and auto-resumes after. Set via
   *  setKidItemPause. */
  pause?: WorkplanPause;
  createdAt: Timestamp;
  createdBy: string;             // parent uid
}

/** Why a kid couldn't do their tasks on a given day. A day-level,
 *  parent-visible reason that makes the day "excused" (streak-safe) —
 *  never a silent skip. */
export type ExcuseReason = 'sick' | 'school_trip' | 'public_holiday' | 'other';

/** The fixed set of excuse reasons, with kid-friendly emoji + EN/SW
 *  labels. Single source of truth for the kid picker AND the parent
 *  read-only view, so both render the same wording. */
export const EXCUSE_REASONS: ReadonlyArray<{
  value: ExcuseReason; emoji: string; label: string; labelSw: string;
}> = [
  { value: 'sick',           emoji: '🤒', label: 'Sick',           labelSw: 'Mgonjwa' },
  { value: 'school_trip',    emoji: '🧳', label: 'School trip',    labelSw: 'Safari ya shule' },
  { value: 'public_holiday', emoji: '🎉', label: 'Public holiday', labelSw: 'Sikukuu' },
  { value: 'other',          emoji: '✏️', label: 'Other',          labelSw: 'Nyingine' },
];

/** Look up an excuse reason's display meta (emoji + EN/SW label). */
export function excuseReasonMeta(reason: ExcuseReason | undefined | null) {
  return EXCUSE_REASONS.find((r) => r.value === reason) ?? EXCUSE_REASONS[3];
}

// ── Pause / holidays (PR C) ─────────────────────────────────────────
// One WorkplanPause shape, three scopes (per-task / whole-plan / all-kids).
// A day is paused when from <= day <= (to ?? ∞). Pauses auto-resume after
// `to`; nothing is ever deleted from the plan.

/** Is `dateKey` (YYYY-MM-DD) within this pause window? */
export function isPausedOn(pause: WorkplanPause | null | undefined, dateKey: string): boolean {
  if (!pause || !pause.from) return false;
  if (dateKey < pause.from) return false;       // before it starts
  if (pause.to && dateKey > pause.to) return false; // after it ends (auto-resumed)
  return true;
}

/** True if ANY of the given pauses cover the day (used to OR together the
 *  all-kids + whole-plan scopes for the day-level neutral). */
export function anyPauseOn(pauses: Array<WorkplanPause | null | undefined>, dateKey: string): boolean {
  return pauses.some((p) => isPausedOn(p, dateKey));
}

/** Short, parent-facing status for a pause as of `today`. Returns '' when
 *  there's no pause OR it has already auto-resumed. Dates use DD-Mmm. */
export function pauseStatusLabel(
  pause: WorkplanPause | null | undefined,
  today: string = todayDateString(),
): string {
  if (!pause || !pause.from) return '';
  if (pause.to && today > pause.to) return '';   // already resumed
  const d = (key: string) => {
    const [y, m, day] = key.split('-').map(Number);
    const mon = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][(m || 1) - 1];
    return `${String(day).padStart(2, '0')}-${mon}`;
  };
  if (pause.mode === 'indefinite' || !pause.to) return 'Paused — no end date';
  if (pause.mode === 'range') return `Holiday ${d(pause.from)} → ${d(pause.to)}`;
  return `Paused until ${d(pause.to)}`;
}

export interface KidWorkplanCompletion {
  date: string;                  // YYYY-MM-DD (doc id)
  completedItemIds: string[];
  /** Items whose points have already been granted (server-managed) —
   *  prevents double-award on re-tick. */
  awardedItemIds?: string[];
  eodNote?: string;
  /** Kid's free-text comment per task, captured when they tick it
   *  (itemId → note). Parent-visible; never touches points. */
  itemNotes?: Record<string, string>;
  /** "Couldn't do it today" — a day-level, parent-visible excuse. When
   *  true the day is streak-safe (counted as not-scheduled). */
  excused?: boolean;
  excuseReason?: ExcuseReason;
  excuseNote?: string;           // optional free text (esp. for 'other')
  updatedAt: Timestamp;
  updatedBy: string;
}

// ── Proof for points ──────────────────────────────
// "Show your work": a kid attaches a NOTE + one media (photo OR video)
// to a proof-required task to earn its points. One doc per task per day
// at families/{fid}/children/{childId}/workplanProofs/{date}_{itemId}.
//
// Proof docs are WRITTEN ONLY by the server (Admin SDK) — the kid client
// uploads the media to Storage then calls /api/workplan/proof, which
// writes this doc + awards points. Clients only READ proof docs (their
// own status / the parent review feed). See the security rules.
export type WorkplanProofStatus = 'pending' | 'approved' | 'rejected';
export type WorkplanProofMediaType = 'photo' | 'video';

export interface KidWorkplanProof {
  /** Composite doc id is `${date}_${itemId}`; these two fields mirror it. */
  itemId: string;
  date: string;                       // YYYY-MM-DD
  note: string;                       // the kid's "show your work" note
  mediaUrl: string;                   // Storage download URL
  mediaType: WorkplanProofMediaType;  // photo | video
  status: WorkplanProofStatus;        // pending until a parent decides (approve mode)
  pointsValue: number;                // snapshot of the item's points at submit
  submittedAt: Timestamp;
  reviewedBy?: string;                // parent uid (on approve/reject)
  reviewedAt?: Timestamp;
  reviewNote?: string;                // parent feedback shown to the kid
}

// ── Category catalogue (playful) ──────────────────
// Joy palette from the design proposal. Used for the category chip in
// the parent editor + the accent dot/ring on the kid timeline.
export const KID_CATEGORIES: {
  id: KidTaskCategory; label: string; icon: string; color: string;
}[] = [
  { id: 'school',   label: 'School',   icon: '🏫', color: '#3F7AAF' },
  { id: 'study',    label: 'Homework', icon: '📚', color: '#9B5DE5' },
  { id: 'chore',    label: 'Chore',    icon: '🧹', color: '#4ECDC4' },
  { id: 'business', label: 'Business', icon: '🛒', color: '#D4A847' },
  { id: 'play',     label: 'Play',     icon: '🎮', color: '#FF6B6B' },
  { id: 'meal',     label: 'Meal',     icon: '🍽️', color: '#F39C2F' },
  { id: 'routine',  label: 'Routine',  icon: '🪥', color: '#6BCB77' },
  { id: 'health',   label: 'Health',   icon: '💪', color: '#E36F6F' },
  { id: 'other',    label: 'Other',    icon: '⭐', color: '#5C6975' },
];

export function categoryMeta(id: KidTaskCategory) {
  return KID_CATEGORIES.find((c) => c.id === id) ?? KID_CATEGORIES[KID_CATEGORIES.length - 1];
}

// ── Collection refs ───────────────────────────────
function itemsCol(familyId: string, childId: string) {
  return collection(db, 'families', familyId, 'children', childId, 'workplanItems');
}
function completionsCol(familyId: string, childId: string) {
  return collection(db, 'families', familyId, 'children', childId, 'workplanCompletions');
}
function proofsCol(familyId: string, childId: string) {
  return collection(db, 'families', familyId, 'children', childId, 'workplanProofs');
}

// ── Item CRUD ─────────────────────────────────────
export async function listKidWorkplanItems(familyId: string, childId: string): Promise<KidWorkplanItem[]> {
  const snap = await getDocs(query(itemsCol(familyId, childId), orderBy('createdAt', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as KidWorkplanItem));
}

/** Realtime items for the kid view (a parent edit shows up live). */
export function subscribeKidWorkplanItems(
  familyId: string, childId: string, cb: (items: KidWorkplanItem[]) => void,
): () => void {
  return onSnapshot(
    query(itemsCol(familyId, childId), orderBy('createdAt', 'asc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as KidWorkplanItem))),
    () => cb([]),
  );
}

export async function addKidWorkplanItem(
  familyId: string,
  childId: string,
  input: Omit<KidWorkplanItem, 'id' | 'createdAt'>,
): Promise<string> {
  // Strip undefined fields — Firestore rejects them.
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) clean[k] = v;
  const ref = await addDoc(itemsCol(familyId, childId), { ...clean, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updateKidWorkplanItem(
  familyId: string,
  childId: string,
  itemId: string,
  data: Partial<Omit<KidWorkplanItem, 'id' | 'createdAt' | 'createdBy'>>,
): Promise<void> {
  await updateDoc(doc(itemsCol(familyId, childId), itemId), data);
}

export async function deleteKidWorkplanItem(
  familyId: string,
  childId: string,
  itemId: string,
): Promise<void> {
  await deleteDoc(doc(itemsCol(familyId, childId), itemId));
}

/** Replicate one child's whole plan onto a target child (REPLACE mode):
 *  the target's existing items are deleted, then fresh copies of the
 *  source's items are written (new ids, fields copied, createdBy
 *  re-stamped). Past-dated adhoc one-offs are skipped — copying a
 *  one-off that already happened is noise; recurring items + any adhoc
 *  with a today-or-future date carry over. Used by the editor's
 *  "Copy this plan to…" action so parents set one kid up then mirror. */
export async function replicateKidWorkplan(
  familyId: string,
  sourceChildId: string,
  targetChildId: string,
  createdBy: string,
): Promise<void> {
  if (sourceChildId === targetChildId) return;
  const source = await listKidWorkplanItems(familyId, sourceChildId);
  const todayStr = todayDateString();
  // Clear the target's current plan first (replace, not merge).
  const existing = await getDocs(itemsCol(familyId, targetChildId));
  await Promise.all(existing.docs.map((d) => deleteDoc(d.ref)));
  // Copy each source item with a fresh id. addKidWorkplanItem strips
  // any undefined optional fields before writing.
  for (const it of source) {
    const isAdhoc = (it.kind ?? 'recurring') === 'adhoc';
    const futureDates = (it.scheduledDates ?? []).filter((d) => d >= todayStr);
    if (isAdhoc && futureDates.length === 0) continue; // drop past one-offs
    await addKidWorkplanItem(familyId, targetChildId, {
      label: it.label,
      icon: it.icon,
      category: it.category,
      daysOfWeek: it.daysOfWeek,
      active: it.active,
      createdBy,
      timeLocal: it.timeLocal,
      pointsValue: it.pointsValue,
      requiresProof: it.requiresProof,
      kind: it.kind,
      scheduledDates: isAdhoc ? futureDates : it.scheduledDates,
      note: it.note,
    });
  }
}

// ── Scheduling ────────────────────────────────────
/** Items scheduled on `date`: recurring → match weekday; adhoc → date
 *  is in scheduledDates. Inactive items are dropped. */
export function kidItemsScheduledOn(items: KidWorkplanItem[], date: Date = new Date()): KidWorkplanItem[] {
  const dow = todayDayOfWeek(date);
  const dateStr = todayDateString(date);
  return items.filter((i) => {
    if (!i.active) return false;
    // Per-task pause: not scheduled on covered days (never a miss; auto-resumes).
    if (isPausedOn(i.pause, dateStr)) return false;
    if ((i.kind ?? 'recurring') === 'adhoc') return (i.scheduledDates ?? []).includes(dateStr);
    return i.daysOfWeek.includes(dow);
  });
}

/** Chronological order for the kid timeline: timed items first (by
 *  clock), untimed ("anytime") last. Stable within each bucket. */
export function sortKidItemsByTime(items: KidWorkplanItem[]): KidWorkplanItem[] {
  return [...items].sort((a, b) => {
    const at = a.timeLocal, bt = b.timeLocal;
    if (at && bt) return at.localeCompare(bt);
    if (at && !bt) return -1;
    if (!at && bt) return 1;
    return 0;
  });
}

/** Split scheduled items into timed vs anytime, both already sorted. */
export function partitionKidByTime(scheduled: KidWorkplanItem[]): {
  timed: KidWorkplanItem[]; anytime: KidWorkplanItem[];
} {
  const sorted = sortKidItemsByTime(scheduled);
  return {
    timed: sorted.filter((i) => !!i.timeLocal),
    anytime: sorted.filter((i) => !i.timeLocal),
  };
}

/** Format "HH:MM" → "7:00 AM" for display. Falls back to the raw
 *  string if it isn't parseable. */
export function formatTimeLocal(t?: string): string {
  if (!t) return '';
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return t;
  let h = parseInt(m[1], 10);
  const min = m[2];
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${min} ${ampm}`;
}

export function dailyKidPct(scheduled: KidWorkplanItem[], completion: KidWorkplanCompletion | null): number {
  if (scheduled.length === 0) return 100;
  const done = completion?.completedItemIds ?? [];
  const hit = scheduled.filter((i) => done.includes(i.id)).length;
  return Math.round((hit / scheduled.length) * 100);
}

// ── Accomplishment (gamified profile view) ────────
export interface KidDayResult {
  date: string;        // YYYY-MM-DD
  dow: DayOfWeek;
  scheduled: number;
  done: number;
  pct: number;
  points: number;      // points earned that day (from completed items)
  isActive: boolean;   // had ≥1 scheduled task AND not excused/paused
  excused: boolean;    // kid marked "couldn't do it today" (streak-safe)
  excuseReason?: ExcuseReason;  // why (for the parent strip), when excused
  paused: boolean;     // whole-plan / all-kids pause covered this day (streak-safe)
}

export interface KidAccomplishment {
  days: KidDayResult[];  // chronological, oldest → newest (length = window)
  windowPct: number;     // avg pct over active days in the window
  streak: number;        // consecutive all-done days ending at the most recent
  totalDone: number;     // tasks ticked across the window
  totalPoints: number;   // points earned across the window
  activeDays: number;    // days with ≥1 scheduled task
  perfectDays: number;   // days that hit 100%
}

/** Step a date back `n` days, preserving local time. */
function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Build the per-day accomplishment over the last `days` (ending at
 *  `ref`, default today). NOTE: scheduling uses the CURRENT items, so a
 *  day's "scheduled" reflects today's plan — fine for a gamified glance,
 *  not an audit. Completions are historical + accurate. */
export function computeKidAccomplishment(
  items: KidWorkplanItem[],
  completions: KidWorkplanCompletion[],
  days = 7,
  ref: Date = new Date(),
  /** Whole-plan + all-kids pauses (Child.workplanPause, Family.workplanPause).
   *  A day any of these cover is neutral — streak-safe. Per-task pauses are
   *  already handled inside kidItemsScheduledOn. */
  planPauses: Array<WorkplanPause | null | undefined> = [],
): KidAccomplishment {
  const byDate = new Map(completions.map((c) => [c.date, c]));
  const out: KidDayResult[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(ref, -i);
    const dateStr = todayDateString(d);
    const scheduled = kidItemsScheduledOn(items, d);
    const comp = byDate.get(dateStr) ?? null;
    const excused = !!comp?.excused;
    const paused = anyPauseOn(planPauses, dateStr);
    const doneIds = new Set(comp?.completedItemIds ?? []);
    const doneItems = scheduled.filter((it) => doneIds.has(it.id));
    const pct = scheduled.length ? Math.round((doneItems.length / scheduled.length) * 100) : 100;
    out.push({
      date: dateStr,
      dow: todayDayOfWeek(d),
      scheduled: scheduled.length,
      done: doneItems.length,
      pct,
      points: doneItems.reduce((s, it) => s + (it.pointsValue ?? 0), 0),
      // An excused OR paused day is neutral — like a no-tasks day, it neither
      // counts toward nor breaks the streak/percentage.
      isActive: scheduled.length > 0 && !excused && !paused,
      excused,
      excuseReason: comp?.excuseReason,
      paused,
    });
  }

  const active = out.filter((d) => d.isActive);
  const windowPct = active.length ? Math.round(active.reduce((s, d) => s + d.pct, 0) / active.length) : 0;

  // Streak — walk newest → oldest; skip inactive days (neutral), count
  // perfect days, stop at the first active day that wasn't 100%.
  let streak = 0;
  for (let i = out.length - 1; i >= 0; i--) {
    const d = out[i];
    if (!d.isActive) continue;
    if (d.pct === 100) streak++;
    else break;
  }

  return {
    days: out,
    windowPct,
    streak,
    totalDone: out.reduce((s, d) => s + d.done, 0),
    totalPoints: out.reduce((s, d) => s + d.points, 0),
    activeDays: active.length,
    perfectDays: out.filter((d) => d.isActive && d.pct === 100).length,
  };
}

// ── Completions ───────────────────────────────────
/** All completion docs for a child (doc id = YYYY-MM-DD). Small —
 *  one per active day — so a single read powers the profile
 *  accomplishment view + the previous-days history. */
export async function listKidCompletions(familyId: string, childId: string): Promise<KidWorkplanCompletion[]> {
  const snap = await getDocs(completionsCol(familyId, childId));
  return snap.docs.map((d) => ({ date: d.id, ...d.data() } as KidWorkplanCompletion));
}

export async function getKidCompletion(
  familyId: string, childId: string, date: string = todayDateString(),
): Promise<KidWorkplanCompletion | null> {
  const snap = await getDoc(doc(completionsCol(familyId, childId), date));
  if (!snap.exists()) return null;
  return { date: snap.id, ...snap.data() } as KidWorkplanCompletion;
}

/** Realtime completion for a given day (drives the kid's live ticks). */
export function subscribeKidCompletion(
  familyId: string, childId: string, date: string, cb: (c: KidWorkplanCompletion | null) => void,
): () => void {
  return onSnapshot(
    doc(completionsCol(familyId, childId), date),
    (snap) => cb(snap.exists() ? ({ date: snap.id, ...snap.data() } as KidWorkplanCompletion) : null),
    () => cb(null),
  );
}

export interface CompleteKidTaskResult {
  ok: boolean;
  completed: boolean;     // new state of this item
  pointsAwarded?: number; // points granted on this call (0 if none / already)
  error?: string;
}

/** Toggle a kid task's completion for `date` via the server (Admin SDK)
 *  so optional points can be awarded — kids can't write awards under the
 *  rules. Idempotent on points (awardedItemIds guards re-tick). */
export async function completeKidTask(input: {
  familyId: string; childId: string; itemId: string; date: string; on: boolean;
}): Promise<CompleteKidTaskResult> {
  try {
    const res = await fetch('/api/workplan/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, completed: input.on, error: json?.error ?? 'request-failed' };
    return { ok: true, completed: !!json.completed, pointsAwarded: json.pointsAwarded ?? 0 };
  } catch {
    return { ok: false, completed: input.on, error: 'network' };
  }
}

/** Save the kid's free-text end-of-day note. Lazily creates the doc.
 *  Writes client-side (kid can write their own completion doc per the
 *  rules); points never flow through here. */
export async function setKidEodNote(
  familyId: string, childId: string, note: string, by: string, date: string = todayDateString(),
): Promise<void> {
  const ref = doc(completionsCol(familyId, childId), date);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, { eodNote: note, updatedAt: serverTimestamp(), updatedBy: by });
  } else {
    await setDoc(ref, { completedItemIds: [], eodNote: note, updatedAt: serverTimestamp(), updatedBy: by });
  }
}

/** Save (or clear) the kid's per-task comment, captured when they tick a
 *  task. Writes client-side to a nested `itemNotes.<itemId>` field so it
 *  never collides with the server's points write on the same doc (both
 *  field-merge). An empty note removes the entry. */
export async function setKidItemNote(
  familyId: string, childId: string, itemId: string, note: string, by: string,
  date: string = todayDateString(),
): Promise<void> {
  const ref = doc(completionsCol(familyId, childId), date);
  const snap = await getDoc(ref);
  const trimmed = note.trim();
  if (snap.exists()) {
    await updateDoc(ref, {
      [`itemNotes.${itemId}`]: trimmed ? trimmed : deleteField(),
      updatedAt: serverTimestamp(), updatedBy: by,
    });
  } else if (trimmed) {
    await setDoc(ref, {
      completedItemIds: [], itemNotes: { [itemId]: trimmed },
      updatedAt: serverTimestamp(), updatedBy: by,
    });
  }
}

/** Mark (or clear) a day as "couldn't do it today" with a reason. An
 *  excused day is streak-safe (treated as not-scheduled). Pass `null` to
 *  un-excuse. Client-side write to the kid's own completion doc. */
export async function setKidDayExcuse(
  familyId: string, childId: string,
  excuse: { reason: ExcuseReason; note?: string } | null,
  by: string, date: string = todayDateString(),
): Promise<void> {
  const ref = doc(completionsCol(familyId, childId), date);
  const snap = await getDoc(ref);
  if (excuse === null) {
    if (snap.exists()) {
      await updateDoc(ref, {
        excused: deleteField(), excuseReason: deleteField(), excuseNote: deleteField(),
        updatedAt: serverTimestamp(), updatedBy: by,
      });
    }
    return;
  }
  const note = excuse.note?.trim();
  if (snap.exists()) {
    // update — deleteField() is valid here to clear a stale note.
    await updateDoc(ref, {
      excused: true,
      excuseReason: excuse.reason,
      excuseNote: note ? note : deleteField(),
      updatedAt: serverTimestamp(),
      updatedBy: by,
    });
  } else {
    // create — build a clean doc (no deleteField sentinels in a plain set).
    const fresh: Record<string, unknown> = {
      completedItemIds: [],
      excused: true,
      excuseReason: excuse.reason,
      updatedAt: serverTimestamp(),
      updatedBy: by,
    };
    if (note) fresh.excuseNote = note;
    await setDoc(ref, fresh);
  }
}

// ── Pause writes (PR C) ─────────────────────────────────────────────
// Parent-only in practice (gated by the calling UI + Firestore rules on
// the item/child/family docs). Each stamps setBy + setAt; passing null
// clears the pause (auto-resume / cancel). No deleting of tasks ever.

/** What the UI supplies for a pause — the helper stamps setBy + setAt. */
export type PauseInput = Pick<WorkplanPause, 'mode' | 'from' | 'to' | 'note'>;

function buildPauseDoc(input: PauseInput, by: string): Record<string, unknown> {
  const out: Record<string, unknown> = {
    mode: input.mode,
    from: input.from,
    setBy: by,
    setAt: serverTimestamp(),
  };
  if (input.to) out.to = input.to;
  if (input.note?.trim()) out.note = input.note.trim();
  return out;
}

/** Per-task pause (or clear with null). */
export async function setKidItemPause(
  familyId: string, childId: string, itemId: string, pause: PauseInput | null, by: string,
): Promise<void> {
  await updateDoc(
    doc(itemsCol(familyId, childId), itemId),
    pause ? { pause: buildPauseDoc(pause, by) } : { pause: deleteField() },
  );
}

/** Whole-plan pause for one kid (or clear). */
export async function setChildWorkplanPause(
  familyId: string, childId: string, pause: PauseInput | null, by: string,
): Promise<void> {
  await updateDoc(
    doc(db, 'families', familyId, 'children', childId),
    pause ? { workplanPause: buildPauseDoc(pause, by) } : { workplanPause: deleteField() },
  );
}

/** All-kids pause for the whole family (or clear). */
export async function setFamilyWorkplanPause(
  familyId: string, pause: PauseInput | null, by: string,
): Promise<void> {
  await updateDoc(
    doc(db, 'families', familyId),
    pause ? { workplanPause: buildPauseDoc(pause, by) } : { workplanPause: deleteField() },
  );
}

// ── Proof for points: read + submit/review helpers ─
/** Realtime proofs for one child (doc id = `${date}_${itemId}`). Drives
 *  both the kid's own per-task status badge and — fanned out over the
 *  family's children — the parent review feed. Read-only: proof docs are
 *  written server-side only. Ordered by submittedAt so the parent feed
 *  shows newest-first; a missing/old doc just sorts last. */
export function subscribeKidWorkplanProofs(
  familyId: string, childId: string, cb: (proofs: KidWorkplanProof[]) => void,
): () => void {
  return onSnapshot(
    query(proofsCol(familyId, childId), orderBy('submittedAt', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ ...d.data() } as KidWorkplanProof))),
    () => cb([]),
  );
}

export interface SubmitProofResult {
  ok: boolean;
  status?: WorkplanProofStatus;
  pointsAwarded?: number;
  error?: string;
}

/** Submit a kid's proof for a task via the server (Admin SDK) — the kid
 *  can't write the proof doc or awards under the rules. The caller has
 *  already uploaded the media to Storage (uploadWorkplanProofMedia) and
 *  passes its download URL + type. In 'instant' mode the server awards
 *  immediately; in 'approve' mode the proof lands pending. */
export async function submitKidWorkplanProof(input: {
  familyId: string; childId: string; itemId: string; date: string;
  note: string; mediaUrl: string; mediaType: WorkplanProofMediaType;
}): Promise<SubmitProofResult> {
  try {
    const res = await fetch('/api/workplan/proof', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json?.error ?? 'request-failed' };
    return { ok: true, status: json.status, pointsAwarded: json.pointsAwarded ?? 0 };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface ReviewProofResult { ok: boolean; error?: string }

/** Parent approves/rejects a kid's proof via the server (Admin SDK).
 *  Both decisions carry a parent note shown to the kid. Approve awards
 *  points (if any, idempotent); reject in 'instant' mode claws back any
 *  points already granted. Parents can't write awards under the rules —
 *  hence the server hop. */
export async function reviewKidWorkplanProof(input: {
  familyId: string; childId: string; itemId: string; date: string;
  decision: 'approve' | 'reject'; note: string; reviewerUid: string;
}): Promise<ReviewProofResult> {
  try {
    const res = await fetch('/api/workplan/proof/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok) return { ok: false, error: json?.error ?? 'request-failed' };
    return { ok: true };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// ── Starter template (easy parent setup) ──────────
// A repeatable school-day plan with real times — one tap seeds a
// sensible week the parent can then tweak. "Make it easy for parents."
const WEEKDAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
const EVERYDAY: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export const KID_SCHOOL_STARTER: Omit<KidWorkplanItem, 'id' | 'createdAt' | 'createdBy'>[] = [
  { label: 'Wake up & brush teeth', icon: '🪥', category: 'routine',  daysOfWeek: EVERYDAY, timeLocal: '06:30', active: true },
  { label: 'Breakfast',             icon: '🥣', category: 'meal',     daysOfWeek: EVERYDAY, timeLocal: '07:00', active: true },
  { label: 'School',                icon: '🏫', category: 'school',   daysOfWeek: WEEKDAYS, timeLocal: '07:45', active: true },
  { label: 'Homework',              icon: '📚', category: 'study',    daysOfWeek: WEEKDAYS, timeLocal: '15:30', active: true, pointsValue: 5 },
  { label: 'Play time',             icon: '🎮', category: 'play',     daysOfWeek: EVERYDAY, timeLocal: '16:30', active: true },
  { label: 'Help tidy up',          icon: '🧹', category: 'chore',    daysOfWeek: EVERYDAY, timeLocal: '18:00', active: true, pointsValue: 3 },
  { label: 'Dinner',                icon: '🍽️', category: 'meal',     daysOfWeek: EVERYDAY, timeLocal: '19:00', active: true },
  { label: 'Read 20 minutes',       icon: '📖', category: 'study',    daysOfWeek: EVERYDAY, timeLocal: '20:00', active: true, pointsValue: 2 },
  { label: 'Bedtime',               icon: '🌙', category: 'routine',  daysOfWeek: EVERYDAY, timeLocal: '20:30', active: true },
];

export const KID_DAY_LABELS: { id: DayOfWeek; short: string }[] = [
  { id: 'mon', short: 'M' }, { id: 'tue', short: 'T' }, { id: 'wed', short: 'W' },
  { id: 'thu', short: 'Th' }, { id: 'fri', short: 'F' }, { id: 'sat', short: 'Sa' }, { id: 'sun', short: 'Su' },
];
