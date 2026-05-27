// Kaya Sparks · client-side Firestore helpers.
//
// Slice 1 (2026-05-27) ships the profile read/write + subscription
// primitives the landing page needs. Item / academic / task / rating
// CRUD lands in Slice 2+ — keep this module narrow until then.

'use client';

import {
  collection, doc, onSnapshot, getDoc, serverTimestamp, setDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import type { SparksProfile } from './schema';

/** Doc reference for a kid's Sparks profile. */
function profileRef(familyId: string, kidId: string) {
  return doc(db, 'families', familyId, 'sparks_profiles', kidId);
}

/** Collection reference for all profiles in a family — only used by the
 *  parent setup screen + the dashboard family roll-up. */
export function profilesCollection(familyId: string) {
  return collection(db, 'families', familyId, 'sparks_profiles');
}

/** One-shot read for a single kid's profile. Returns `null` when the
 *  doc doesn't exist — callers should treat that as "spec defaults"
 *  (`sibling_visibility = 'open'`, no subjects set, AI highlights off). */
export async function getSparksProfile(
  familyId: string, kidId: string,
): Promise<SparksProfile | null> {
  const snap = await getDoc(profileRef(familyId, kidId));
  return snap.exists() ? (snap.data() as SparksProfile) : null;
}

/** Live subscription to a kid's profile. The callback fires once with
 *  `null` if the doc is missing, then again each time the doc changes.
 *  Returns the unsubscribe handle (Firestore's `onSnapshot` shape). */
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

/** Upsert helper used by setup. Stamps `updatedAt` + `updatedBy`
 *  server-side so we can audit who flipped the visibility toggle. */
export async function upsertSparksProfile(
  familyId: string,
  kidId: string,
  patch: Partial<SparksProfile>,
  uid: string,
): Promise<void> {
  await setDoc(
    profileRef(familyId, kidId),
    {
      ...patch,
      updatedAt: serverTimestamp(),
      updatedBy: uid,
    },
    { merge: true },
  );
}
