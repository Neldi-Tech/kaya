'use client';

// Kaya Lab — a kid rates a beta game 1–5★. Ratings live on the kid's OWN user
// doc (owner-writable — no new collection or rule, so no deploy), keyed by
// game id. Three distinct games rated unlocks the Tester Badge.

import { updateUserProfile, type UserProfile } from '@/lib/firestore';

export type LabRatings = NonNullable<UserProfile['labRatings']>;
export const TESTER_BADGE_AT = 3;

export async function rateBetaGame(
  uid: string,
  current: LabRatings | undefined,
  gameId: string,
  stars: number,
  comment?: string,
): Promise<LabRatings> {
  const next: LabRatings = {
    ...(current || {}),
    [gameId]: { stars, ...(comment ? { comment } : {}), at: Date.now() },
  };
  await updateUserProfile(uid, { labRatings: next });
  return next;
}

export function ratedCount(r: LabRatings | undefined): number {
  return r ? Object.keys(r).length : 0;
}

export function hasTesterBadge(r: LabRatings | undefined): boolean {
  return ratedCount(r) >= TESTER_BADGE_AT;
}
