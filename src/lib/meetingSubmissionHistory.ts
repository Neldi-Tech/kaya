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
import { appreciationTagLabelForLine, type MeetingSubmission } from './meetingSubmissions';

/** Keep ~1 year of weekly meetings; older entries roll off. */
const MAX_ENTRIES = 50;
const COL = 'meetingSubmissionHistory';

export interface SubmissionHistoryEntry {
  date: string;                     // meeting date, YYYY-MM-DD
  gratitudes: string[];
  appreciations: string[];
  /** Aligned with `appreciations` — who each line was for (null = none). */
  appreciationTagNames?: (string | null)[];
  /** @deprecated single-tag from the first ship — read as fallback. */
  appreciationTagName?: string;
  goals: string[];
  /** Self-reflection from the FOLLOWING cycle: did the member mark each
   *  goal accomplished before the next meeting, and (v4) a short NOTE on
   *  how it went? Archived from the NEXT cycle's goalsReflection, aligned
   *  by index with `goals`. Undefined = not yet reviewed (still in
   *  progress or no next meeting yet). */
  goalsReflection?: Array<{ text: string; done: boolean; note?: string }>;
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
    const goals = (s.goals || []).filter(Boolean);
    // Zip appreciation text with its per-line tag, then drop empty lines
    // so text + tag stay index-aligned in the archive.
    const apprRows = (s.appreciations || [])
      .map((t, i) => ({ t: (t || '').trim(), tag: appreciationTagLabelForLine(s, i) || null }))
      .filter((r) => r.t.length > 0);
    const appreciations = apprRows.map((r) => r.t);
    const appreciationTagNames = apprRows.map((r) => r.tag);
    if (gratitudes.length === 0 && appreciations.length === 0 && goals.length === 0) return;

    const entry: SubmissionHistoryEntry = {
      date: meetingDate,
      gratitudes,
      appreciations,
      goals,
      ...(appreciationTagNames.some(Boolean) ? { appreciationTagNames } : {}),
    };

    const ref = doc(db, 'families', familyId, COL, s.uid);
    try {
      const existing = await getDoc(ref);
      const prev = existing.exists() ? (existing.data() as SubmissionHistoryDoc) : null;

      // If this member filled in a self-reflection on their prior goals,
      // stamp it on the PREVIOUS entry (the one whose goals they reviewed).
      // This closes the loop: goal set → accomplishment recorded.
      let prevEntries = (prev?.entries || []).filter((e) => e.date !== meetingDate);
      const reflection = s.goalsReflection;
      if (reflection && reflection.length > 0 && prevEntries.length > 0) {
        prevEntries = [
          { ...prevEntries[0], goalsReflection: reflection },
          ...prevEntries.slice(1),
        ];
      }

      // Replace any same-date entry (idempotent if a meeting is re-saved),
      // then prepend the new one and cap.
      const entries = [entry, ...prevEntries].slice(0, MAX_ENTRIES);
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
