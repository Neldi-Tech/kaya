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
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';

/** Max lines a member can add per section (2026-06-14, Elia). One is
 *  still fine — this is optional headroom. */
export const MAX_SUBMISSION_LINES = 3;

export interface MeetingSubmission {
  uid: string;
  name: string;              // display name snapshot (for the presenter)
  emoji?: string;            // avatar emoji snapshot
  childId?: string;          // set when the submitter is a kid
  role: 'kid' | 'parent' | 'helper';
  /** Each section accepts up to MAX_SUBMISSION_LINES short entries. Empty
   *  strings dropped at save time so "filled" counts mean what they say. */
  gratitudes: string[];
  appreciations: string[];
  goals: string[];
  /** Sunday-Meeting v2 (PR E + 3-lines): each appreciation LINE can @-tag
   *  one family member (tap from the family list). These arrays are
   *  aligned by index with `appreciations` (a `null` entry = that line
   *  has no tag). Stored as the recipient's roster id (childId for kids /
   *  uid for parents) + a name snapshot. Revealed to each tagged person
   *  on meeting day. */
  appreciationTagIds?: (string | null)[];
  appreciationTagNames?: (string | null)[];
  /** @deprecated single-tag fields from the first @-tag ship — read as a
   *  fallback for line 0 only. New writes use the *Ids/*Names arrays. */
  appreciationTagId?: string;
  appreciationTagName?: string;
  updatedAt: number;         // epoch ms (Date.now())
}

const SUBS = 'upcomingMeetingSubmissions';

/** Resolve the @-tag name for a given appreciation line, preferring the
 *  per-line arrays and falling back to the legacy single field for line 0.
 *  Shared by the presenter, history archive, and routing. */
export function appreciationTagNameForLine(s: MeetingSubmission, i: number): string | undefined {
  const fromArr = s.appreciationTagNames?.[i];
  if (fromArr) return fromArr;
  if (i === 0 && s.appreciationTagName) return s.appreciationTagName;
  return undefined;
}

/** Same, for the routing id (uid/childId). */
export function appreciationTagIdForLine(s: MeetingSubmission, i: number): string | undefined {
  const fromArr = s.appreciationTagIds?.[i];
  if (fromArr) return fromArr;
  if (i === 0 && s.appreciationTagId) return s.appreciationTagId;
  return undefined;
}

export async function getMeetingSubmissions(
  familyId: string,
): Promise<MeetingSubmission[]> {
  const snap = await getDocs(collection(db, 'families', familyId, SUBS));
  return snap.docs.map((d) => d.data() as MeetingSubmission);
}

/** Live subscription — the presenter uses this so a member filling from
 *  their OWN My Day / Workplan appears in the meeting in real time (no
 *  refresh, no in-meeting typing needed). Returns an unsubscribe fn. */
export function subscribeMeetingSubmissions(
  familyId: string,
  cb: (rows: MeetingSubmission[]) => void,
): () => void {
  return onSnapshot(
    collection(db, 'families', familyId, SUBS),
    (snap) => cb(snap.docs.map((d) => d.data() as MeetingSubmission)),
    () => cb([]),
  );
}

/** Single-doc getter — the prep card uses this to HYDRATE its inputs on
 *  mount so a kid sees what they already submitted (and editing/re-saving
 *  never starts from a blank slate). Returns null if nothing saved yet. */
export async function getMeetingSubmission(
  familyId: string,
  uid: string,
): Promise<MeetingSubmission | null> {
  const ref = doc(db, 'families', familyId, SUBS, uid);
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as MeetingSubmission) : null;
}

/**
 * Save a member's prep — NON-DESTRUCTIVE per field (Sunday-Meeting v2
 * data-loss fix, 2026-06-14).
 *
 * The old version always wrote all three arrays from the incoming
 * payload, so an empty input (→ `[]` after trim/filter) WIPED whatever
 * was previously stored. With the card on three surfaces, a second save
 * with one field filled erased the other two — only the last-saved field
 * survived.
 *
 * The fix: read the existing doc first, and for each section keep the new
 * value only when it's non-empty — otherwise preserve what was stored.
 * Combined with the card now hydrating on mount, a member can fill across
 * days / screens / devices and nothing is ever lost. To intentionally
 * clear a line a member edits the text to empty AND we pass
 * `allowClear` (used by an explicit clear affordance later) — by default
 * empties are protective, not destructive.
 */
export async function setMeetingSubmission(
  familyId: string,
  uid: string,
  payload: Omit<MeetingSubmission, 'uid' | 'updatedAt'>,
  opts?: { allowClear?: boolean },
): Promise<void> {
  const ref = doc(db, 'families', familyId, SUBS, uid);
  const existing = await getDoc(ref);
  const prev = existing.exists() ? (existing.data() as MeetingSubmission) : null;

  const clean = (arr: string[]) => arr.map((s) => s.trim()).filter(Boolean).slice(0, MAX_SUBMISSION_LINES);
  // Per-field merge: take the incoming value if it has content; otherwise
  // keep what was already stored (unless an explicit clear was requested).
  const mergeField = (incoming: string[], stored: string[] | undefined): string[] => {
    const next = clean(incoming);
    if (next.length > 0) return next;
    if (opts?.allowClear) return [];
    return stored ?? [];
  };

  // Appreciations carry an aligned per-line @-tag. Zip text+tags, drop
  // empty-text lines (keeping each line's tag with it), cap to MAX. If the
  // result is empty, preserve the previously stored appreciations + tags
  // (non-destructive — a gratitude/goal-only re-save won't wipe them).
  const zipAppr = (
    texts: string[],
    ids?: (string | null)[],
    names?: (string | null)[],
  ) => {
    const rows = texts
      .map((t, i) => ({ t: (t || '').trim(), id: ids?.[i] ?? null, name: names?.[i] ?? null }))
      .filter((r) => r.t.length > 0)
      .slice(0, MAX_SUBMISSION_LINES);
    return {
      appreciations: rows.map((r) => r.t),
      appreciationTagIds: rows.map((r) => r.id),
      appreciationTagNames: rows.map((r) => r.name),
    };
  };
  const incomingAppr = zipAppr(payload.appreciations, payload.appreciationTagIds, payload.appreciationTagNames);
  const useIncomingAppr = incomingAppr.appreciations.length > 0 || opts?.allowClear;
  const apprFinal = useIncomingAppr
    ? incomingAppr
    : {
        appreciations: prev?.appreciations ?? [],
        appreciationTagIds: prev?.appreciationTagIds
          ?? (prev?.appreciationTagId ? [prev.appreciationTagId] : []),
        appreciationTagNames: prev?.appreciationTagNames
          ?? (prev?.appreciationTagName ? [prev.appreciationTagName] : []),
      };

  const merged: MeetingSubmission = {
    uid,
    name: payload.name || prev?.name || '',
    emoji: payload.emoji ?? prev?.emoji,
    childId: payload.childId ?? prev?.childId,
    role: payload.role || prev?.role || 'kid',
    gratitudes: mergeField(payload.gratitudes, prev?.gratitudes),
    appreciations: apprFinal.appreciations,
    goals: mergeField(payload.goals, prev?.goals),
    appreciationTagIds: apprFinal.appreciationTagIds,
    appreciationTagNames: apprFinal.appreciationTagNames,
    // Keep the legacy singular fields mirrored to line 0 so any
    // not-yet-updated reader still shows the first tag.
    appreciationTagId: apprFinal.appreciationTagIds[0] || undefined,
    appreciationTagName: apprFinal.appreciationTagNames[0] || undefined,
    updatedAt: Date.now(),
  };
  await setDoc(ref, merged, { merge: true });
}

/** Clear every submission for this family. Called after the meeting is
 *  successfully created so the next meeting starts with empty prompts. */
export async function clearMeetingSubmissions(familyId: string): Promise<void> {
  const snap = await getDocs(collection(db, 'families', familyId, SUBS));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
