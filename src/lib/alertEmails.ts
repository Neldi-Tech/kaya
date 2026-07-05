// 🔔 Alert emails — CLIENT read/write for the recipient cascade (VIS PR3).
// The pure types + resolver live in lib/alertEmails.shared (imported by the
// server engine too — keep firebase web-SDK imports OUT of that file).

import { doc, updateDoc, deleteField, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { AlertCategory } from './alertEmails.shared';

export {
  ALERT_CATEGORIES, resolveAlertRecipients,
  type AlertCategory, type AlertEmailsConfig, type AlertResolveLevel,
} from './alertEmails.shared';

/** Set the global email list. `undefined` (or everyone) → store nothing:
 *  absent means "all parents", so future parents are included automatically. */
export async function setGlobalAlertEmails(familyId: string, uids: string[] | undefined): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId), {
    'alertEmails.global': uids && uids.length > 0 ? uids : deleteField(),
    updatedAt: serverTimestamp(),
  });
}

/** Customize a category (explicit detach, D10) or reset it to inherit
 *  (`undefined` → the field is removed and the category follows global). */
export async function setCategoryAlertEmails(
  familyId: string,
  category: AlertCategory,
  uids: string[] | undefined,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId), {
    [`alertEmails.${category}`]: uids && uids.length > 0 ? uids : deleteField(),
    updatedAt: serverTimestamp(),
  });
}
