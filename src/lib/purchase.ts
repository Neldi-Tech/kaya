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
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc,
  query, where, orderBy, Timestamp, serverTimestamp,
  onSnapshot, writeBatch, increment, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { StapleCategory } from './pantry';
import { stapleNamesOverlap } from './pantry';

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

/** Short module code used in the auto-generated request name +
 *  serial pill. 2026-05-18 (Elia: structured naming proposal).
 *  Format: `{MODULE_CODE}-{0042} · {DDMMYY}( · {context})?`
 *  e.g. `PNT-0042 · 180526 · Diana's RAV4` for a Drivers request
 *  pinned to a vehicle. Three letters chosen for compact scanning
 *  on mobile + so the pill stays under ~10 chars. */
export const MODULE_CODE: Record<PurchaseModule, string> = {
  pantry:  'PNT',
  outdoor: 'OUT',
  drivers: 'CAR',
  utility: 'UTL',
  payroll: 'PAY',
};

/** Compact date for request names: 18-May-2026 → `180526` (DDMMYY).
 *  Date-with-separators lives in toDisplayDate (universal planning);
 *  this stripped form keeps the request name short on a mobile chip. */
export function formatCompactDate(d: Date = new Date()): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${dd}${mm}${yy}`;
}

/** Render the serial portion alone: `PNT-0042`. Used by the detail-
 *  page pill so the audit reference stays visible even after a
 *  parent renames the request. */
export function formatRequestSeq(module: PurchaseModule, seq: number): string {
  return `${MODULE_CODE[module]}-${String(seq).padStart(4, '0')}`;
}

/** Compose the full auto-name: serial · compact-date (· context).
 *  Context = the module-specific pin: vehicle label / meter label /
 *  helper name / (none for Pantry + Outdoor). */
export function buildAutoRequestName(
  module: PurchaseModule,
  seq: number,
  date: Date,
  context?: string,
): string {
  const parts = [formatRequestSeq(module, seq), formatCompactDate(date)];
  const ctx = context?.trim();
  if (ctx) parts.push(ctx);
  return parts.join(' · ');
}

export interface PurchaseRequestItem {
  /** Stable client-assigned id within the request (crypto.randomUUID). */
  id: string;
  /** Source staple. Null when the row was quick-added at the shop. */
  stapleId?: string;
  name: string;
  /** Optional secondary / local-language name (snapshot from the
   *  staple at add time). Mirrors Staple.name2 — helpers see this as
   *  the primary label, parents see it muted below. 2026-05-18. */
  name2?: string;
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

  /** For Drivers requests — which vehicle this request is for
   *  (2026-05-18). Pinned at draft creation via the vehicle picker
   *  on /pantry/drivers. Finances rolls up per-vehicle spend via
   *  this field. Unused for non-drivers modules. */
  vehicleId?: string;

  /** Per-family, per-module sequence number (1, 2, 3, ...).
   *  Combined with MODULE_CODE renders as `PNT-0042`. Never resets.
   *  Survives rename — even if the parent edits the name, the seq
   *  stays for audit. Added 2026-05-18 (Elia's naming proposal). */
  seq?: number;

  /** Set on requests generated by the payroll automation system
   *  (2026-05-19). When true, the detail page renders the
   *  payrollCycle breakdown + the close-reconcile step decrements
   *  any deductions on the helper's payrollConfig. */
  generatedBy?: 'system';

  /** Pay-cycle breakdown for system-generated payroll requests.
   *  Stored so the request reads transparently ("Basic 32h ×
   *  TZS 3,000 = TZS 96,000 + transport TZS 10,000 − loan repay
   *  TZS 20,000 = NET TZS 86,000"). Items array still carries the
   *  line-by-line for cap calc + reconcile. */
  payrollCycle?: {
    basis: 'hourly' | 'daily' | 'monthly';
    /** For hourly: total approved hours in the period. */
    hours?: number;
    /** For daily: total approved days in the period. */
    daysWorked?: number;
    basicCents: number;
    allowancesCents: number;
    deductionsCents: number;
    netCents: number;
    /** Inclusive ISO range covered by this cycle. */
    periodStart: string;
    periodEnd: string;
    /** Which deduction sources contributed — used to decrement
     *  their balances on close-reconcile. */
    deductionRefs: string[];
  };

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

/** Reusable basket template (2026-05-18). Auto-saved on every
 *  approve/reject so parents can quickly re-issue a similar basket
 *  next week without re-typing every line. Upserted by (module,
 *  lowercased name) so "Monday shop" always points to the most
 *  recent Monday shop's basket — using it again loads what you last
 *  approved, not a forgotten version from three months ago.
 *
 *  Items snapshot: the basket exactly as it was at resolve time
 *  (post any parent qty/price fix during approval), with the same
 *  PurchaseRequestItem shape. When loaded into a new draft, items
 *  are deep-cloned with fresh client-side ids; actualQty/actualCents
 *  are stripped (they belong to the original purchase, not the new
 *  one). */
export interface PurchaseTemplate {
  id: string;
  module: PurchaseModule;
  /** Display name — defaults to the source request's name. Parent
   *  can rename later if we ship a Templates management page. */
  name: string;
  items: PurchaseRequestItem[];
  /** The request this snapshot was taken from. Useful for
   *  "open the original" deep-link in a future iteration. */
  sourceRequestId: string;
  /** Whether the source was approved or rejected. Approved templates
   *  are the typical reuse case; rejected ones are still useful to
   *  the helper for a quick "fix the issue + resend" workflow. */
  sourceStatus: 'approved' | 'rejected';
  /** Sum of qty × estimatedCents at template creation — saved so
   *  the picker can preview "~ TZS 95,000" without re-summing. */
  estimatedTotalCents: number;
  createdAt: Timestamp;
  createdBy: string;
  useCount: number;
  lastUsedAt?: Timestamp;
}

// ── Path helpers ─────────────────────────────────────────────────

const requestCol = (familyId: string) =>
  collection(db, 'families', familyId, 'purchaseRequests');

const templateCol = (familyId: string) =>
  collection(db, 'families', familyId, 'purchaseTemplates');

const templateDoc = (familyId: string, id: string) =>
  doc(db, 'families', familyId, 'purchaseTemplates', id);

/** True when `name` matches the auto-generated request-name pattern
 *  for `module` (e.g. "PNT-0042 · 180526" or "CAR-0008 · 180526 ·
 *  Diana's RAV4"). We treat anything starting with `{CODE}-{digits}`
 *  as auto-named for template-canonicalisation purposes — even if
 *  the parent appended a small note after, it's still recognisably
 *  derived from the auto-name. */
export function isAutoRequestName(name: string, module: PurchaseModule): boolean {
  return new RegExp(`^${MODULE_CODE[module]}-\\d{1,6}\\b`).test(name.trim());
}

/** Canonical template name for a request — used so multiple requests
 *  that share the same auto-name pattern (PNT-0042, PNT-0043, …)
 *  collapse into ONE template per module, while parent-renamed
 *  baskets get their own template per rename. 2026-05-18. */
export function canonicalTemplateName(module: PurchaseModule, requestName: string): string {
  if (isAutoRequestName(requestName, module)) {
    // "Standard Pantry basket" / "Standard Outdoor basket" / etc.
    return `Standard ${MODULE_LABEL[module]} basket`;
  }
  return requestName.trim();
}

/** Deterministic doc id so (module, canonical-name) upserts. Avoids
 *  having to query before write. Same input → same id every time.
 *  Canonical name strips the auto-name serial so weekly auto-named
 *  requests share one template (see canonicalTemplateName). */
function templateKey(module: PurchaseModule, requestName: string): string {
  const canonical = canonicalTemplateName(module, requestName);
  const slug = canonical.toLowerCase()
    .replace(/[^\w\s-]/g, '')   // strip punctuation
    .replace(/\s+/g, '-')        // collapse whitespace
    .replace(/-+/g, '-')         // collapse dashes
    .slice(0, 60);
  return `${module}--${slug || 'untitled'}`;
}

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

/** Atomically allocate the next per-module sequence number for a
 *  family. Lives at families/{f}/counters/purchaseRequests-{module}
 *  with a single `nextSeq` field. Transactional so two concurrent
 *  createDraftRequest calls (e.g. parent + helper at the same time)
 *  can't collide. Returns the seq just allocated. */
async function nextRequestSeq(familyId: string, module: PurchaseModule): Promise<number> {
  if (isGuestActive()) return 1;
  const counterRef = doc(
    db, 'families', familyId, 'counters', `purchaseRequests-${module}`,
  );
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const current = snap.exists() ? Number((snap.data() as { nextSeq?: number }).nextSeq ?? 0) : 0;
    const next = current + 1;
    if (snap.exists()) {
      tx.update(counterRef, { nextSeq: next, updatedAt: serverTimestamp() });
    } else {
      tx.set(counterRef, { nextSeq: next, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
    }
    return next;
  });
  return seq;
}

/** Create a draft request. Returns the new id. Module defaults to
 *  'pantry' so existing callers don't need to pass it.
 *
 *  Naming (2026-05-18 — Elia's structured-naming proposal): callers
 *  can either pass `name` explicitly (e.g. when cloning from a
 *  template, the template's name is reused) OR pass `context` and
 *  let the system compose `MOD-NNNN · DDMMYY · {context}` from the
 *  next allocated seq + today's date + the context string. Context
 *  is the module-specific pin (vehicle / meter / helper) and is
 *  omitted from the name when absent.
 *
 *  For Payroll, pass `helperUid` (scoping + rule). For Utility, pass
 *  `meterId`. For Drivers, pass `vehicleId`. */
export async function createDraftRequest(
  familyId: string,
  args: {
    /** Explicit name override. If omitted, an auto-name is built
     *  from MODULE_CODE + seq + DDMMYY + context. */
    name?: string;
    /** Module-specific pin label appended to the auto-name (vehicle
     *  label / meter label / helper name). Ignored when `name` is
     *  given explicitly. */
    context?: string;
    createdBy: string;
    createdByRole: 'parent' | 'helper';
    module?: PurchaseModule;
    items?: PurchaseRequestItem[];
    helperUid?: string;
    meterId?: string;
    vehicleId?: string;
    /** System-generated payroll requests skip 'draft' and land
     *  directly in 'pending_approval' (parents review the auto-
     *  computed paystub). Set `initialStatus: 'pending_approval'`
     *  + `generatedBy: 'system'` for these. */
    initialStatus?: PurchaseRequestStatus;
    generatedBy?: 'system';
    /** Payroll cycle breakdown — set together with `module: 'payroll'`
     *  + generatedBy. The detail page renders it as a paystub. */
    payrollCycle?: PurchaseRequest['payrollCycle'];
  },
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const module = (args.module ?? 'pantry') as PurchaseModule;
  const items = args.items ?? [];
  // Allocate seq first so we have it for the auto-name. If the
  // caller passed an explicit name, we still allocate + store seq
  // so the audit pill renders consistently across renamed requests.
  const seq = await nextRequestSeq(familyId, module);
  const finalName = (args.name && args.name.trim())
    ? args.name.trim()
    : buildAutoRequestName(module, seq, new Date(), args.context);
  const payload: Record<string, unknown> = {
    name: finalName,
    seq,
    status: (args.initialStatus ?? 'draft') as PurchaseRequestStatus,
    module,
    items,
    estimatedTotalCents: sumEstimated(items),
    createdAt: serverTimestamp(),
    createdBy: args.createdBy,
    createdByRole: args.createdByRole,
  };
  if (args.helperUid) payload.helperUid = args.helperUid;
  if (args.meterId) payload.meterId = args.meterId;
  if (args.vehicleId) payload.vehicleId = args.vehicleId;
  if (args.generatedBy) payload.generatedBy = args.generatedBy;
  if (args.payrollCycle) payload.payrollCycle = args.payrollCycle;
  if (args.initialStatus === 'pending_approval') payload.sentAt = serverTimestamp();
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

// ── Templates ────────────────────────────────────────────────────

/** Snapshot a resolved request into the family's template library so
 *  a similar basket can be re-created in one tap next time. Upserts
 *  by (module, name) — running "Monday shop" 50 weeks in a row keeps
 *  the templates list to one row that always reflects the latest
 *  approved basket. Best-effort: returns silently on any failure so
 *  it never breaks the user-visible approve/reject path. */
export async function saveTemplateFromRequest(
  familyId: string,
  request: PurchaseRequest,
  byUid: string,
  sourceStatus: 'approved' | 'rejected',
): Promise<void> {
  if (isGuestActive()) return;
  try {
    const id = templateKey(request.module, request.name);
    const items = (request.items ?? []).map((i) => ({
      ...i,
      // Drop reconcile-time fields — they belong to the original
      // shop, not a future reuse.
      actualQty: undefined,
      actualCents: undefined,
      pendingPromote: undefined,
    } as PurchaseRequestItem));
    // Display name on the template = canonical name. For auto-named
    // requests this collapses to "Standard {Module} basket" so the
    // picker shows one stable entry per module instead of dozens of
    // "PNT-0042 · 180526" / "PNT-0043 · 180526" entries.
    const displayName = canonicalTemplateName(request.module, request.name);
    await setDoc(templateDoc(familyId, id), {
      module: request.module,
      name: displayName,
      items,
      sourceRequestId: request.id,
      sourceStatus,
      estimatedTotalCents: sumEstimated(items),
      createdAt: serverTimestamp(),
      createdBy: byUid,
      useCount: 0,
    }, { merge: false });  // upsert: latest snapshot wins
  } catch {
    // Swallow. Template auto-save is a nice-to-have; it must never
    // bubble up and fail the parent's approve/reject click.
  }
}

/** Subscribe to all templates for a family, scoped to one module.
 *  Newest first by createdAt — picker shows "most recent shops" up
 *  top, which is usually what users want. */
export function subscribeToTemplates(
  familyId: string,
  module: PurchaseModule,
  cb: (templates: PurchaseTemplate[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    templateCol(familyId),
    where('module', '==', module),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseTemplate)));
  });
}

/** Create a fresh draft from a template snapshot. Increments the
 *  template's useCount + lastUsedAt so the picker can sort by
 *  popularity later. Items are deep-cloned with fresh ids so the
 *  new draft can be edited freely without mutating the template. */
export async function createDraftFromTemplate(
  familyId: string,
  templateId: string,
  args: {
    createdBy: string;
    createdByRole: 'parent' | 'helper';
    /** Optional override — when omitted, the new draft gets a fresh
     *  auto-name (`MOD-NNNN · DDMMYY · context`) instead of inheriting
     *  the template's display name (which would clobber the next
     *  request's name with "Standard Pantry basket"). 2026-05-18. */
    nameOverride?: string;
    /** Module-specific pin label appended to the auto-name (vehicle /
     *  meter / helper). Same semantics as createDraftRequest. */
    context?: string;
    /** Drivers / Utility: pass the vehicle / meter to pin. */
    vehicleId?: string;
    meterId?: string;
    helperUid?: string;
  },
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const snap = await getDoc(templateDoc(familyId, templateId));
  if (!snap.exists()) throw new Error('Template not found');
  const tpl = { id: snap.id, ...snap.data() } as PurchaseTemplate;
  // Clone items with fresh ids so edits to the draft don't touch
  // the template + so the cloned items are independent entities.
  const items: PurchaseRequestItem[] = tpl.items.map((it) => ({
    ...it,
    id: typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto as Crypto).randomUUID()
      : Math.random().toString(36).slice(2, 10),
  }));
  const draftId = await createDraftRequest(familyId, {
    // Pass `name` only when the caller explicitly overrode it.
    // Otherwise let createDraftRequest auto-build the new name from
    // the template's module + a fresh seq + DDMMYY + context.
    name: args.nameOverride,
    context: args.context,
    createdBy: args.createdBy,
    createdByRole: args.createdByRole,
    module: tpl.module,
    items,
    helperUid: args.helperUid,
    meterId: args.meterId,
    vehicleId: args.vehicleId,
  });
  // Best-effort usage stamp — failure here is fine, the draft is
  // already created and the user can proceed.
  try {
    await updateDoc(templateDoc(familyId, templateId), {
      useCount: increment(1),
      lastUsedAt: serverTimestamp(),
    });
  } catch { /* noop */ }
  return draftId;
}

/** Remove a template — used by a future Templates management UI. */
export async function deleteTemplate(
  familyId: string,
  templateId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(templateDoc(familyId, templateId));
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
  // 2026-05-18 — every full approval auto-saves the basket as a
  // reusable template (upserted by name + module). Fire-and-forget;
  // any failure is swallowed inside saveTemplateFromRequest so this
  // never breaks the user-visible approve action.
  if (meetsThreshold) {
    const finalReq = { ...data, id: requestId, items: data.items ?? [] } as PurchaseRequest;
    saveTemplateFromRequest(familyId, finalReq, approverUid, 'approved').catch(() => undefined);
  }
  return { status: nextStatus, approvers: approvers.length };
}

/** Parent rejects with an optional note. Terminal — no resubmit in v1
 *  (the helper just creates a new draft, or loads the auto-saved
 *  template, fixes the issue, and resends). */
export async function rejectRequest(
  familyId: string,
  requestId: string,
  rejecterUid: string,
  note?: string,
): Promise<void> {
  if (isGuestActive()) return;
  // Snapshot for the template auto-save BEFORE the status update —
  // we want the basket as the parent saw + edited it.
  const snap = await getDoc(requestDoc(familyId, requestId));
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'rejected' as PurchaseRequestStatus,
    rejectedBy: rejecterUid,
    rejectedAt: serverTimestamp(),
    rejectionNote: note ?? '',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (snap.exists()) {
    const data = { id: requestId, ...snap.data() } as PurchaseRequest;
    saveTemplateFromRequest(familyId, data, rejecterUid, 'rejected').catch(() => undefined);
  }
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
  // Read the request snapshot first so we can pick up payroll fields
  // (deductions to decrement). One getDoc; the batch below is the
  // bulk of the write traffic.
  const reqRef = requestDoc(familyId, requestId);
  const reqSnap = await getDoc(reqRef);
  const reqData = reqSnap.exists() ? (reqSnap.data() as PurchaseRequest) : null;

  const batch = writeBatch(db);
  const now = serverTimestamp();
  batch.update(reqRef, {
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
      {
        lastBoughtCents: perUnit,
        // 2026-05-18 — also capture the actual qty so the Staples
        // commentary can show real "Last: 5 kg × TZS 1,000 = TZS 5,000"
        // instead of guessing from defaultQty.
        lastBoughtQty: item.actualQty,
        lastBoughtAt: now,
        updatedAt: now,
      },
    );
  }
  await batch.commit();

  // v3 — system-generated payroll requests carry a payrollCycle
  // with deductionRefs. After the close succeeds, decrement each
  // referenced deduction's balance on the helper's payrollConfig.
  // Doing this AFTER the batch so a deduction-write failure can't
  // roll back the close (rare, but the close is what matters).
  if (reqData?.generatedBy === 'system' && reqData.payrollCycle && reqData.helperUid) {
    try {
      const { applyDeductionsOnClose } = await import('./payroll');
      await applyDeductionsOnClose(familyId, reqData.helperUid, {
        deductionRefs: reqData.payrollCycle.deductionRefs,
        deductionsCents: reqData.payrollCycle.deductionsCents,
      });
    } catch { /* swallow — deductions can be reconciled manually if this fails */ }
  }
}

// ── Pending-promote workflow (2026-05-18 verification fix) ───────
//
// When a helper quick-adds an item in the basket, two things happen:
//   1. A Staple doc is created with `status: 'pending_promote'` —
//      kept out of the main pickers so half-formed items don't
//      pollute the catalogue.
//   2. The basket line gets `pendingPromote: true` — drives the
//      striped UI + "PENDING" badge.
//
// What was missing until now: a way for the parent to RESOLVE that
// pending state. The intent in the original design was a separate
// "Settings → Catalogue" review screen ("a parent promotes them in
// Settings → Catalogue", per the comment in pantry.ts). Elia's
// verification ask is to close the loop INLINE in the request flow
// — fast + easy, decide while you're approving.
//
// Two resolutions:
//   • promotePendingStaple — staple becomes a real catalogue entry;
//     the basket line stops being pending (no more stripes / badge).
//     Future requests can pick it from the standard picker.
//   • keepAsOneOff — staple doc is deleted (it was a placeholder),
//     the basket line keeps the item as a free-text purchase but no
//     longer carries the pending badge. Nothing pollutes the catalogue.
// Both are batched so the request item update + staple-side change
// stay in sync.

/** Parent says yes — make this a real Staple. The doc's
 *  `pending_promote` status flips to 'active'; the current basket
 *  line's `pendingPromote` flag is removed. The line KEEPS its
 *  stapleId so future basket picks find this staple. */
export async function promotePendingStaple(
  familyId: string,
  args: {
    requestId: string;
    itemId: string;
    stapleId: string;
  },
): Promise<void> {
  if (isGuestActive()) return;
  const reqRef = requestDoc(familyId, args.requestId);
  const stapleRef = doc(db, 'families', familyId, 'staples', args.stapleId);
  // Read current items so we can patch just the one row without
  // racing other concurrent edits.
  const snap = await getDoc(reqRef);
  if (!snap.exists()) return;
  const items = ((snap.data().items as PurchaseRequestItem[]) ?? []).map((i) =>
    i.id === args.itemId
      ? { ...i, pendingPromote: false }
      : i,
  );
  const batch = writeBatch(db);
  batch.update(reqRef, { items, updatedAt: serverTimestamp() });
  batch.update(stapleRef, { status: 'active', updatedAt: serverTimestamp() });
  await batch.commit();
}

/** Parent says no — this is a one-off, not a regular Staple. The
 *  placeholder Staple doc is deleted; the basket line keeps the
 *  item (helper still buys it) but loses its stapleId + pending flag
 *  so it renders as a normal free-text row. */
export async function keepAsOneOff(
  familyId: string,
  args: {
    requestId: string;
    itemId: string;
    stapleId: string;
  },
): Promise<void> {
  if (isGuestActive()) return;
  const reqRef = requestDoc(familyId, args.requestId);
  const stapleRef = doc(db, 'families', familyId, 'staples', args.stapleId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) return;
  const items = ((snap.data().items as PurchaseRequestItem[]) ?? []).map((i) =>
    i.id === args.itemId
      ? { ...i, pendingPromote: false, stapleId: undefined }
      : i,
  );
  const batch = writeBatch(db);
  batch.update(reqRef, { items, updatedAt: serverTimestamp() });
  batch.delete(stapleRef);
  await batch.commit();
}

/** Edit the primary / secondary name of a pending item BEFORE
 *  resolving it (promote / keep one-off). Useful when the helper
 *  typed the local-language name ("Asali") and the parent wants to
 *  rename to the English primary + capture the Swahili as name2 for
 *  the catalogue. 2026-05-18.
 *
 *  Touches both:
 *    • the placeholder Staple doc — so when the parent then promotes,
 *      it lands in the catalogue under the corrected names.
 *    • the basket item snapshot — so the basket reads the corrected
 *      names immediately (no need to re-pick the staple). */
export async function renamePendingItem(
  familyId: string,
  args: {
    requestId: string;
    itemId: string;
    stapleId: string;
    name: string;
    name2?: string;
  },
): Promise<void> {
  if (isGuestActive()) return;
  const trimmedName = args.name.trim();
  const trimmedName2 = args.name2?.trim() || undefined;
  if (!trimmedName) return; // primary name is mandatory
  const reqRef = requestDoc(familyId, args.requestId);
  const stapleRef = doc(db, 'families', familyId, 'staples', args.stapleId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) return;
  const items = ((snap.data().items as PurchaseRequestItem[]) ?? []).map((i) =>
    i.id === args.itemId
      ? { ...i, name: trimmedName, name2: trimmedName2 }
      : i,
  );
  const batch = writeBatch(db);
  batch.update(reqRef, { items, updatedAt: serverTimestamp() });
  // For staple, omit name2 from the payload when empty so we don't
  // store undefined; merge:true keeps untouched fields alone.
  const staplePatch: Record<string, unknown> = {
    name: trimmedName,
    updatedAt: serverTimestamp(),
  };
  staplePatch.name2 = trimmedName2 ?? null;  // null = clear field
  batch.update(stapleRef, staplePatch);
  await batch.commit();
}

/** "Same item already exists" detection. Given a candidate name +
 *  optional name2 + the family's current staples, returns any
 *  existing active staple that overlaps by name or name2 (case-
 *  insensitive, punctuation-stripped). Excludes the candidate's
 *  own stapleId so a pending row doesn't match itself.
 *
 *  Used by the pending-item promote flow to surface a "you already
 *  have this — link to existing?" modal before creating a duplicate
 *  catalogue entry. 2026-05-18. */
export function findStapleConflict(
  staples: { id: string; name: string; name2?: string; status?: string }[],
  candidate: { id: string; name: string; name2?: string },
): { id: string; name: string; name2?: string } | null {
  for (const s of staples) {
    if (s.id === candidate.id) continue;
    if (s.status === 'pending_promote') continue; // ignore other pending rows
    if (stapleNamesOverlap(s, candidate)) return s;
  }
  return null;
}

/** Resolve a pending item by linking it to an EXISTING staple
 *  instead of promoting the placeholder. Used when the cross-check
 *  surfaces a duplicate: parent picks "use existing" and we rewrite
 *  the basket line to point at the canonical staple while deleting
 *  the placeholder. 2026-05-18. */
export async function linkPendingToExisting(
  familyId: string,
  args: {
    requestId: string;
    itemId: string;
    pendingStapleId: string;
    existingStapleId: string;
    existingName: string;
    existingName2?: string;
  },
): Promise<void> {
  if (isGuestActive()) return;
  const reqRef = requestDoc(familyId, args.requestId);
  const pendingRef = doc(db, 'families', familyId, 'staples', args.pendingStapleId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) return;
  const items = ((snap.data().items as PurchaseRequestItem[]) ?? []).map((i) =>
    i.id === args.itemId
      ? {
          ...i,
          stapleId: args.existingStapleId,
          name: args.existingName,
          name2: args.existingName2,
          pendingPromote: false,
        }
      : i,
  );
  const batch = writeBatch(db);
  batch.update(reqRef, { items, updatedAt: serverTimestamp() });
  batch.delete(pendingRef);
  await batch.commit();
}

/** Hard-delete a request the CREATOR no longer wants (2026-05-18 fix).
 *
 *  Prior behaviour set status='rejected' with note "Discarded by
 *  creator" — that conflated two semantically different actions:
 *    • Delete  — author taking back their own mistake (no audit value)
 *    • Reject  — parent declining someone else's request (audit-worthy)
 *  The rejected list ended up polluted with the author's "oops"
 *  drafts. This now hard-deletes the doc, leaving the rejected list
 *  for actual parent-rejections only.
 *
 *  Allowed for status: 'draft' (always) or 'pending_approval' (only
 *  the creator may delete their own un-reviewed request). Anything
 *  past that needs a parent reject. */
export async function deleteRequest(
  familyId: string,
  requestId: string,
): Promise<void> {
  if (isGuestActive()) return;
  const snap = await getDoc(requestDoc(familyId, requestId));
  if (!snap.exists()) return;
  const status = snap.data().status as PurchaseRequestStatus;
  if (status !== 'draft' && status !== 'pending_approval') return;
  await deleteDoc(requestDoc(familyId, requestId));
}

/** @deprecated since 2026-05-18 — use deleteRequest. Kept temporarily
 *  in case anything outside the repo imports it; can be removed in a
 *  follow-up sweep. */
export const discardDraft = deleteRequest;

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
