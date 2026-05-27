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
  SparksProfile, SparksSiblingVisibility,
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
