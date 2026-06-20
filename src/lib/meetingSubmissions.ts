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

/** Appreciations are effectively uncapped — some families want to
 *  appreciate everyone (2026-06-14, Elia: "some families can have more
 *  than 3"). This high ceiling is only a defensive backstop against a
 *  runaway array; the UI shows no limit. Gratitude/Goals stay at
 *  MAX_SUBMISSION_LINES. */
export const MAX_APPRECIATION_LINES = 50;

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
  /** Sunday-Meeting v2 (multi-tag, 2026-06-14): each appreciation LINE can
   *  @-tag MULTIPLE family members, or "All". Aligned by index with
   *  `appreciations`. Firestore-safe (array of maps; each map holds
   *  primitive arrays). `all: true` = everyone (ids/names left empty). */
  appreciationTags?: AppreciationTag[];
  /** @deprecated per-line SINGLE tag (pre-multi). Read as a fallback when
   *  `appreciationTags` is absent. */
  appreciationTagIds?: (string | null)[];
  appreciationTagNames?: (string | null)[];
  /** @deprecated single-tag fields from the first @-tag ship — read as a
   *  fallback for line 0 only. */
  appreciationTagId?: string;
  appreciationTagName?: string;
  updatedAt: number;         // epoch ms (Date.now())
}

/** Per-appreciation-line tag: a multi-select of recipients, or "All". */
export interface AppreciationTag {
  ids: string[];     // recipient roster ids (childId for kids / uid for parents)
  names: string[];   // name snapshots, aligned with ids
  all?: boolean;     // "Everyone" — overrides ids/names
}

const SUBS = 'upcomingMeetingSubmissions';

/** Resolve the full multi-tag for an appreciation line, with back-compat:
 *  prefer `appreciationTags`, else the per-line single arrays, else the
 *  legacy singular (line 0). Shared by presenter / history / routing. */
export function appreciationTagsForLine(s: MeetingSubmission, i: number): AppreciationTag {
  const t = s.appreciationTags?.[i];
  if (t) return { ids: t.ids || [], names: t.names || [], all: !!t.all };
  const id = s.appreciationTagIds?.[i] ?? (i === 0 ? s.appreciationTagId : undefined) ?? undefined;
  const nm = s.appreciationTagNames?.[i] ?? (i === 0 ? s.appreciationTagName : undefined) ?? undefined;
  return { ids: id ? [id] : [], names: nm ? [nm] : [], all: false };
}

/** A human label for a line's tag — "Everyone" or "A, B, C" (or ''). */
export function appreciationTagLabelForLine(s: MeetingSubmission, i: number): string {
  const t = appreciationTagsForLine(s, i);
  if (t.all) return 'Everyone';
  return t.names.filter(Boolean).join(', ');
}

/** @deprecated single-name reader — kept for any older call site. */
export function appreciationTagNameForLine(s: MeetingSubmission, i: number): string | undefined {
  const lbl = appreciationTagLabelForLine(s, i);
  return lbl || undefined;
}
/** @deprecated single-id reader. */
export function appreciationTagIdForLine(s: MeetingSubmission, i: number): string | undefined {
  return appreciationTagsForLine(s, i).ids[0];
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

  // Normalise one line's multi-tag: drop empty ids/names, keep alignment;
  // `all` wins (ids/names cleared). Firestore-safe plain object.
  const cleanTag = (t?: AppreciationTag): AppreciationTag => {
    if (t?.all) return { ids: [], names: [], all: true };
    const ids = (t?.ids || []);
    const names = (t?.names || []);
    const rows = ids.map((id, j) => ({ id, name: names[j] || '' })).filter((r) => !!r.id);
    return { ids: rows.map((r) => r.id), names: rows.map((r) => r.name) };
  };

  // Appreciations carry an aligned per-line multi-tag. Zip text+tag, drop
  // empty-text lines (keeping each line's tag), cap to MAX. If the result
  // is empty, preserve the previously stored appreciations + tags
  // (non-destructive — a gratitude/goal-only re-save won't wipe them).
  const incomingRows = (payload.appreciations || [])
    .map((t, i) => ({ t: (t || '').trim(), tag: cleanTag(payload.appreciationTags?.[i]) }))
    .filter((r) => r.t.length > 0)
    .slice(0, MAX_APPRECIATION_LINES);

  let apprTexts: string[];
  let apprTags: AppreciationTag[];
  if (incomingRows.length > 0 || opts?.allowClear) {
    apprTexts = incomingRows.map((r) => r.t);
    apprTags = incomingRows.map((r) => r.tag);
  } else {
    // Preserve prior appreciations + tags (back-compat: rebuild tags from
    // whatever shape the stored doc used).
    apprTexts = prev?.appreciations ?? [];
    apprTags = apprTexts.map((_, i) => (prev ? appreciationTagsForLine(prev, i) : { ids: [], names: [] }));
  }

  // Legacy mirrors so any not-yet-updated reader still shows something:
  // per-line first name/id + a singular line-0 fallback.
  const legacyNames = apprTags.map((t) => (t.all ? 'Everyone' : (t.names[0] || null)));
  const legacyIds = apprTags.map((t) => (t.ids[0] || null));

  const merged: MeetingSubmission = {
    uid,
    name: payload.name || prev?.name || '',
    emoji: payload.emoji ?? prev?.emoji,
    childId: payload.childId ?? prev?.childId,
    role: payload.role || prev?.role || 'kid',
    gratitudes: mergeField(payload.gratitudes, prev?.gratitudes),
    appreciations: apprTexts,
    goals: mergeField(payload.goals, prev?.goals),
    appreciationTags: apprTags,
    appreciationTagIds: legacyIds,
    appreciationTagNames: legacyNames,
    appreciationTagId: legacyIds[0] || undefined,
    appreciationTagName: legacyNames[0] || undefined,
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
