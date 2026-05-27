// Household · Contributions data layer.
//
// One collection: families/{f}/contributions/{contribId} — gifts,
// tithes, condolences (msiba), charity, family support. Parents-only
// by default; per-entry `visibility = 'family'` lets a kid read it
// (e.g. a teaching moment about giving).
//
// Schema docs:
//   Kaya Contributions and Subscrition in Budgets/
//     Kaya-Subscriptions-Contributions_Schema_2026-05-27.md
//
// P1 ships types + read helpers. Add/edit, the tithe % calc, occasion
// grouping + ledger writes land in P2.

import {
  collection, getDocs, Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type ContributionCategory =
  | 'faith' | 'charity' | 'life_events' | 'family_community'
  | 'civic' | 'education_sponsorship' | 'workplace' | 'other';

export type ContributionRecipientType = 'person' | 'organization' | 'cause' | 'community';

export type ContributionFrequency =
  | 'monthly' | 'quarterly' | 'annual' | 'one_off' | 'custom';

export type ContributionPaymentMethod =
  | 'mpesa' | 'bank' | 'cash' | 'cheque' | 'in_kind' | 'other';

export type ContributionVisibility =
  | 'parents_only' | 'family' | 'private_to_giver';

export interface ContributionOccasion {
  name: string;
  date: Timestamp;
  groupId: string | null;
}

export interface Contribution {
  id: string;
  recipientName: string;
  recipientType: ContributionRecipientType;
  recipientSupplierId: string | null;   // → /families/{f}/suppliers/{id}
  catalogueRef: string | null;
  anonymousFlag: boolean;

  category: ContributionCategory;
  subCategory: string;

  occasion: ContributionOccasion | null;

  // money — cents in the named currency (matches formatCents convention)
  amountOriginal: number;
  currencyOriginal: string;
  fxRate: number;
  amountHousehold: number;
  monthlyEquivalent: number;

  frequency: ContributionFrequency;
  customMonths: number | null;
  dateGiven: Timestamp;

  givenByUid: string;
  givenOnBehalfOf: string;

  paymentMethod: ContributionPaymentMethod;
  inKindDescription: string | null;
  estimatedValue: number | null;

  // tithe-specific
  isPercentOfIncome: boolean;
  percentRate: number | null;
  incomeBasis: number | null;
  incomeSourceRef: string | null;

  taxDeductible: boolean;
  receiptHeld: boolean;

  visibility: ContributionVisibility;

  notes: string;
  tags: string[];

  remembranceRecurring: boolean;
  remembranceDate: Timestamp | null;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

const contribsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'contributions');

/** Subscribe to all contributions for a family. Sort is client-side
 *  (date given DESC) — the list is small enough that avoiding an
 *  orderBy keeps the read index-free. */
export function subscribeToContributions(
  familyId: string,
  cb: (contribs: Contribution[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    contribsCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contribution));
      list.sort((a, b) => {
        const at = a.dateGiven?.toMillis?.() ?? 0;
        const bt = b.dateGiven?.toMillis?.() ?? 0;
        return bt - at;
      });
      cb(list);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[contributions] subscribe failed:', err);
      cb([]);
    },
  );
}

export async function listContributions(familyId: string): Promise<Contribution[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(contribsCol(familyId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Contribution));
}
