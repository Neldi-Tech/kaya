// 📬 Kids' Email Updates — CLIENT write for the per-kid prefs (KID PR1).
// Types + defaults live in lib/kidEmails.shared (server-safe).

import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { KidEmailPrefs } from './kidEmails.shared';

export {
  DEFAULT_DIGEST_TIME, DIGEST_TIME_CHOICES,
  DEFAULT_STATEMENT_TIME, DEFAULT_STATEMENT_DAY,
  STATEMENT_TIME_CHOICES, STATEMENT_DAYS, isValidEmail,
  type KidEmailPrefs, type KidEmailSource, type KidEmailUpdatesConfig,
  type StatementDay,
} from './kidEmails.shared';

/** Replace one kid's prefs map. The caller passes the FULL prefs object
 *  (built without undefined values) — a dot-path map write replaces the
 *  whole per-kid entry, which is exactly the semantics we want here. */
export async function setKidEmailPrefs(
  familyId: string,
  childId: string,
  prefs: KidEmailPrefs,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId), {
    [`kidEmailUpdates.${childId}`]: prefs,
    updatedAt: serverTimestamp(),
  });
}
