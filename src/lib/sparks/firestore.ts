// Kaya Sparks · client-side Firestore helpers.
//
// Slice 1 (2026-05-27) shipped the profile primitives.
// Slice 2 (2026-05-27) adds sparks_items + sparks_academic CRUD,
// count subscriptions for the kid home, and sibling-visibility writes.

'use client';

import {
  addDoc, collection, deleteDoc, doc, getCountFromServer, getDoc,
  getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc,
  Timestamp, updateDoc, where,
} from 'firebase/firestore';
import { db } from '../firebase';
import type {
  AcademicTerm, SparksAcademicRecord, SparksItem, SparksItemArea,
  SparksProfile, SparksRating, SparksSiblingVisibility, SparksThreadMessage,
} from './schema';

// ── Refs ──────────────────────────────────────────────────────────────

function profileRef(familyId: string, kidId: string) {
  return doc(db, 'families', familyId, 'sparks_profiles', kidId);
}
export function profilesCollection(familyId: string) {
  return collection(db, 'families', familyId, 'sparks_profiles');
}
function itemsCol(familyId: string) {
  return collection(db, 'families', familyId, 'sparks_items');
}
function itemRef(familyId: string, itemId: string) {
  return doc(db, 'families', familyId, 'sparks_items', itemId);
}
function academicCol(familyId: string) {
  return collection(db, 'families', familyId, 'sparks_academic');
}
function academicRef(familyId: string, recordId: string) {
  return doc(db, 'families', familyId, 'sparks_academic', recordId);
}
function ratingsCol(familyId: string) {
  return collection(db, 'families', familyId, 'sparks_ratings');
}
function ratingRef(familyId: string, ratingId: string) {
  return doc(db, 'families', familyId, 'sparks_ratings', ratingId);
}

// ── Profile · subjects + sibling-visibility + AI toggles ──────────────

export async function getSparksProfile(
  familyId: string, kidId: string,
): Promise<SparksProfile | null> {
  const snap = await getDoc(profileRef(familyId, kidId));
  return snap.exists() ? (snap.data() as SparksProfile) : null;
}

export function subscribeToSparksProfile(
  familyId: string,
  kidId: string,
  cb: (profile: SparksProfile | null) => void,
): () => void {
  return onSnapshot(
    profileRef(familyId, kidId),
    (snap) => cb(snap.exists() ? (snap.data() as SparksProfile) : null),
    () => cb(null),
  );
}

export async function upsertSparksProfile(
  familyId: string,
  kidId: string,
  patch: Partial<SparksProfile>,
  uid: string,
): Promise<void> {
  await setDoc(
    profileRef(familyId, kidId),
    { ...patch, updatedAt: serverTimestamp(), updatedBy: uid },
    { merge: true },
  );
}

/** Set sibling-visibility mode in one shot. When switching AWAY from
 *  `per_area`, the `per_area` map is preserved (UI clears it explicitly
 *  via `upsertSparksProfile` if the parent wants a fresh state). */
export async function setSiblingVisibility(
  familyId: string,
  kidId: string,
  mode: SparksSiblingVisibility,
  uid: string,
): Promise<void> {
  await upsertSparksProfile(familyId, kidId, { sibling_visibility: mode }, uid);
}

/** Slice 7g · copy one kid's `revision_settings` into every other kid's
 *  profile in the family. Skips the source kid. Used by the setup card's
 *  "Copy to all kids" action so a parent who already configured one kid
 *  can mirror the values family-wide in a single tap.
 *
 *  Returns the number of kids written to (excluding the source). */
export async function copyRevisionSettingsToAllKids(
  familyId: string,
  sourceKidId: string,
  uid: string,
): Promise<number> {
  const source = await getSparksProfile(familyId, sourceKidId);
  const settings = source?.revision_settings;
  if (!settings) return 0;
  const snap = await getDocs(profilesCollection(familyId));
  const targets = snap.docs.map((d) => d.id).filter((id) => id !== sourceKidId);
  await Promise.all(
    targets.map((kidId) =>
      upsertSparksProfile(familyId, kidId, { revision_settings: settings }, uid),
    ),
  );
  return targets.length;
}

/** Toggle one area's per_area flag. Forces sibling_visibility = 'per_area'
 *  so the new flag actually takes effect. */
export async function setSiblingPerAreaFlag(
  familyId: string,
  kidId: string,
  area: SparksItemArea,
  allow: boolean,
  uid: string,
): Promise<void> {
  const profile = await getSparksProfile(familyId, kidId);
  const nextPerArea = { ...(profile?.per_area ?? {}), [area]: allow };
  await upsertSparksProfile(
    familyId,
    kidId,
    { sibling_visibility: 'per_area', per_area: nextPerArea },
    uid,
  );
}

/** Add a subject to the kid's subjects list. Idempotent — duplicates
 *  (case-insensitive) are silently ignored. */
export async function addSubject(
  familyId: string,
  kidId: string,
  name: string,
  uid: string,
): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) return;
  const profile = await getSparksProfile(familyId, kidId);
  const existing = profile?.subjects ?? [];
  const seen = new Set(existing.map((s) => s.name.toLowerCase()));
  if (seen.has(trimmed.toLowerCase())) return;
  await upsertSparksProfile(
    familyId,
    kidId,
    { subjects: [...existing, { name: trimmed, addedAt: null }] },
    uid,
  );
}

export async function removeSubject(
  familyId: string,
  kidId: string,
  name: string,
  uid: string,
): Promise<void> {
  const profile = await getSparksProfile(familyId, kidId);
  const next = (profile?.subjects ?? []).filter((s) => s.name !== name);
  await upsertSparksProfile(familyId, kidId, { subjects: next }, uid);
}

// ── Items · gallery uploads for the 4 capture areas ───────────────────

export interface NewSparksItemInput {
  kid_id: string;
  area: SparksItemArea;
  title: string;
  description?: string;
  photo_urls: string[];
  date: string; // YYYY-MM-DD
  subject?: string;
  tags?: string[];
}

/** Create a sparks_items row. Returns the new id. */
export async function createSparksItem(
  familyId: string,
  input: NewSparksItemInput,
  createdBy: string,
): Promise<string> {
  const ref = await addDoc(itemsCol(familyId), {
    ...input,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
    created_by: createdBy,
  });
  return ref.id;
}

/** Live subscription to a kid's items in ONE area, newest first.
 *  Composite index: kid_id ASC + area ASC + created_at DESC
 *  (registered in firestore.indexes.json by Slice 1). */
export function subscribeToAreaItems(
  familyId: string,
  kidId: string,
  area: SparksItemArea,
  cb: (items: SparksItem[]) => void,
  pageSize = 100,
): () => void {
  const q = query(
    itemsCol(familyId),
    where('kid_id', '==', kidId),
    where('area', '==', area),
    orderBy('created_at', 'desc'),
    limit(pageSize),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SparksItem))),
    () => cb([]),
  );
}

/** Live subscription to ALL areas for a kid, newest first. Used by
 *  the kid home's count chips (counted client-side from the stream). */
export function subscribeToAllKidItems(
  familyId: string,
  kidId: string,
  cb: (items: SparksItem[]) => void,
): () => void {
  const q = query(
    itemsCol(familyId),
    where('kid_id', '==', kidId),
    orderBy('created_at', 'desc'),
    limit(500),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SparksItem))),
    () => cb([]),
  );
}

/** Delete one item. Photo blobs in Storage are best-effort-deleted by
 *  the caller (see sparks/uploadPhoto.ts → `deleteSparksPhoto`). */
export async function deleteSparksItem(
  familyId: string,
  itemId: string,
): Promise<void> {
  await deleteDoc(itemRef(familyId, itemId));
}

/** Patch fields on an existing item (e.g. fixing a title or date). */
export async function updateSparksItem(
  familyId: string,
  itemId: string,
  patch: Partial<Omit<SparksItem, 'id' | 'created_at' | 'created_by'>>,
): Promise<void> {
  await updateDoc(itemRef(familyId, itemId), { ...patch, updated_at: serverTimestamp() });
}

/** Toggle the ✨ all-time-highlight flag on a single item. The client
 *  guards a 5-per-area cap; this helper does the simple flip and the
 *  cap check sits in the UI layer so the kid sees a friendly swap-out
 *  prompt instead of a silent rule rejection. */
export async function setItemHighlight(
  familyId: string,
  itemId: string,
  on: boolean,
): Promise<void> {
  await updateDoc(itemRef(familyId, itemId), {
    is_highlight: on,
    updated_at: serverTimestamp(),
  });
}

/** Bump a sports subscription's session counter by `by` (default +1).
 *  Reads → mutates → writes; not transactional, but sessions are
 *  user-driven (one click) and contention is effectively zero. */
export async function bumpSportsSession(
  familyId: string,
  itemId: string,
  by = 1,
): Promise<number> {
  const snap = await getDoc(itemRef(familyId, itemId));
  const data = snap.data() as SparksItem | undefined;
  const current = data?.sessions?.attended ?? 0;
  const next = Math.max(0, current + by);
  await updateDoc(itemRef(familyId, itemId), {
    'sessions.attended': next,
    updated_at: serverTimestamp(),
  });
  return next;
}

/** Set the planned session count for a sports subscription. */
export async function setSportsPlanned(
  familyId: string,
  itemId: string,
  planned: number | null,
): Promise<void> {
  await updateDoc(itemRef(familyId, itemId), {
    'sessions.planned': planned !== null && planned > 0 ? planned : null,
    updated_at: serverTimestamp(),
  });
}

// ── Academic · PTM follow-up helpers (Slice 3b) ──────────────────────
//
// Follow-ups live as an embedded array on the academic record (one
// record per kid-year-term). These helpers do read-modify-write since
// Firestore can't atomically push into / patch an array element.

export async function addAcademicFollowUp(
  familyId: string,
  recordId: string,
  followUp: { text: string; due_date?: string },
): Promise<string> {
  const snap = await getDoc(academicRef(familyId, recordId));
  const data = snap.data() as SparksAcademicRecord | undefined;
  const existing = data?.follow_ups ?? [];
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const next = [
    ...existing,
    {
      id,
      text: followUp.text.trim(),
      due_date: followUp.due_date,
      status: 'open' as const,
    },
  ];
  await updateDoc(academicRef(familyId, recordId), {
    follow_ups: next,
    updated_at: serverTimestamp(),
  });
  return id;
}

export async function setAcademicFollowUpStatus(
  familyId: string,
  recordId: string,
  followUpId: string,
  status: 'open' | 'closed',
  uid: string,
): Promise<void> {
  const snap = await getDoc(academicRef(familyId, recordId));
  const data = snap.data() as SparksAcademicRecord | undefined;
  const existing = data?.follow_ups ?? [];
  const next = existing.map((f) =>
    f.id === followUpId
      ? {
          ...f,
          status,
          ...(status === 'closed'
            ? { closed_at: Timestamp.now(), closed_by: uid }
            : { closed_at: undefined, closed_by: undefined }),
        }
      : f,
  );
  await updateDoc(academicRef(familyId, recordId), {
    follow_ups: next,
    updated_at: serverTimestamp(),
  });
}

export async function removeAcademicFollowUp(
  familyId: string,
  recordId: string,
  followUpId: string,
): Promise<void> {
  const snap = await getDoc(academicRef(familyId, recordId));
  const data = snap.data() as SparksAcademicRecord | undefined;
  const existing = data?.follow_ups ?? [];
  const next = existing.filter((f) => f.id !== followUpId);
  await updateDoc(academicRef(familyId, recordId), {
    follow_ups: next,
    updated_at: serverTimestamp(),
  });
}

// ── Counts · for the kid home chips ───────────────────────────────────
//
// `subscribeToAllKidItems` is the cheaper live path (one read stream
// shared between every area chip). `getAcademicCount` is the cold
// server-aggregation read for academic.

export function countItemsByArea(items: SparksItem[]): Record<SparksItemArea, number> {
  const counts: Record<SparksItemArea, number> = {
    school_project: 0,
    home_project: 0,
    achievement: 0,
    sports_subscription: 0,
    revision: 0,
  };
  for (const it of items) counts[it.area]++;
  return counts;
}

/** One-shot server-aggregation count of academic records for a kid.
 *  Used by the kid home chip without streaming every doc to the client. */
export async function getAcademicCount(familyId: string, kidId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(academicCol(familyId), where('kid_id', '==', kidId)),
  );
  return snap.data().count;
}

// ── Academic · per-term records ───────────────────────────────────────
//
// Doc id convention: `${kidId}_${year}_${term}` so back-fill + edits
// idempotently overwrite the same row. Subjects[] is the day-to-day
// edit surface; PTM follow-ups + behavior flags get their own write
// helpers in Slice 3.

export function academicDocId(kidId: string, year: number, term: AcademicTerm): string {
  return `${kidId}_${year}_${term}`;
}

export interface AcademicSubjectInput {
  name: string;
  grade?: string;
  percent?: number;
  teacher_note?: string;
}

/** Upsert a term record (subjects edited in place). Creates the doc
 *  when missing, merges otherwise. */
export async function upsertAcademicRecord(
  familyId: string,
  input: {
    kid_id: string;
    year: number;
    term: AcademicTerm;
    subjects: AcademicSubjectInput[];
    ptm_notes?: string;
  },
): Promise<string> {
  const id = academicDocId(input.kid_id, input.year, input.term);
  const ref = academicRef(familyId, id);
  const existing = await getDoc(ref);
  const payload = {
    ...input,
    updated_at: serverTimestamp(),
    ...(existing.exists() ? {} : { created_at: serverTimestamp() }),
  };
  await setDoc(ref, payload, { merge: true });
  return id;
}

/** Live subscription to a kid's academic records, ordered year DESC
 *  then term DESC (matches the composite index in firestore.indexes.json). */
export function subscribeToAcademicRecords(
  familyId: string,
  kidId: string,
  cb: (records: SparksAcademicRecord[]) => void,
): () => void {
  const q = query(
    academicCol(familyId),
    where('kid_id', '==', kidId),
    orderBy('year', 'desc'),
    orderBy('term', 'desc'),
    limit(50),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SparksAcademicRecord))),
    () => cb([]),
  );
}

/** Cold read — used by export paths that don't want a live stream. */
export async function listAcademicRecords(
  familyId: string,
  kidId: string,
): Promise<SparksAcademicRecord[]> {
  const q = query(
    academicCol(familyId),
    where('kid_id', '==', kidId),
    orderBy('year', 'desc'),
    orderBy('term', 'desc'),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SparksAcademicRecord));
}

// ── Ratings · parent rates an item (Slice 3) or a task (Slice 3b) ────
//
// One doc per rating event in /families/{f}/sparks_ratings/{ratingId}.
// At least one of stars / percent / custom_value is populated; the
// rating mode at the call site decides which fields end up on the doc.
// Dashboard aggregates this by kid + date range (Slice 5).

export interface NewItemRatingInput {
  kid_id: string;
  item_id: string;
  date: string; // YYYY-MM-DD — mirrors the item's date so the dashboard
                //   buckets ratings against the work, not the rating moment
  stars?: number;       // 1–5
  percent?: number;     // 0–100
  custom_value?: string;
  notes?: string;
}

/** Create a rating against a sparks_item. Returns the new id. */
export async function createItemRating(
  familyId: string,
  input: NewItemRatingInput,
  parentUid: string,
): Promise<string> {
  // Strip undefined so Firestore doesn't reject the write — the rules
  // accept missing fields, but the SDK rejects literal `undefined`.
  const payload: Record<string, unknown> = {
    item_id: input.item_id,
    kid_id: input.kid_id,
    date: input.date,
    parent_id: parentUid,
    created_at: serverTimestamp(),
  };
  if (input.stars !== undefined)        payload.stars = input.stars;
  if (input.percent !== undefined)      payload.percent = input.percent;
  if (input.custom_value !== undefined && input.custom_value.length > 0) payload.custom_value = input.custom_value;
  if (input.notes !== undefined && input.notes.length > 0) payload.notes = input.notes;
  const ref = await addDoc(ratingsCol(familyId), payload);
  return ref.id;
}

/** Live subscription to all ratings for a kid, newest first. The kid
 *  home + area pages share this stream and JOIN per-item via
 *  `ratingsByItemId(ratings)` to render the chip + bar. */
export function subscribeToKidRatings(
  familyId: string,
  kidId: string,
  cb: (ratings: SparksRating[]) => void,
): () => void {
  const q = query(
    ratingsCol(familyId),
    where('kid_id', '==', kidId),
    orderBy('date', 'desc'),
    limit(500),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SparksRating))),
    () => cb([]),
  );
}

/** Delete one rating (parent retract). */
export async function deleteRating(familyId: string, ratingId: string): Promise<void> {
  await deleteDoc(ratingRef(familyId, ratingId));
}

/** Group a stream of ratings into a map keyed by item_id. The values
 *  are sorted newest-first by `date` so callers can pick the latest
 *  rating per item or aggregate across them. */
export function ratingsByItemId(ratings: SparksRating[]): Map<string, SparksRating[]> {
  const m = new Map<string, SparksRating[]>();
  for (const r of ratings) {
    if (!r.item_id) continue;
    const arr = m.get(r.item_id);
    if (arr) arr.push(r); else m.set(r.item_id, [r]);
  }
  return m;
}

/** Latest rating for an item (or null when unrated). */
export function latestRatingFor(
  itemId: string,
  ratings: SparksRating[] | Map<string, SparksRating[]>,
): SparksRating | null {
  const arr = ratings instanceof Map ? ratings.get(itemId) : ratings.filter((r) => r.item_id === itemId);
  return arr && arr.length > 0 ? arr[0] : null;
}

export interface RatingAggregate {
  count: number;
  avgStars: number | null;   // null when no star ratings
  avgPercent: number | null; // null when no percent ratings
}

/** Aggregate ⭐ + % across a list of ratings. Used by kid home /
 *  parent strip ("Avg ⭐ 4.2 · 87%") and the dashboard later. */
export function aggregateRatings(ratings: SparksRating[]): RatingAggregate {
  let starSum = 0, starCount = 0;
  let pctSum = 0, pctCount = 0;
  for (const r of ratings) {
    if (typeof r.stars === 'number') { starSum += r.stars; starCount++; }
    if (typeof r.percent === 'number') { pctSum += r.percent; pctCount++; }
  }
  return {
    count: ratings.length,
    avgStars:   starCount > 0 ? +(starSum / starCount).toFixed(1) : null,
    avgPercent: pctCount  > 0 ? Math.round(pctSum / pctCount)     : null,
  };
}

// ── Small helpers ─────────────────────────────────────────────────────

/** Today as YYYY-MM-DD in the user's local timezone. Used by the
 *  capture sheet's default date. Matches the rule in
 *  `feedback_date_format.md` — compute day boundaries in LOCAL time. */
export function todayYmd(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Convert a Firestore Timestamp (or null) to a JS Date or null. */
export function tsToDate(t: Timestamp | null | undefined): Date | null {
  return t ? t.toDate() : null;
}

// ── Revision thread · message CRUD (Slice 7e · 2026-05-28) ───────────

function threadCol(familyId: string, itemId: string) {
  return collection(db, 'families', familyId, 'sparks_items', itemId, 'thread');
}

export interface NewThreadMessageInput {
  authorUid: string;
  authorName: string;
  authorRole: 'parent' | 'helper' | 'kid';
  text?: string;
  photo_urls?: string[];
  /** Slice 7f · 'redo' messages re-score a revision; carry the new
   *  ai score + breakdown + notes + round so the bubble can render
   *  the comparison. 'message' (default) = plain text/photo reply. */
  kind?: 'message' | 'redo';
  redo_score?: number;
  redo_breakdown?: { correct: number; partial: number; wrong: number };
  redo_notes?: string;
  redo_round?: number;
}

/** Append a message to a sparks_item's thread. */
export async function postThreadMessage(
  familyId: string,
  itemId: string,
  input: NewThreadMessageInput,
): Promise<string> {
  const payload: Record<string, unknown> = {
    authorUid: input.authorUid,
    authorName: input.authorName,
    authorRole: input.authorRole,
    createdAt: serverTimestamp(),
  };
  if (input.text && input.text.trim().length > 0) payload.text = input.text.trim();
  if (input.photo_urls && input.photo_urls.length > 0) payload.photo_urls = input.photo_urls;
  if (input.kind === 'redo') {
    payload.kind = 'redo';
    if (typeof input.redo_score === 'number')  payload.redo_score = input.redo_score;
    if (input.redo_breakdown) payload.redo_breakdown = input.redo_breakdown;
    if (input.redo_notes && input.redo_notes.trim().length > 0) payload.redo_notes = input.redo_notes.trim();
    if (typeof input.redo_round === 'number')  payload.redo_round = input.redo_round;
  }
  const ref = await addDoc(threadCol(familyId, itemId), payload);
  return ref.id;
}

/** Live subscription to a sparks_item's thread, oldest-first (chat style). */
export function subscribeToThread(
  familyId: string,
  itemId: string,
  cb: (messages: SparksThreadMessage[]) => void,
): () => void {
  const q = query(
    threadCol(familyId, itemId),
    orderBy('createdAt', 'asc'),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SparksThreadMessage))),
    () => cb([]),
  );
}

/** One-shot count for the "💬 N" badge on the revisions list — uses the
 *  server-aggregation count so we don't stream every row. */
export async function getThreadCount(familyId: string, itemId: string): Promise<number> {
  const snap = await getCountFromServer(threadCol(familyId, itemId));
  return snap.data().count;
}

/** Delete one message (author or parent only — rules enforce). */
export async function deleteThreadMessage(
  familyId: string, itemId: string, messageId: string,
): Promise<void> {
  await deleteDoc(doc(db, 'families', familyId, 'sparks_items', itemId, 'thread', messageId));
}
