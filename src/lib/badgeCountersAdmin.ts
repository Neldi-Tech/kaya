// 🏅 Badge counters — server side (BDG PR3).
//
// The Admin-SDK twin of `bumpBadgeCounters` in lib/firestore.ts. Kid-driven
// flows (ticking a workplan task, answering the daily question) run through
// server routes because a kid can't write their own child doc under the
// security rules — so those routes tally here. Always best-effort: a failed
// tally must never fail the action that earned it.

import { FieldValue, type Firestore } from 'firebase-admin/firestore';

export async function bumpBadgeCountersAdmin(
  db: Firestore,
  familyId: string,
  childId: string,
  deltas: Record<string, number>,
): Promise<void> {
  if (!familyId || !childId) return;
  const patch: Record<string, unknown> = {};
  for (const [key, n] of Object.entries(deltas)) {
    if (!key || !Number.isFinite(n) || n === 0) continue;
    patch[`badgeCounters.${key}`] = FieldValue.increment(n);
  }
  if (Object.keys(patch).length === 0) return;
  try {
    await db.collection('families').doc(familyId).collection('children').doc(childId).update(patch);
  } catch { /* tallies are best-effort */ }
}
