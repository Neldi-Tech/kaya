// Household · Spend ledger data layer (client-side read only).
//
// Unified ledger across Subscriptions + Contributions (+ future Budget).
// Entries are written EXCLUSIVELY by API routes via the Admin SDK
// (/api/contributions/create and, in P3, /api/subscriptions/cycle/close).
// Clients never write — Firestore rules deny client writes.
//
// Schema docs:
//   Kaya Contributions and Subscrition in Budgets/
//     Kaya-Subscriptions-Contributions_Schema_2026-05-27.md §1.7

import {
  collection, getDocs, query, where, orderBy, limit as qlimit,
  Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type SpendLedgerSourceModule = 'subscriptions' | 'contributions';

export interface SpendLedgerEntry {
  id: string;
  sourceModule: SpendLedgerSourceModule;
  sourceId: string;
  cycleId: string | null;

  category: string;
  subCategory: string;

  amountHousehold: number;
  amountOriginal: number;
  currencyOriginal: string;
  fxRateUsed: number;
  monthlyEquivalent: number;
  recurring: boolean;

  occurredOn: Timestamp;
  bookedOn: Timestamp;

  accountHolderUid: string;
  recipientPageId: string | null;
  taxDeductible: boolean;
  isProfessionalExpense: boolean;
}

const ledgerCol = (familyId: string) =>
  collection(db, 'families', familyId, 'spend_ledger');

/** Subscribe to the spend ledger ordered by occurredOn DESC.
 *  Uses an orderBy + limit query — the (familyId, occurredOn DESC) index
 *  is a single-field index auto-created by Firestore, so no composite
 *  declaration is needed for this read. */
export function subscribeToSpendLedger(
  familyId: string,
  cb: (entries: SpendLedgerEntry[]) => void,
  opts: { maxEntries?: number } = {},
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    ledgerCol(familyId),
    orderBy('occurredOn', 'desc'),
    qlimit(opts.maxEntries ?? 200),
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as SpendLedgerEntry)));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[spendLedger] subscribe failed:', err);
      cb([]);
    },
  );
}

/** One-shot read for module-scoped roll-ups (e.g. only contributions for
 *  the YTD donut). Uses the (sourceModule, occurredOn DESC) composite
 *  index declared in firestore.indexes.json. */
export async function listLedgerForModule(
  familyId: string,
  sourceModule: SpendLedgerSourceModule,
  opts: { sinceMillis?: number; maxEntries?: number } = {},
): Promise<SpendLedgerEntry[]> {
  if (isGuestActive()) return [];
  const constraints: Parameters<typeof query>[1][] = [
    where('sourceModule', '==', sourceModule),
  ];
  if (opts.sinceMillis != null) {
    constraints.push(where('occurredOn', '>=', Timestamp.fromMillis(opts.sinceMillis)));
  }
  constraints.push(orderBy('occurredOn', 'desc'));
  constraints.push(qlimit(opts.maxEntries ?? 500));
  const q = query(ledgerCol(familyId), ...constraints);
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as SpendLedgerEntry));
}
