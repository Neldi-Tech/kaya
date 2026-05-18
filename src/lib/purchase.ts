// Household · Purchase v1 data layer.
//
// One collection:
//   families/{f}/purchaseRequests/{id} — a request that walks through
//       draft → pending_approval → approved → reconciling → closed
//       (or rejected). Line items live as an array on the doc, in the
//       same style as `families/{f}/groceryLists/{id}.items[]`.
//
// Coexists with `groceryLists` rather than replacing it; the old List
// flow keeps working while Purchase becomes the surface that actually
// debits the household Budget. On reconcile we write back to the
// matching `Staple` doc (`lastBoughtAt`, `lastBoughtCents`) so the
// Pantry browse can render "Last bought Nd ago" + the Wink chip.
//
// Quick-add at the basket creates a Staple with `status: 'pending_promote'`
// so a parent can review + promote it from Settings → Catalogue later.

import {
  collection, doc, addDoc, updateDoc, getDoc,
  query, where, orderBy, Timestamp, serverTimestamp,
  onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { StapleCategory } from './pantry';

// ── Types ────────────────────────────────────────────────────────

/** Lifecycle states a purchase request walks through.
 *
 *  draft            — helper or parent still composing; private to creator
 *  pending_approval — sent to parent(s); awaiting nod
 *  approved         — parent approved; helper can go shop
 *  rejected         — parent rejected (terminal, with note)
 *  reconciling      — helper entering actuals against the approved basket
 *  closed           — reconciled; totals frozen, posted to budget
 */
export type PurchaseRequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'reconciling'
  | 'closed';

/** Which Household module the request belongs to.
 *    pantry  — groceries / staples
 *    outdoor — garden, pool, kuku, pets, repairs (Gardener-scoped)
 *    drivers — vehicle fuel + service + spare parts (Driver-scoped)
 *    utility — electricity / water / internet top-ups + bill payments
 *    payroll — helper-private: advances + loans tied to the helper's
 *              `helperUid` field on the request, parent-only approval
 *  All five modules share the `purchaseRequests` collection;
 *  `module` discriminates the surface. */
export type PurchaseModule = 'pantry' | 'outdoor' | 'drivers' | 'utility' | 'payroll';

/** Categories specific to the Outdoor module. Used in the catalogue
 *  picker + Quick-add form. Tags `module: 'outdoor'` on the underlying
 *  Staple doc so the picker can filter cleanly. (Vehicle moved to the
 *  new Drivers module — it's a Driver's day-to-day, not a Gardener's.) */
export type OutdoorCategory =
  | 'garden' | 'pool' | 'kuku' | 'pets' | 'repairs' | 'other';

export const OUTDOOR_CATEGORIES: { id: OutdoorCategory; emoji: string; label: string }[] = [
  { id: 'garden',  emoji: '🌿', label: 'Garden' },
  { id: 'pool',    emoji: '🏊', label: 'Pool' },
  { id: 'kuku',    emoji: '🐔', label: 'Kuku' },
  { id: 'pets',    emoji: '🐱', label: 'Pets' },
  { id: 'repairs', emoji: '🔧', label: 'Repairs' },
  { id: 'other',   emoji: '📦', label: 'Other' },
];

/** Categories specific to the Drivers module. */
export type DriversCategory =
  | 'fuel' | 'service' | 'parts' | 'wash' | 'tolls' | 'other';

export const DRIVERS_CATEGORIES: { id: DriversCategory; emoji: string; label: string }[] = [
  { id: 'fuel',    emoji: '⛽',  label: 'Fuel' },
  { id: 'service', emoji: '🛠️',  label: 'Service' },
  { id: 'parts',   emoji: '🔩',  label: 'Spare parts' },
  { id: 'wash',    emoji: '🧽',  label: 'Car wash' },
  { id: 'tolls',   emoji: '🛣️',  label: 'Tolls / parking' },
  { id: 'other',   emoji: '📦',  label: 'Other' },
];

/** Categories specific to the Utility module. */
export type UtilityRequestCategory =
  | 'electricity' | 'water' | 'internet' | 'gas' | 'tv' | 'security' | 'rent' | 'other';

export const UTILITY_REQUEST_CATEGORIES: { id: UtilityRequestCategory; emoji: string; label: string }[] = [
  { id: 'electricity', emoji: '⚡', label: 'Electricity' },
  { id: 'water',       emoji: '💧', label: 'Water' },
  { id: 'internet',    emoji: '📶', label: 'Internet' },
  { id: 'gas',         emoji: '🔥', label: 'Gas' },
  { id: 'tv',          emoji: '📺', label: 'TV / streaming' },
  { id: 'security',    emoji: '🛡️', label: 'Security' },
  { id: 'rent',        emoji: '🏠', label: 'Rent' },
  { id: 'other',       emoji: '📦', label: 'Other' },
];

/** Categories specific to the Payroll module. Self-service: the
 *  helper themselves creates these, parents approve. */
export type PayrollCategory = 'advance' | 'loan' | 'bonus' | 'reimbursement';

export const PAYROLL_CATEGORIES: { id: PayrollCategory; emoji: string; label: string }[] = [
  { id: 'advance',       emoji: '💵', label: 'Salary advance' },
  { id: 'loan',          emoji: '🏦', label: 'Loan' },
  { id: 'bonus',         emoji: '🎁', label: 'Bonus' },
  { id: 'reimbursement', emoji: '↩️', label: 'Reimbursement' },
];

/** Module → emoji + label shortcuts for consistent branding across
 *  pickers, tab bars, Finances roll-up, etc. */
export const MODULE_EMOJI: Record<PurchaseModule, string> = {
  pantry:  '🛒',
  outdoor: '🌿',
  drivers: '🚗',
  utility: '⚡',
  payroll: '🤝',
};

export const MODULE_LABEL: Record<PurchaseModule, string> = {
  pantry:  'Pantry',
  outdoor: 'Outdoor',
  drivers: 'Drivers',
  utility: 'Utilities',
  payroll: 'Payroll',
};

export interface PurchaseRequestItem {
  /** Stable client-assigned id within the request (crypto.randomUUID). */
  id: string;
  /** Source staple. Null when the row was quick-added at the shop. */
  stapleId?: string;
  name: string;
  category?: StapleCategory;
  /** Estimated qty at request time. */
  qty: number;
  unit: string;
  /** Estimated cost per the catalogue snapshot, in display-currency cents. */
  estimatedCents?: number;
  /** True when the row is a quick-added item whose Staple is still
   *  `status: 'pending_promote'`. Drives the greyed UI everywhere. */
  pendingPromote?: boolean;
  /** Filled during reconcile. Both editable by the helper. */
  actualQty?: number;
  actualCents?: number;
}

export interface PurchaseRequest {
  id: string;
  /** Human label, e.g. "Sunday shop". Defaults to the date if empty. */
  name: string;
  status: PurchaseRequestStatus;
  module: PurchaseModule;
  items: PurchaseRequestItem[];
  /** Sum of `qty * estimatedCents` at send time. */
  estimatedTotalCents: number;
  /** Sum of `actualQty * actualCents` after reconcile. */
  actualTotalCents?: number;
  /** Helper's note travelling with the request. */
  note?: string;
  /** Receipt photo url uploaded during reconcile. */
  receiptUrl?: string;
  /** Free-text reason if status === 'rejected'. */
  rejectionNote?: string;

  createdAt: Timestamp;
  createdBy: string;
  createdByRole: 'parent' | 'helper';
  updatedAt?: Timestamp;

  /** For Payroll requests — the helper this request is FOR (not just
   *  who created it). Helpers see only payroll requests where
   *  `helperUid === their own uid`; parents see all. For non-payroll
   *  modules this field is unused. */
  helperUid?: string;

  /** For Utility requests — which meter this request is for.
   *  Pinned at draft creation via the meter picker on /pantry/utility.
   *  Finances rolls up per-meter consumption via this field. Unused
   *  for non-utility modules. */
  meterId?: string;

  sentAt?: Timestamp;
  /** Array so the upcoming "Both parents must approve" mode (step 2 of
   *  the build) can require length === 2 without a schema change. */
  approvedBy?: string[];
  approvedAt?: Timestamp;
  rejectedBy?: string;
  rejectedAt?: Timestamp;
  reconciledAt?: Timestamp;
  closedAt?: Timestamp;
}

// ── Path helpers ─────────────────────────────────────────────────

const requestCol = (familyId: string) =>
  collection(db, 'families', familyId, 'purchaseRequests');

const requestDoc = (familyId: string, id: string) =>
  doc(db, 'families', familyId, 'purchaseRequests', id);

// ── Read ─────────────────────────────────────────────────────────

/** Subscribe to every open request (anything that isn't closed/rejected),
 *  newest first. Used by the Purchase home view. */
export function subscribeToOpenRequests(
  familyId: string,
  cb: (requests: PurchaseRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('status', 'in', ['draft', 'pending_approval', 'approved', 'reconciling']),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest)));
  });
}

/** Subscribe to recently closed (or rejected) requests — feeds the
 *  "Recent" tab on the Purchase home and the Finances ledger. */
export function subscribeToRecentRequests(
  familyId: string,
  cb: (requests: PurchaseRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('status', 'in', ['closed', 'rejected']),
    orderBy('closedAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest)));
  });
}

/** Subscribe to payroll requests pinned to a specific helper.
 *  Required by the v3 confidentiality rule — helpers can only read
 *  payroll docs where `helperUid == their own uid`, so the query
 *  itself MUST include that where-clause or Firestore returns
 *  permission_denied on the whole result set.
 *
 *  Parents should keep using `subscribeToOpenRequests` /
 *  `subscribeToRecentRequests` and filter by `module === 'payroll'`
 *  client-side — they're allowed to read all payroll docs.
 *
 *  `bucket: 'open'` returns drafts / pending / approved / reconciling
 *  ordered by createdAt; `bucket: 'recent'` returns closed / rejected
 *  ordered by closedAt. */
export function subscribeToPayrollForHelper(
  familyId: string,
  helperUid: string,
  bucket: 'open' | 'recent',
  cb: (requests: PurchaseRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const statuses = bucket === 'open'
    ? ['draft', 'pending_approval', 'approved', 'reconciling']
    : ['closed', 'rejected'];
  const orderField = bucket === 'open' ? 'createdAt' : 'closedAt';
  const q = query(
    requestCol(familyId),
    where('helperUid', '==', helperUid),
    where('status', 'in', statuses),
    orderBy(orderField, 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest)));
  });
}

/** Subscribe to a single request by id. */
export function subscribeToRequest(
  familyId: string,
  requestId: string,
  cb: (request: PurchaseRequest | null) => void,
): () => void {
  if (isGuestActive()) {
    cb(null);
    return () => {};
  }
  return onSnapshot(requestDoc(familyId, requestId), (snap) => {
    if (!snap.exists()) { cb(null); return; }
    cb({ id: snap.id, ...snap.data() } as PurchaseRequest);
  });
}

// ── Write ────────────────────────────────────────────────────────

/** Create a draft request. Returns the new id. Module defaults to
 *  'pantry' so existing callers don't need to pass it. For Payroll,
 *  pass `helperUid` (scoping + rule); for Utility, pass `meterId`
 *  (which meter the request is for). */
export async function createDraftRequest(
  familyId: string,
  args: {
    name: string;
    createdBy: string;
    createdByRole: 'parent' | 'helper';
    module?: PurchaseModule;
    items?: PurchaseRequestItem[];
    helperUid?: string;
    meterId?: string;
  },
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const items = args.items ?? [];
  const payload: Record<string, unknown> = {
    name: args.name,
    status: 'draft' as PurchaseRequestStatus,
    module: (args.module ?? 'pantry') as PurchaseModule,
    items,
    estimatedTotalCents: sumEstimated(items),
    createdAt: serverTimestamp(),
    createdBy: args.createdBy,
    createdByRole: args.createdByRole,
  };
  if (args.helperUid) payload.helperUid = args.helperUid;
  if (args.meterId) payload.meterId = args.meterId;
  const ref = await addDoc(requestCol(familyId), payload);
  return ref.id;
}

/** Patch the items array (drafts + reconciling). Recomputes the
 *  appropriate total in the same write so the home + budget views
 *  don't have to sum on read. */
export async function updateRequestItems(
  familyId: string,
  requestId: string,
  items: PurchaseRequestItem[],
  mode: 'estimated' | 'actual',
): Promise<void> {
  if (isGuestActive()) return;
  const patch: Record<string, unknown> = {
    items,
    updatedAt: serverTimestamp(),
  };
  if (mode === 'estimated') patch.estimatedTotalCents = sumEstimated(items);
  else patch.actualTotalCents = sumActual(items);
  await updateDoc(requestDoc(familyId, requestId), patch);
}

/** Rename + edit metadata on a draft. */
export async function updateRequestMeta(
  familyId: string,
  requestId: string,
  patch: { name?: string; note?: string },
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(requestDoc(familyId, requestId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

/** Move a draft to pending_approval. */
export async function sendForApproval(
  familyId: string,
  requestId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'pending_approval' as PurchaseRequestStatus,
    sentAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Append `approverUid` to `approvedBy` and conditionally flip status
 *  to `approved` based on the family's approval mode.
 *
 *   'either' — flips to approved on the first approver.
 *   'both'   — needs at least 2 distinct parent UIDs; stays in
 *              `pending_approval` after the first approver.
 *
 *  The caller passes the mode (read from FamilyContext) so we avoid
 *  a round-trip getDoc on every approve. Duplicate approves by the
 *  same parent are no-ops (the uid won't be re-added). */
export async function approveRequest(
  familyId: string,
  requestId: string,
  approverUid: string,
  mode: 'either' | 'both' = 'either',
): Promise<{ status: PurchaseRequestStatus; approvers: number }> {
  if (isGuestActive()) return { status: 'approved', approvers: 1 };
  const snap = await getDoc(requestDoc(familyId, requestId));
  if (!snap.exists()) throw new Error('Request not found');
  const data = snap.data() as PurchaseRequest;
  const existing = Array.isArray(data.approvedBy) ? data.approvedBy : [];
  const approvers = existing.includes(approverUid)
    ? existing
    : [...existing, approverUid];
  const meetsThreshold = mode === 'either'
    ? approvers.length >= 1
    : approvers.length >= 2;
  const nextStatus: PurchaseRequestStatus = meetsThreshold ? 'approved' : 'pending_approval';
  const patch: Record<string, unknown> = {
    approvedBy: approvers,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  };
  if (meetsThreshold) patch.approvedAt = serverTimestamp();
  await updateDoc(requestDoc(familyId, requestId), patch);
  return { status: nextStatus, approvers: approvers.length };
}

/** Parent rejects with an optional note. Terminal — no resubmit in v1
 *  (the helper just creates a new draft). */
export async function rejectRequest(
  familyId: string,
  requestId: string,
  rejecterUid: string,
  note?: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'rejected' as PurchaseRequestStatus,
    rejectedBy: rejecterUid,
    rejectedAt: serverTimestamp(),
    rejectionNote: note ?? '',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Helper flips the approved request into reconcile mode. */
export async function startReconcile(
  familyId: string,
  requestId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'reconciling' as PurchaseRequestStatus,
    updatedAt: serverTimestamp(),
  });
}

/** Close a reconciled request. Writes back to each Staple's
 *  `lastBoughtAt` + `lastBoughtCents` in the same batch so the Pantry
 *  signals (Last bought, Wink) reflect the latest shop atomically. */
export async function closeReconcile(
  familyId: string,
  requestId: string,
  items: PurchaseRequestItem[],
  receiptUrl?: string,
): Promise<void> {
  if (isGuestActive()) return;
  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(requestDoc(familyId, requestId), {
    status: 'closed' as PurchaseRequestStatus,
    items,
    actualTotalCents: sumActual(items),
    receiptUrl: receiptUrl ?? '',
    reconciledAt: now,
    closedAt: now,
    updatedAt: now,
  });
  // Pantry write-back: for every line that mapped to a real staple,
  // stamp the per-unit actual price + when it was bought. Quick-added
  // rows (no stapleId, still pending_promote) are skipped until a
  // parent promotes them in Settings → Catalogue.
  for (const item of items) {
    if (!item.stapleId) continue;
    if (item.actualCents == null || item.actualQty == null) continue;
    if (item.actualQty <= 0) continue;
    const perUnit = Math.round(item.actualCents / item.actualQty);
    batch.update(
      doc(db, 'families', familyId, 'staples', item.stapleId),
      { lastBoughtCents: perUnit, lastBoughtAt: now, updatedAt: now },
    );
  }
  await batch.commit();
}

/** Discard a draft (creator-only in v1; rule will gate). */
export async function discardDraft(
  familyId: string,
  requestId: string,
): Promise<void> {
  if (isGuestActive()) return;
  const snap = await getDoc(requestDoc(familyId, requestId));
  if (!snap.exists()) return;
  if ((snap.data().status as PurchaseRequestStatus) !== 'draft') return;
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'rejected' as PurchaseRequestStatus,
    rejectionNote: 'Discarded by creator',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ── Pure helpers ─────────────────────────────────────────────────

export function sumEstimated(items: PurchaseRequestItem[]): number {
  return items.reduce((acc, i) => {
    if (i.estimatedCents == null) return acc;
    return acc + i.estimatedCents * i.qty;
  }, 0);
}

export function sumActual(items: PurchaseRequestItem[]): number {
  return items.reduce((acc, i) => {
    if (i.actualCents == null || i.actualQty == null) return acc;
    return acc + i.actualCents * i.actualQty;
  }, 0);
}

/** Variance between estimated and actual totals as a signed fraction.
 *  Positive = over budget, negative = under. Returns 0 when est is 0. */
export function variancePct(req: PurchaseRequest): number {
  const est = req.estimatedTotalCents;
  const act = req.actualTotalCents ?? 0;
  if (!est) return 0;
  return (act - est) / est;
}

export const STATUS_LABEL: Record<PurchaseRequestStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved · ready to shop',
  rejected: 'Rejected',
  reconciling: 'Reconciling',
  closed: 'Closed',
};
