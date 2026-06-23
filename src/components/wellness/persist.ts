// Kaya Wellness — persistence to one private doc per member:
//   families/{familyId}/wellness/{uid}
// Gracefully degrades: if the security rules aren't deployed yet (permission
// denied) or offline, load/save return null/false and the app stays on local
// state — no crash. Activates automatically once the rules are live.
import { db } from "@/lib/firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";

export async function loadWellness(familyId: string, uid: string): Promise<Record<string, unknown> | null> {
  try {
    const snap = await getDoc(doc(db, "families", familyId, "wellness", uid));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : {};
  } catch {
    return null; // rules not deployed yet / offline → caller keeps local state
  }
}

export async function saveWellness(familyId: string, uid: string, data: Record<string, unknown>): Promise<boolean> {
  try {
    await setDoc(doc(db, "families", familyId, "wellness", uid), { ...data, updatedAt: Date.now() }, { merge: true });
    return true;
  } catch {
    return false;
  }
}
