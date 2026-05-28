// Kaya Sparks · localStorage-backed draft persistence (Slice 7h).
//
// Survives an accidental sheet close — text the parent or kid typed
// but didn't send is hydrated back the next time the same sheet
// opens. Keyed by sheet + family + item + author so different items,
// different users, and different sheet types never collide.
//
// Photos aren't persisted — File objects can't be serialised — but
// re-picking is cheap; the painful loss is the typing.

const PREFIX = 'kaya:sparks-draft';

export function draftKey(
  surface: 'thread' | 'rating-notes',
  parts: { familyId: string; itemId: string; userId: string },
): string {
  return `${PREFIX}:${surface}:${parts.familyId}:${parts.itemId}:${parts.userId}`;
}

/** Read a saved draft for the given key. Returns null when none exists,
 *  localStorage is unavailable, or the read fails (quota, incognito). */
export function loadDraft(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const v = window.localStorage.getItem(key);
    return v && v.length > 0 ? v : null;
  } catch {
    return null;
  }
}

/** Persist a draft. Empty/whitespace clears the entry so old drafts
 *  don't linger after a successful send (which sets the field to ''). */
export function saveDraft(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    if (value.trim().length > 0) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // localStorage may be full or disabled — fail silently; the user
    // still has the in-memory text until they close the sheet.
  }
}

/** Drop a draft explicitly (e.g. after a successful send). */
export function clearDraft(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {}
}
