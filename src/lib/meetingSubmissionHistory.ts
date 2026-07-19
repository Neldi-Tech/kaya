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
   *  progress or no next meeting yet). GOALS PR2: `released` = the goal
   *  was gracefully retired ("let it go 🍂") — out of the open queue,
   *  kept forever in the register. */
  goalsReflection?: Array<{ text: string; done: boolean; note?: string; released?: boolean }>;
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
      // stamp it on the entry the line BELONGS to. GOALS PR2: lines carry
      // originDate/originIndex (carried goals from any week) and route to
      // their own entry; legacy untagged lines keep the old behaviour —
      // the whole set lands on the newest previous entry. Blind stamping
      // of tagged lines onto entries[0] would misfile carried updates.
      let prevEntries = (prev?.entries || []).filter((e) => e.date !== meetingDate);
      const reflection = s.goalsReflection;
      if (reflection && reflection.length > 0 && prevEntries.length > 0) {
        const legacy = reflection.filter((r) => !r.originDate);
        prevEntries = prevEntries.map((e, k) => {
          const targeted = reflection.filter((r) => r.originDate === e.date);
          if (targeted.length === 0 && !(k === 0 && legacy.length > 0)) return e;
          let gr = e.goalsReflection
            ? [...e.goalsReflection]
            : (e.goals || []).map((g) => ({ text: g, done: false }));
          if (k === 0 && legacy.length > 0) {
            gr = legacy.map((r) => ({
              text: r.text, done: r.done,
              ...(r.note ? { note: r.note } : {}),
              ...(r.released ? { released: true } : {}),
            }));
          }
          targeted.forEach((r) => {
            const i = r.originIndex ?? -1;
            if (i < 0 || i >= (e.goals || []).length) return;
            while (gr.length <= i) gr.push({ text: (e.goals || [])[gr.length] || '', done: false });
            gr[i] = {
              text: r.text, done: r.done,
              ...(r.note ? { note: r.note } : {}),
              ...(r.released ? { released: true } : {}),
            };
          });
          return { ...e, goalsReflection: gr };
        });
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

/** GOALS PR2 — back-fill goal reflections IN PLACE on their origin entries
 *  (status + note + released only; goal TEXT is immutable — the register is
 *  the family keepsake). Addressed by entryDate + goalIndex, never by text
 *  (duplicate wordings must not collide). One read + one write for the
 *  whole batch. */
export async function updateGoalReflections(
  familyId: string,
  uid: string,
  updates: Array<{ entryDate: string; goalIndex: number; done: boolean; note?: string; released?: boolean }>,
): Promise<void> {
  if (updates.length === 0) return;
  const ref = doc(db, 'families', familyId, COL, uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const prev = snap.data() as SubmissionHistoryDoc;
  const entries = (prev.entries || []).map((e) => {
    const mine = updates.filter((u) => u.entryDate === e.date);
    if (mine.length === 0) return e;
    const gr = e.goalsReflection
      ? [...e.goalsReflection]
      : (e.goals || []).map((g) => ({ text: g, done: false }));
    mine.forEach((u) => {
      if (u.goalIndex < 0 || u.goalIndex >= (e.goals || []).length) return;
      while (gr.length <= u.goalIndex) gr.push({ text: (e.goals || [])[gr.length] || '', done: false });
      gr[u.goalIndex] = {
        text: (e.goals || [])[u.goalIndex],
        done: u.done,
        ...(u.note?.trim() ? { note: u.note.trim() } : {}),
        ...(u.released ? { released: true } : {}),
      };
    });
    return { ...e, goalsReflection: gr };
  });
  await setDoc(ref, { ...prev, entries }, { merge: true });
}

/** Read the whole family's histories — used by the 🫙 Gratitude Jar
 *  surprise (PR G) and a parent's read-only view of everyone's records. */
export async function getAllMeetingSubmissionHistory(
  familyId: string,
): Promise<SubmissionHistoryDoc[]> {
  const snap = await getDocs(collection(db, 'families', familyId, COL));
  return snap.docs.map((d) => d.data() as SubmissionHistoryDoc);
}
