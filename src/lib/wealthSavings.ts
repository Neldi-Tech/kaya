// Kaya Wealth · Savings Queue (Phase 2 · PR7 · 2026-06-01).
//
// The funnel UP. Household spend NEVER auto-promotes into Wealth — money sits
// in the Savings Queue, and ONLY an explicit, user-confirmed promotion turns
// it into a real investment (Non-Negotiable #8 / Concept Note §7).
//
// Balance lives on families/{f}/wealth_config/savings (parent-managed, same
// rule as the other wealth config). Promotion creates a wealth_asset funded
// from the queue and decrements the queue.

'use client';

import { doc, onSnapshot, setDoc, increment } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { createWealthAsset, type AssetClassId, type WealthAuthor } from './wealth';

export type SavingsView = 'shared' | 'personal';

export interface SavingsQueue {
  sharedCents: number;
  personalCents: Record<string, number>;
}

const savingsRef = (familyId: string) => doc(db, 'families', familyId, 'wealth_config', 'savings');

export function subscribeSavings(familyId: string, cb: (q: SavingsQueue) => void): () => void {
  if (isGuestActive()) { cb({ sharedCents: 0, personalCents: {} }); return () => {}; }
  return onSnapshot(
    savingsRef(familyId),
    (snap) => {
      const d = (snap.data() as Partial<SavingsQueue> | undefined) ?? {};
      cb({ sharedCents: d.sharedCents ?? 0, personalCents: d.personalCents ?? {} });
    },
    () => cb({ sharedCents: 0, personalCents: {} }),
  );
}

export function queueBalance(q: SavingsQueue, view: SavingsView, uid: string): number {
  return view === 'shared' ? q.sharedCents : (q.personalCents[uid] ?? 0);
}

/** Add to the queue (e.g. setting aside this month's savings). */
export async function depositToQueue(familyId: string, view: SavingsView, uid: string, cents: number): Promise<void> {
  if (isGuestActive() || cents <= 0) return;
  const patch = view === 'shared'
    ? { sharedCents: increment(cents) }
    : { personalCents: { [uid]: increment(cents) } };
  await setDoc(savingsRef(familyId), patch, { merge: true });
}

/** Withdraw from the queue without investing (back to spending). */
export async function withdrawFromQueue(familyId: string, view: SavingsView, uid: string, cents: number): Promise<void> {
  if (isGuestActive() || cents <= 0) return;
  const patch = view === 'shared'
    ? { sharedCents: increment(-cents) }
    : { personalCents: { [uid]: increment(-cents) } };
  await setDoc(savingsRef(familyId), patch, { merge: true });
}

/** Promote part of the queue into a real investment — the funnel UP, only on
 *  explicit confirmation. Creates the wealth_asset, then decrements the queue.
 *  Returns the new asset id. */
export async function promoteToInvestment(params: {
  familyId: string;
  view: SavingsView;
  ownerId: string;
  author: WealthAuthor;
  amountCents: number;
  currency: string;
  name: string;
  assetClass: AssetClassId;
}): Promise<string> {
  if (isGuestActive()) return 'guest';
  const { familyId, view, ownerId, author, amountCents, currency, name, assetClass } = params;
  const { assetId } = await createWealthAsset({
    familyId, class: assetClass, name, valueCents: amountCents, currency,
    visibility: view, ownerId,
    meta: { subtitle: 'Funded from the Savings Queue' },
    author,
  });
  const patch = view === 'shared'
    ? { sharedCents: increment(-amountCents) }
    : { personalCents: { [ownerId]: increment(-amountCents) } };
  await setDoc(savingsRef(familyId), patch, { merge: true });
  return assetId;
}
