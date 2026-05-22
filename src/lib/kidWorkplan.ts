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
  onSnapshot, serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import type { Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import type { DayOfWeek } from './firestore';
import { todayDayOfWeek, todayDateString } from './workplan';

export { todayDayOfWeek, todayDateString };

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
  kind?: KidTaskKind;            // absent = recurring
  scheduledDates?: string[];     // adhoc only: YYYY-MM-DD list
  note?: string;
  createdAt: Timestamp;
  createdBy: string;             // parent uid
}

export interface KidWorkplanCompletion {
  date: string;                  // YYYY-MM-DD (doc id)
  completedItemIds: string[];
  /** Items whose points have already been granted (server-managed) —
   *  prevents double-award on re-tick. */
  awardedItemIds?: string[];
  eodNote?: string;
  updatedAt: Timestamp;
  updatedBy: string;
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

// ── Scheduling ────────────────────────────────────
/** Items scheduled on `date`: recurring → match weekday; adhoc → date
 *  is in scheduledDates. Inactive items are dropped. */
export function kidItemsScheduledOn(items: KidWorkplanItem[], date: Date = new Date()): KidWorkplanItem[] {
  const dow = todayDayOfWeek(date);
  const dateStr = todayDateString(date);
  return items.filter((i) => {
    if (!i.active) return false;
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

// ── Completions ───────────────────────────────────
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
