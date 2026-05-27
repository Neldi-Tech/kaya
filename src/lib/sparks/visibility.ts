// Kaya Sparks · client-side sibling-visibility filter.
//
// Defence-in-depth wrapper around firestore.rules. The rules are the
// source of truth — these helpers exist so the UI doesn't render
// "Loading…" or empty cards for items the kid can't see anyway. They
// also let us skip an unnecessary query when a sibling can't read
// anything in the area.
//
// Slice 1 only ships the helpers; the area pages start using them in
// Slice 2 once `sparks_items` exists.

import type {
  SparksItemArea, SparksProfile, SparksSiblingVisibility,
} from './schema';

/** Resolve the effective visibility setting for a kid, defaulting to
 *  'open' when the profile doc is missing (matches firestore.rules). */
export function effectiveVisibility(profile: SparksProfile | null): SparksSiblingVisibility {
  return profile?.sibling_visibility ?? 'open';
}

/** Returns true when `viewerKidId` (a SIBLING — not the same kid) is
 *  allowed to read a Sparks item belonging to `targetKidId` in the
 *  given `area`. Always false when `viewerKidId === targetKidId` —
 *  callers should short-circuit that case before consulting this. */
export function canSiblingReadArea(
  targetProfile: SparksProfile | null,
  area: SparksItemArea,
): boolean {
  const v = effectiveVisibility(targetProfile);
  if (v === 'open') return true;
  if (v === 'independent') return false;
  // per_area — undefined area entries default to closed.
  return !!targetProfile?.per_area?.[area];
}

/** Same logic but for `sparks_academic` records. Per-area mode doesn't
 *  apply (academic isn't one of the item areas), so per_area collapses
 *  to "independent". */
export function canSiblingReadAcademic(
  targetProfile: SparksProfile | null,
): boolean {
  return effectiveVisibility(targetProfile) === 'open';
}

/** True when the viewer is the kid themselves — short-circuit the
 *  sibling check. Keeps callers from accidentally querying their own
 *  profile doc just to verify "yes I can see my own stuff". */
export function isSelfRead(viewerKidId: string | null | undefined, targetKidId: string): boolean {
  return !!viewerKidId && viewerKidId === targetKidId;
}
