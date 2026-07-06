// 📬 Kids' Email Updates — SERVER resolution (KID PR1).
//
// The prefs store a POINTER (kid-profile / parent / contact); this resolves
// the live address at send time (F9). The senders themselves land with
// their features: 🏅 reward emails (KID PR2), 🌞 morning digest (KID PR3) —
// both call resolveKidEmailAddress and log to the 📜 alertLog.

import type { KidEmailPrefs } from './kidEmails.shared';

type AdminDb = FirebaseFirestore.Firestore;

interface FamilyDataSlice {
  kidEmailUpdates?: Record<string, KidEmailPrefs>;
  externalContacts?: { id: string; name: string; email: string }[];
}

export interface ResolvedKidEmail {
  email: string;
  /** Where it resolved from — logged for the parent-facing trace. */
  sourceLabel: 'kid profile' | 'parent' | 'approved contact';
}

/** Resolve the live address for one kid, or null when the pointer is unset,
 *  dangling (contact removed, parent left) or the target has no email —
 *  in every null case NOTHING sends, silently (D1: default-off posture). */
export async function resolveKidEmailAddress(
  db: AdminDb,
  familyId: string,
  childId: string,
  famData: FamilyDataSlice | undefined,
): Promise<ResolvedKidEmail | null> {
  const source = famData?.kidEmailUpdates?.[childId]?.source;
  if (!source) return null;
  try {
    if (source.type === 'kid') {
      const kid = await db.collection('families').doc(familyId)
        .collection('children').doc(childId).get();
      const email = (kid.data() as { email?: string } | undefined)?.email;
      return email ? { email, sourceLabel: 'kid profile' } : null;
    }
    if (source.type === 'parent') {
      const user = await db.collection('users').doc(source.uid).get();
      const u = user.data() as { email?: string; familyId?: string; role?: string } | undefined;
      // The pointer must still be a parent OF THIS family — a departed or
      // re-roled account silently stops receiving (same safety posture as
      // the alert-emails resolver).
      if (!u?.email || u.familyId !== familyId || u.role !== 'parent') return null;
      return { email: u.email, sourceLabel: 'parent' };
    }
    const c = (famData?.externalContacts ?? []).find((x) => x.id === source.id);
    return c?.email ? { email: c.email, sourceLabel: 'approved contact' } : null;
  } catch {
    return null; // resolution is best-effort — never throws into a sender
  }
}
