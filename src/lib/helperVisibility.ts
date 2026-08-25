// 🤝 Helper visibility in communication areas (2026-08-25).
//
// THE RULE (closed with Elia 2026-08-25):
//   A helper is *listed* in communication areas only when their
//   HelperLink is `status: 'active'` AND has at least one kid in
//   `kidIds`. A gardener, a driver, a paused cook — all still work
//   normally, they just stop populating every picker in the app. A
//   house with 6 helpers was showing 11 rows in the chat picker.
//
// WHY A MIRRORED FLAG AND NOT A DIRECT READ:
//   The source of truth (`families/{f}/helpers/{uid}`) is readable
//   ONLY by parents in the family and by the helper themselves
//   (firestore.rules → match /helpers/{helperUid}). Kids cannot read
//   it, and we must NOT widen that rule — helper docs carry the
//   readable helper password by design. So the parent-controlled
//   verdict is mirrored onto `users/{helperUid}.helperListed`, which
//   every family member can already read (rules → match /users).
//   User docs are owner-write-only, so the mirror is written by the
//   Admin gateway at /api/helpers/visibility. Zero rules deploys.
//
// FAIL-OPEN: `helperListed === undefined` means "listed". That covers
//   legacy helpers with no HelperLink doc at all (the rules carve them
//   out explicitly) and any family not yet backfilled — nobody
//   silently vanishes because of missing data.
//
// SCOPE: this is a *listing* filter only. It never changes what a
//   helper can read or write, never ejects anyone from a chat thread
//   they are already in, and never rewrites a saved recipient list.

/** The minimum shape any caller already has — UserProfile, ThreadMember,
 *  an Admin-SDK user doc, all satisfy it structurally. */
export interface ListableMember {
  uid: string;
  role?: string;
  helperListed?: boolean;
}

/** Compute the verdict from a HelperLink. The one place the rule lives. */
export function helperIsListed(link: { status?: string; kidIds?: unknown } | null | undefined): boolean {
  if (!link) return true;                                    // no doc → fail-open (legacy)
  if (link.status !== 'active') return false;                // paused / removed
  return Array.isArray(link.kidIds) && link.kidIds.length > 0;
}

/** True when this member should appear in communication lists.
 *  Non-helpers always pass. The viewer always passes (`selfUid`) so
 *  nobody is ever hidden from their own surfaces. */
export function isListedMember(m: ListableMember, selfUid?: string): boolean {
  if (!m) return false;
  if (selfUid && m.uid === selfUid) return true;
  if (m.role !== 'helper') return true;
  return m.helperListed !== false;
}

/** Filter a member list down to who may be listed. */
export function filterListedMembers<T extends ListableMember>(list: T[], selfUid?: string): T[] {
  return (list || []).filter((m) => isListedMember(m, selfUid));
}

/** How many helpers were hidden — drives the muted
 *  "🤝 N helpers without kid access" line in Settings → Family members
 *  so a parent never loses sight of someone they still employ. */
export function hiddenHelperCount(list: ListableMember[], selfUid?: string): number {
  return (list || []).filter((m) => m.role === 'helper' && !isListedMember(m, selfUid)).length;
}
