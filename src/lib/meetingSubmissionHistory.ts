// Meeting submission HISTORY (Sunday-Meeting v2 · PR F).
//
// The upcoming submission (families/{id}/upcomingMeetingSubmissions/{uid})
// is cleared after each meeting so the next week starts fresh. To let
// members "always look back" at what they shared, we ARCHIVE each
// submission into a per-member history doc just before that clear.
//
//   families/{familyId}/meetingSubmissionHistory/{uid}
//     { uid, name, emoji?, entries: SubmissionHistoryEntry[] }
//
// One doc per member = one fast read for the "My Submissions" tab, no
// composite index needed. The entries array is capped (newest first) so
// it can't grow without bound.

import {
  collection, doc, getDoc, getDocs, setDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import type { MeetingSubmission } from './meetingSubmissions';

/** Keep ~1 year of weekly meetings; older entries roll off. */
const MAX_ENTRIES = 50;
const COL = 'meetingSubmissionHistory';

export interface SubmissionHistoryEntry {
  date: string;                     // meeting date, YYYY-MM-DD
  gratitudes: string[];
  appreciations: string[];
  appreciationTagName?: string;     // who the appreciation was for
  goals: string[];
}

export interface SubmissionHistoryDoc {
  uid: string;
  name: string;
  emoji?: string;
  entries: SubmissionHistoryEntry[];  // newest first
}

/** Read one member's submission history (newest first). */
export async function getMeetingSubmissionHistory(
  familyId: string,
  uid: string,
): Promise<SubmissionHistoryDoc | null> {
  const snap = await getDoc(doc(db, 'families', familyId, COL, uid));
  return snap.exists() ? (snap.data() as SubmissionHistoryDoc) : null;
}

/**
 * Archive this meeting's submissions into each member's history doc.
 * Called on meeting submit, BEFORE clearMeetingSubmissions. Skips
 * submissions that are entirely empty. Best-effort per member — one
 * member's write failing never blocks the others (or the meeting).
 */
export async function archiveMeetingSubmissions(
  familyId: string,
  submissions: MeetingSubmission[],
  meetingDate: string,
): Promise<void> {
  await Promise.all(submissions.map(async (s) => {
    const gratitudes = (s.gratitudes || []).filter(Boolean);
    const appreciations = (s.appreciations || []).filter(Boolean);
    const goals = (s.goals || []).filter(Boolean);
    if (gratitudes.length === 0 && appreciations.length === 0 && goals.length === 0) return;

    const entry: SubmissionHistoryEntry = {
      date: meetingDate,
      gratitudes,
      appreciations,
      goals,
      ...(s.appreciationTagName ? { appreciationTagName: s.appreciationTagName } : {}),
    };

    const ref = doc(db, 'families', familyId, COL, s.uid);
    try {
      const existing = await getDoc(ref);
      const prev = existing.exists() ? (existing.data() as SubmissionHistoryDoc) : null;
      // Replace any same-date entry (idempotent if a meeting is re-saved),
      // then prepend the new one and cap.
      const kept = (prev?.entries || []).filter((e) => e.date !== meetingDate);
      const entries = [entry, ...kept].slice(0, MAX_ENTRIES);
      await setDoc(ref, {
        uid: s.uid,
        name: s.name || prev?.name || '',
        ...(s.emoji ? { emoji: s.emoji } : prev?.emoji ? { emoji: prev.emoji } : {}),
        entries,
      } as SubmissionHistoryDoc, { merge: true });
    } catch {
      /* best-effort — never block the meeting on one member's archive */
    }
  }));
}

/** Read the whole family's histories — used by the 🫙 Gratitude Jar
 *  surprise (PR G) and a parent's read-only view of everyone's records. */
export async function getAllMeetingSubmissionHistory(
  familyId: string,
): Promise<SubmissionHistoryDoc[]> {
  const snap = await getDocs(collection(db, 'families', familyId, COL));
  return snap.docs.map((d) => d.data() as SubmissionHistoryDoc);
}
