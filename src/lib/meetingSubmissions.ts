// Async pre-fill for Sunday Meetings (Sunday-Meeting v2 · b2).
//
// Each family member fills 3 short sections — Gratitudes / Appreciations
// / Goals — BEFORE the meeting, from their own My Day card. Tonight's
// presenter reads everyone's submissions and surfaces them inside the
// matching agenda steps so the family just reads off the screen instead
// of typing under time pressure.
//
// Persistence model — subcollection of one doc per user:
//   families/{familyId}/upcomingMeetingSubmissions/{uid}
//
// Why a subcollection (not a nested map on Family):
//   • Per-doc rules — each user can write only their own doc; parents
//     can read everyone's; no risk of one user overwriting another's
//     submission by racing the family doc.
//   • Independent updatedAt for "filled · 2 of 3" stats.
//   • Easy bulk-delete on meeting submit (subcollection sweep).
//
// All keys are uids (the auth-provided id). For kids, we also stamp
// `childId` so the presenter can map a submission back to the per-kid
// `gratitude[childId]` state without an extra round-trip.

import {
  collection, doc, getDocs, setDoc, deleteDoc,
} from 'firebase/firestore';
import { db } from './firebase';

export interface MeetingSubmission {
  uid: string;
  name: string;              // display name snapshot (for the presenter)
  emoji?: string;            // avatar emoji snapshot
  childId?: string;          // set when the submitter is a kid
  role: 'kid' | 'parent' | 'helper';
  /** Each section accepts 1-2 short entries. Empty strings dropped at
   *  save time so "filled" counts mean what they say. */
  gratitudes: string[];
  appreciations: string[];
  goals: string[];
  updatedAt: number;         // epoch ms (Date.now())
}

const SUBS = 'upcomingMeetingSubmissions';

export async function getMeetingSubmissions(
  familyId: string,
): Promise<MeetingSubmission[]> {
  const snap = await getDocs(collection(db, 'families', familyId, SUBS));
  return snap.docs.map((d) => d.data() as MeetingSubmission);
}

export async function setMeetingSubmission(
  familyId: string,
  uid: string,
  payload: Omit<MeetingSubmission, 'uid' | 'updatedAt'>,
): Promise<void> {
  const clean: MeetingSubmission = {
    uid,
    name: payload.name,
    emoji: payload.emoji,
    childId: payload.childId,
    role: payload.role,
    gratitudes: payload.gratitudes.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    appreciations: payload.appreciations.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    goals: payload.goals.map((s) => s.trim()).filter(Boolean).slice(0, 2),
    updatedAt: Date.now(),
  };
  await setDoc(doc(db, 'families', familyId, SUBS, uid), clean, { merge: true });
}

/** Clear every submission for this family. Called after the meeting is
 *  successfully created so the next meeting starts with empty prompts. */
export async function clearMeetingSubmissions(familyId: string): Promise<void> {
  const snap = await getDocs(collection(db, 'families', familyId, SUBS));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
