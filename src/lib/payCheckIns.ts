// Pay check-ins for hourly + daily helpers (v1 — 2026-05-19).
//
// Helper taps "Log today" on /helper → writes the day's doc with
// hours + helperLoggedAt. Parent reviews the unapproved-checkins
// strip on /pantry/workplan and approves (one tap per row or batch).
// The payroll generator only counts APPROVED check-ins when summing
// the basic-pay line.
//
// Path: /families/{f}/helpers/{uid}/payCheckIns/{YYYY-MM-DD}
// (One doc per day — re-tapping "Log today" updates the hours
// in-place and clears any prior approval so the parent re-checks.)

'use client';

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, updateDoc,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { PayCheckIn } from './firestore';
import { todayDateString } from './workplan';

const col = (familyId: string, helperUid: string) =>
  collection(db, 'families', familyId, 'helpers', helperUid, 'payCheckIns');

const docRef = (familyId: string, helperUid: string, date: string) =>
  doc(db, 'families', familyId, 'helpers', helperUid, 'payCheckIns', date);

/** Helper logs (or re-logs) their hours/day for a given date. If
 *  the doc already exists + was previously approved, the prior
 *  approval is cleared so the parent re-reviews the new hours.
 *  Defaults to today. */
export async function logCheckIn(
  familyId: string,
  helperUid: string,
  args: { hours: number; note?: string; date?: string },
): Promise<void> {
  if (isGuestActive()) return;
  const date = args.date ?? todayDateString();
  const ref = docRef(familyId, helperUid, date);
  const existing = await getDoc(ref);
  const wasApproved = existing.exists() && !!existing.data().approvedBy;
  const hoursChanged = existing.exists() && existing.data().hours !== args.hours;
  await setDoc(ref, {
    date,
    hours: Math.max(0, args.hours),
    helperLoggedAt: existing.exists() ? existing.data().helperLoggedAt : serverTimestamp(),
    ...(args.note?.trim() ? { note: args.note.trim() } : {}),
    // Clear approval if hours changed (parent should re-confirm).
    ...(wasApproved && hoursChanged ? { approvedBy: null, approvedAt: null } : {}),
    updatedAt: serverTimestamp(),
    updatedBy: helperUid,
  }, { merge: true });
}

/** Parent approves a single check-in (today or backdated). */
export async function approveCheckIn(
  familyId: string,
  helperUid: string,
  date: string,
  byUid: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(docRef(familyId, helperUid, date), {
    approvedBy: byUid,
    approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: byUid,
  });
}

/** Parent approves every unapproved check-in in one call — used by
 *  the batch-approve button on /pantry/workplan. Fail-soft per row;
 *  partial successes don't block the rest. */
export async function approveAllPending(
  familyId: string,
  helperUid: string,
  byUid: string,
): Promise<{ approved: number; failed: number }> {
  if (isGuestActive()) return { approved: 0, failed: 0 };
  const pending = await listPendingCheckIns(familyId, helperUid);
  let approved = 0, failed = 0;
  for (const c of pending) {
    try {
      await approveCheckIn(familyId, helperUid, c.date, byUid);
      approved++;
    } catch { failed++; }
  }
  return { approved, failed };
}

/** Remove a check-in (helper changed their mind, parent reverting). */
export async function deleteCheckIn(
  familyId: string,
  helperUid: string,
  date: string,
): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(docRef(familyId, helperUid, date));
}

/** Today's check-in for this helper (if any) — drives the
 *  "Already logged: 8h" state on the helper home toggle. */
export async function getTodaysCheckIn(
  familyId: string,
  helperUid: string,
): Promise<PayCheckIn | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(docRef(familyId, helperUid, todayDateString()));
  return snap.exists() ? (snap.data() as PayCheckIn) : null;
}

/** Unapproved check-ins, newest-first. Used by the parent strip on
 *  /pantry/workplan to surface "Jacky has 3 days waiting for nod". */
export async function listPendingCheckIns(
  familyId: string,
  helperUid: string,
): Promise<PayCheckIn[]> {
  if (isGuestActive()) return [];
  const q = query(
    col(familyId, helperUid),
    where('approvedBy', '==', null),
    orderBy('date', 'desc'),
    limit(60),
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as PayCheckIn);
  } catch {
    // Composite index might not be in place for (approvedBy + date)
    // — degrade to "fetch recent, filter in memory".
    const fallbackQ = query(col(familyId, helperUid), orderBy('date', 'desc'), limit(60));
    const snap = await getDocs(fallbackQ);
    return snap.docs.map((d) => d.data() as PayCheckIn).filter((c) => !c.approvedBy);
  }
}

/** Approved check-ins in [sinceIso, untilIso] (both YYYY-MM-DD,
 *  inclusive). Generator uses this to sum basic pay for hourly +
 *  daily helpers. */
export async function listApprovedCheckIns(
  familyId: string,
  helperUid: string,
  sinceIso: string,
  untilIso: string,
): Promise<PayCheckIn[]> {
  if (isGuestActive()) return [];
  // Pull recent (bounded), filter in memory by date range — cheaper
  // than a composite index for short windows.
  const q = query(col(familyId, helperUid), orderBy('date', 'desc'), limit(200));
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => d.data() as PayCheckIn)
    .filter((c) => !!c.approvedBy && c.date >= sinceIso && c.date <= untilIso);
}

/** Sum approved hours in a window. Convenience for the generator. */
export function sumApprovedHours(checkIns: PayCheckIn[]): number {
  return checkIns.reduce((acc, c) => acc + (c.hours ?? 0), 0);
}

/** Count distinct approved days in a window (for daily basis,
 *  multiple check-ins on the same date are counted as one day). */
export function countApprovedDays(checkIns: PayCheckIn[]): number {
  const days = new Set<string>();
  for (const c of checkIns) days.add(c.date);
  return days.size;
}
