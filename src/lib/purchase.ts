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

/** Which Household module the request belongs to. Step 1 is pantry only;
 *  external + utilities land later and will write into the same shape. */
export type PurchaseModule = 'pantry';

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

/** Create a draft request. Returns the new id. */
export async function createDraftRequest(
  familyId: string,
  args: {
    name: string;
    createdBy: string;
    createdByRole: 'parent' | 'helper';
    items?: PurchaseRequestItem[];
  },
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const items = args.items ?? [];
  const ref = await addDoc(requestCol(familyId), {
    name: args.name,
    status: 'draft' as PurchaseRequestStatus,
    module: 'pantry' as PurchaseModule,
    items,
    estimatedTotalCents: sumEstimated(items),
    createdAt: serverTimestamp(),
    createdBy: args.createdBy,
    createdByRole: args.createdByRole,
  });
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
