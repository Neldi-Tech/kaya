// Family Time Capsule — Sunday-Meeting v2 (b7).
//
// At the end of each meeting, one person can write a single line — a
// hope, a quote, a tiny prediction. Kaya seals it for N years (default
// 1) and surfaces it on the meeting *closest* to the anniversary date.
//
// The "nearest scheduled meeting within ±3 days" snap (per Elia's
// tweak) handles the case where the +1y anniversary doesn't land on
// the family's meeting day:
//   - If meeting day-of-week is set (Family.meetingSetup.schedule.dayOfWeek):
//     find the closest YYYY-MM-DD with that DOW within ±3 days of
//     the anniversary. Prefer the candidate >= the anniversary; if
//     none, fall back to the closest before it.
//   - If no schedule, use the anniversary date verbatim.
//
// Storage: subcollection `families/{familyId}/familyCapsules/{id}`.
// Sealed capsules sit there until the meeting opener's check function
// (`listDueCapsules`) surfaces them within a ±3 day reveal window.

import {
  collection, doc, getDocs, addDoc, updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export type CapsuleStatus = 'sealed' | 'opened' | 'reflected';

export interface FamilyCapsule {
  id: string;
  text: string;
  writtenByUid: string;
  writtenByName: string;
  writtenByEmoji?: string;
  writtenAt: number;        // epoch ms
  /** YYYY-MM-DD — target reveal date (snapped to nearest scheduled
   *  meeting within ±3 days of writtenAt + lockYears). */
  openOn: string;
  lockYears: number;
  status: CapsuleStatus;
  /** Reflection on the day of opening — did the wish come true? */
  cameTrue?: boolean;
}

const COL = 'familyCapsules';

/** Local-time YYYY-MM-DD. Mirrors the project's date-display rule —
 *  helpers can be in other TZs but the meeting is a local-day event. */
function isoLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Compute the openOn date for a capsule sealed now (or at `from`).
 *  Snaps to the nearest scheduled-meeting day within ±3 days of the
 *  raw anniversary. Pure, testable, no Firestore access. */
export function computeOpenOn(opts: {
  from: Date;
  lockYears: number;
  scheduleDayOfWeek?: number;     // 0=Sun…6=Sat
  snapWindowDays?: number;        // default 3
}): string {
  const window = opts.snapWindowDays ?? 3;
  // Add `lockYears` to the from-date. JS Date handles fractional years
  // (0.5 → +6 months) cleanly via getTime() arithmetic with 365.25.
  const ms = opts.from.getTime() + opts.lockYears * 365.25 * 24 * 60 * 60 * 1000;
  const anniversary = new Date(ms);
  if (typeof opts.scheduleDayOfWeek !== 'number') {
    return isoLocal(anniversary);
  }
  // Search for a candidate matching scheduleDayOfWeek within ±window
  // days, preferring forward (>= anniversary).
  for (let delta = 0; delta <= window; delta++) {
    for (const sign of [+1, -1]) {
      if (delta === 0 && sign === -1) continue;   // skip dup
      const c = new Date(anniversary);
      c.setDate(c.getDate() + delta * sign);
      if (c.getDay() === opts.scheduleDayOfWeek) {
        return isoLocal(c);
      }
    }
  }
  // No scheduled-day inside the window — fall back to the anniversary
  // itself so the capsule isn't silently dropped. The presenter check
  // still respects the ±window guard at reveal time.
  return isoLocal(anniversary);
}

export async function listFamilyCapsules(familyId: string): Promise<FamilyCapsule[]> {
  const snap = await getDocs(collection(db, 'families', familyId, COL));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FamilyCapsule, 'id'>) }));
}

/** Capsules within the ±window reveal range of today AND still sealed.
 *  Use this on the meeting opener to surface them as the first reveal. */
export function dueCapsules(
  all: FamilyCapsule[],
  todayIso: string,
  windowDays: number = 3,
): FamilyCapsule[] {
  const today = new Date(`${todayIso}T00:00:00`);
  return all.filter((c) => {
    if (c.status !== 'sealed') return false;
    const open = new Date(`${c.openOn}T00:00:00`);
    const diffDays = Math.abs((today.getTime() - open.getTime()) / (24 * 60 * 60 * 1000));
    return diffDays <= windowDays;
  });
}

export async function sealCapsule(
  familyId: string,
  payload: Omit<FamilyCapsule, 'id' | 'writtenAt' | 'status'>,
): Promise<string> {
  const docRef = await addDoc(collection(db, 'families', familyId, COL), {
    ...payload,
    writtenAt: Date.now(),
    status: 'sealed' as CapsuleStatus,
  });
  return docRef.id;
}

export async function markCapsuleOpened(familyId: string, capsuleId: string): Promise<void> {
  await updateDoc(doc(db, 'families', familyId, COL, capsuleId), { status: 'opened' as CapsuleStatus });
}

export async function reflectOnCapsule(
  familyId: string,
  capsuleId: string,
  cameTrue: boolean,
): Promise<void> {
  await updateDoc(doc(db, 'families', familyId, COL, capsuleId), {
    status: 'reflected' as CapsuleStatus,
    cameTrue,
  });
}
