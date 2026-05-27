// Household · Subscriptions data layer.
//
// One collection: families/{f}/subscriptions/{subId} — every recurring
// or one-off subscription the family tracks (Netflix, gym, land rent…).
// Two billing modes — 'auto' (card on file, passive tracking) and
// 'manual' (post-due check + reminders). Property & Land subs are
// mirrored from Kaya Wealth (sourceModule === 'wealth') and edited
// there; everything else originates in Household.
//
// Schema docs:
//   Kaya Contributions and Subscrition in Budgets/
//     Kaya-Subscriptions-Contributions_Schema_2026-05-27.md
//
// P1 ships types + read helpers. Add/edit, receipts, cycles, reminders
// + the spend-ledger writer land in P2/P3/P4.

import {
  collection, doc, getDocs, Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type SubscriptionCategory =
  | 'mobile_apps' | 'memberships' | 'media' | 'utilities_sub'
  | 'property_land' | 'vehicle' | 'education' | 'professional' | 'other';

export type SubscriptionStatus       = 'active' | 'trial' | 'paused' | 'cancelled';
export type SubscriptionBillingMode  = 'auto' | 'manual';
export type SubscriptionFrequency    =
  | 'daily' | 'weekly' | 'monthly' | 'quarterly'
  | 'semi_annual' | 'annual' | 'one_off' | 'custom';
export type SubscriptionPlatform     = 'ios' | 'android' | 'web' | 'other';
export type SubscriptionSourceModule = 'household' | 'wealth';

export interface Subscription {
  id: string;
  name: string;
  catalogueRef: string | null;

  category: SubscriptionCategory;
  subCategory: string;
  platform: SubscriptionPlatform | null;

  billingMode: SubscriptionBillingMode;
  status: SubscriptionStatus;
  trialEndsOn: Timestamp | null;

  // money — every amount stored in CENTS of the named currency, matching
  // the convention in formatCents() and the rest of Kaya.
  amountOriginal: number;
  currencyOriginal: string;        // ISO 4217 ('TZS', 'USD', 'KES'…)
  fxRate: number;                  // locked at entry; original × fxRate = household
  amountHousehold: number;
  monthlyEquivalent: number;

  // frequency
  frequency: SubscriptionFrequency;
  customMonths: number | null;
  nextBillingDate: Timestamp;
  startedOn: Timestamp;
  endedOn: Timestamp | null;

  // people
  accountHolderUid: string;
  beneficiaryUids: string[];
  paymentMethodId: string;

  // links
  vendorSupplierId: string | null;     // → /families/{f}/suppliers/{id}
  linkedWealthAssetId: string | null;  // → /families/{f}/wealth_assets/{id} (Property only)
  sourceModule: SubscriptionSourceModule;
  isProfessionalExpense: boolean;

  // reminders (Manual subs only)
  reminderDaysBefore: number[];
  postDueCheckEnabled: boolean;
  utilisationCheckDays: number;

  // receipts (Phase 1: Property only)
  hasReceipt: boolean;
  receiptCount: number;

  // audit
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
}

const subsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'subscriptions');

/** Subscribe to all subscriptions for a family. Sort is client-side
 *  (next billing date ASC) — the list is tiny per family and avoiding
 *  an orderBy means no composite index needed for the read. Matches the
 *  pattern in lib/utilityMeters.ts. */
export function subscribeToSubscriptions(
  familyId: string,
  cb: (subs: Subscription[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    subsCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Subscription));
      list.sort((a, b) => {
        const at = a.nextBillingDate?.toMillis?.() ?? 0;
        const bt = b.nextBillingDate?.toMillis?.() ?? 0;
        return at - bt;
      });
      cb(list);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[subscriptions] subscribe failed:', err);
      cb([]);
    },
  );
}

export async function listSubscriptions(familyId: string): Promise<Subscription[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(subsCol(familyId));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Subscription));
}
