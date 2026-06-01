// Kaya Wealth · advisories — client read + act (Phase 2 · PR7 · 2026-06-01).
//
// Advisories are GENERATED server-side (the wealth-advisor route, Admin SDK);
// the firestore rule lets clients only flip the action fields. So the user
// can act on or dismiss a card, but never fabricate one — preserving the
// funnel's integrity.

'use client';

import { collection, onSnapshot, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from './firebase';

export interface Advisory {
  id: string;
  kind: string;
  title: string;
  body: string;
  amountCents?: number;
  currency?: string;
  ctaLabel?: string;
  assetId?: string;
  visibility: 'shared' | 'personal';
  status: 'open' | 'acted' | 'dismissed';
}

export function subscribeAdvisories(familyId: string, cb: (a: Advisory[]) => void): () => void {
  return onSnapshot(
    collection(db, 'families', familyId, 'wealth_advisories'),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Advisory)).filter((a) => a.status === 'open')),
    () => cb([]),
  );
}

export async function dismissAdvisory(familyId: string, id: string): Promise<void> {
  await updateDoc(doc(db, 'families', familyId, 'wealth_advisories', id), {
    status: 'dismissed', actedAt: serverTimestamp(), actedBy: auth.currentUser?.uid ?? '',
  });
}

export async function markAdvisoryActed(familyId: string, id: string, resultingInvestmentId: string | null): Promise<void> {
  await updateDoc(doc(db, 'families', familyId, 'wealth_advisories', id), {
    status: 'acted', actedAt: serverTimestamp(), actedBy: auth.currentUser?.uid ?? '',
    resultingInvestmentId: resultingInvestmentId ?? null,
  });
}

/** Ask the server to regenerate advisories from the family's current wealth
 *  (queue balance, maturing assets…). Best-effort. */
export async function refreshAdvisories(householdCurrency: string): Promise<void> {
  const u = auth.currentUser;
  if (!u) return;
  try {
    const token = await u.getIdToken();
    await fetch('/api/wealth/advisories/refresh', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ householdCurrency }),
    });
  } catch { /* best-effort */ }
}
