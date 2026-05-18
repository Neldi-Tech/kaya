// Helper Workplan operations. Pairs with WorkplanItem +
// WorkplanCompletion in `lib/firestore.ts`.
//
// Items are recurring definitions written by the parent.
// Completions are per-day docs written by the helper (with parent
// fallback for corrections).
//
// Today's view: filter active items whose `daysOfWeek` includes
// today's weekday → render as a checklist. Tapping a tile flips
// presence in `completedItemIds` on the day's completion doc.

'use client';

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  WorkplanItem, WorkplanCompletion, DayOfWeek, WorkplanPeriod,
} from './firestore';

const DAYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Today's day-of-week key, in the user's local timezone. The
 *  helper's "today" matches their phone's clock — not UTC. */
export function todayDayOfWeek(d: Date = new Date()): DayOfWeek {
  return DAYS[d.getDay()];
}

/** YYYY-MM-DD for today in local time. Used as the doc id on the
 *  per-day WorkplanCompletion. */
export function todayDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── WorkplanItem CRUD ─────────────────────────────
function itemsCol(familyId: string, helperUid: string) {
  return collection(db, 'families', familyId, 'helpers', helperUid, 'workplanItems');
}

export async function listWorkplanItems(familyId: string, helperUid: string): Promise<WorkplanItem[]> {
  // Order by createdAt so newly-added items show at the bottom of
  // the parent's list (intuitive add-at-end UX).
  const snap = await getDocs(query(itemsCol(familyId, helperUid), orderBy('createdAt', 'asc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkplanItem));
}

export async function addWorkplanItem(
  familyId: string,
  helperUid: string,
  input: Omit<WorkplanItem, 'id' | 'createdAt'>,
): Promise<string> {
  const ref = await addDoc(itemsCol(familyId, helperUid), {
    ...input,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Convenience writer for ad-hoc one-off tasks (v4-final §04 Step 7).
 *  Sets `kind: 'adhoc'`, empty `daysOfWeek`, and stamps `assignedAt`
 *  on the server. Callers only need to know about the user-meaningful
 *  fields (who, what, when, period, optional note). */
export async function addAdhocWorkplanItem(
  familyId: string,
  helperUid: string,
  input: {
    label: string;
    icon: string;
    period: WorkplanPeriod;
    scheduledDates: string[];   // YYYY-MM-DD list (1+)
    assignedBy: string;         // parent UID
    note?: string;
  },
): Promise<string> {
  if (input.scheduledDates.length === 0) {
    throw new Error('addAdhocWorkplanItem requires at least one scheduledDate');
  }
  const ref = await addDoc(itemsCol(familyId, helperUid), {
    label: input.label,
    icon: input.icon,
    daysOfWeek: [],
    period: input.period,
    active: true,
    kind: 'adhoc',
    scheduledDates: input.scheduledDates,
    createdBy: input.assignedBy,
    assignedBy: input.assignedBy,
    createdAt: serverTimestamp(),
    assignedAt: serverTimestamp(),
    ...(input.note ? { note: input.note } : {}),
  });
  return ref.id;
}

export async function updateWorkplanItem(
  familyId: string,
  helperUid: string,
  itemId: string,
  data: Partial<Omit<WorkplanItem, 'id' | 'createdAt' | 'createdBy'>>,
): Promise<void> {
  await updateDoc(doc(itemsCol(familyId, helperUid), itemId), data);
}

export async function deleteWorkplanItem(
  familyId: string,
  helperUid: string,
  itemId: string,
): Promise<void> {
  await deleteDoc(doc(itemsCol(familyId, helperUid), itemId));
}

// ── Today's view ──────────────────────────────────
/** Filter the helper's items down to the ones scheduled for `date`.
 *  v4-final §04 Step 7: handles both flavours —
 *    • recurring (default for legacy docs without `kind`) — match by
 *      `daysOfWeek` against `date`'s weekday.
 *    • adhoc — match by `scheduledDates` containing `date`'s ISO string.
 *  Items without a matching schedule are omitted so the helper sees
 *  only what's expected today (recurring + assigned one-offs). */
export function itemsScheduledOn(items: WorkplanItem[], date: Date = new Date()): WorkplanItem[] {
  const dow = todayDayOfWeek(date);
  const dateStr = todayDateString(date);
  return items.filter((i) => {
    if (!i.active) return false;
    const kind = i.kind ?? 'recurring';
    if (kind === 'adhoc') {
      return (i.scheduledDates ?? []).includes(dateStr);
    }
    return i.daysOfWeek.includes(dow);
  });
}

/** Partition a list of items into adhoc + recurring buckets. Useful
 *  for surfaces that want to render ad-hoc separately (helper home
 *  shows them in a honey "Ad-hoc" strip at the top). */
export function partitionByKind(items: WorkplanItem[]): { adhoc: WorkplanItem[]; recurring: WorkplanItem[] } {
  const adhoc: WorkplanItem[] = [];
  const recurring: WorkplanItem[] = [];
  for (const i of items) ((i.kind ?? 'recurring') === 'adhoc' ? adhoc : recurring).push(i);
  return { adhoc, recurring };
}

/** Group items by their `period` (morning / anytime / evening) so the
 *  helper view can render the day in chronological chunks. */
export function groupItemsByPeriod(items: WorkplanItem[]): Record<WorkplanPeriod, WorkplanItem[]> {
  const out: Record<WorkplanPeriod, WorkplanItem[]> = { morning: [], anytime: [], evening: [] };
  for (const i of items) out[i.period].push(i);
  return out;
}

/** Active ad-hoc items whose first scheduled date is in the future
 *  (or today). Used by the parent WorkplanEditor to show a small
 *  "Upcoming one-offs" list separate from the recurring matrix. */
export function upcomingAdhoc(items: WorkplanItem[], from: Date = new Date()): WorkplanItem[] {
  const todayStr = todayDateString(from);
  return items
    .filter((i) => i.active && (i.kind ?? 'recurring') === 'adhoc')
    .filter((i) => (i.scheduledDates ?? []).some((d) => d >= todayStr));
}

// ── Completions ───────────────────────────────────
function completionsCol(familyId: string, helperUid: string) {
  return collection(db, 'families', familyId, 'helpers', helperUid, 'workplanCompletions');
}

export async function getCompletion(
  familyId: string,
  helperUid: string,
  date: string = todayDateString(),
): Promise<WorkplanCompletion | null> {
  const snap = await getDoc(doc(completionsCol(familyId, helperUid), date));
  if (!snap.exists()) return null;
  return { date: snap.id, ...snap.data() } as WorkplanCompletion;
}

/** Toggle an item's presence in today's completion. Lazily creates
 *  the per-day doc the first time the helper checks anything off.
 *  `updatedBy` is the caller's UID — typically the helper. */
export async function toggleItemCompletion(
  familyId: string,
  helperUid: string,
  itemId: string,
  by: string,
  date: string = todayDateString(),
): Promise<void> {
  const ref = doc(completionsCol(familyId, helperUid), date);
  const snap = await getDoc(ref);
  const current = snap.exists()
    ? ((snap.data().completedItemIds as string[] | undefined) ?? [])
    : [];
  const next = current.includes(itemId)
    ? current.filter((i) => i !== itemId)
    : [...current, itemId];
  if (snap.exists()) {
    await updateDoc(ref, {
      completedItemIds: next,
      updatedAt: serverTimestamp(),
      updatedBy: by,
    });
  } else {
    await setDoc(ref, {
      completedItemIds: next,
      updatedAt: serverTimestamp(),
      updatedBy: by,
    });
  }
}

/** Save the helper's free-text EoD note for `date`. Empty string
 *  clears the note. Lazily creates the per-day doc if needed. */
export async function setEodNote(
  familyId: string,
  helperUid: string,
  note: string,
  by: string,
  date: string = todayDateString(),
): Promise<void> {
  const ref = doc(completionsCol(familyId, helperUid), date);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    await updateDoc(ref, {
      eodNote: note,
      updatedAt: serverTimestamp(),
      updatedBy: by,
    });
  } else {
    await setDoc(ref, {
      completedItemIds: [],
      eodNote: note,
      updatedAt: serverTimestamp(),
      updatedBy: by,
    });
  }
}

// ── Performance helpers ───────────────────────────
/** Quick % completion for a given day — used by the dashboard and
 *  (later) by the consolidated performance % calc. Returns 100 when
 *  no items are scheduled (vacuous-truth) so the helper isn't
 *  penalised for days off. */
export function dailyCompletionPct(
  scheduled: WorkplanItem[],
  completion: WorkplanCompletion | null,
): number {
  if (scheduled.length === 0) return 100;
  const done = completion?.completedItemIds ?? [];
  const hit = scheduled.filter((i) => done.includes(i.id)).length;
  return Math.round((hit / scheduled.length) * 100);
}

// ── Default seed ──────────────────────────────────
/** Sensible starter workplan for a brand-new Nanny helper. Parents
 *  edit/extend from Settings → Helpers → Workplan. Items are added
 *  one-shot the first time a parent opens the workplan editor for
 *  a helper with no items yet. */
export const NANNY_STARTER_ITEMS: Omit<WorkplanItem, 'id' | 'createdAt' | 'createdBy'>[] = [
  { label: 'Open curtains',     icon: '🌅', daysOfWeek: ['mon','tue','wed','thu','fri','sat','sun'], period: 'morning', active: true },
  { label: 'Make beds',         icon: '🛏️', daysOfWeek: ['mon','tue','wed','thu','fri','sat'],       period: 'morning', active: true },
  { label: 'Breakfast prep',    icon: '🥣', daysOfWeek: ['mon','tue','wed','thu','fri','sat','sun'], period: 'morning', active: true },
  { label: 'Tidy living room',  icon: '🛋️', daysOfWeek: ['mon','tue','wed','thu','fri'],             period: 'anytime', active: true },
  { label: 'Laundry',           icon: '🧺', daysOfWeek: ['tue','thu','sat'],                          period: 'anytime', active: true },
  { label: 'Dinner prep',       icon: '🍽️', daysOfWeek: ['mon','tue','wed','thu','fri','sat','sun'], period: 'evening', active: true },
  { label: 'Kitchen clean-up',  icon: '🧽', daysOfWeek: ['mon','tue','wed','thu','fri','sat','sun'], period: 'evening', active: true },
  { label: 'Trash out',         icon: '🗑️', daysOfWeek: ['wed','sun'],                                period: 'evening', active: true },
];
