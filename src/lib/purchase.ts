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
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  query, where, orderBy, limit, Timestamp, serverTimestamp,
  onSnapshot, writeBatch, increment, runTransaction, deleteField, arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { toDisplayDate } from './dates';
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
 *  pending_close    — helper finished reconcile; parent reviewing actuals
 *                     before totals post to the family budget. Parent
 *                     allocates any overrun, decides what to do with any
 *                     savings, optionally leaves a note. (2026-05-19)
 *  closed           — reconciled + parent-approved; totals frozen,
 *                     posted to budget. Staple write-back happens here.
 */
export type PurchaseRequestStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'reconciling'
  | 'pending_close'
  | 'closed';

/** Which Household module the request belongs to.
 *    pantry  — groceries / staples
 *    outdoor — garden, pool, kuku, pets, repairs (Gardener-scoped)
 *    drivers — vehicle fuel + service + spare parts (Driver-scoped)
 *    utility — electricity / water / internet top-ups + bill payments
 *    payroll — helper-private: advances + loans tied to the helper's
 *              `helperUid` field on the request, parent-only approval
 *    home    — durable household goods: furniture, appliances, décor,
 *              fittings. Mostly parent-bought; sits last (low-frequency).
 *  All six modules share the `purchaseRequests` collection;
 *  `module` discriminates the surface. */
export type PurchaseModule = 'pantry' | 'outdoor' | 'drivers' | 'utility' | 'payroll' | 'dineOut' | 'home' | 'subscriptions' | 'contributions';

// ── Price-change guardrail config (2026-05-31) ──────────────────────
// A helper's reconciled price-per-unit must stay within ± this percent
// of the parent-approved price. Outside the band → the line needs a
// parent OK (see PurchaseRequestItem.priceException). Stored on the
// Family as a Partial and merged with DEFAULT_PURCHASE_CONFIG by
// `readPurchaseConfig(family)` — same pattern as readBusinessConfig.
//
// A single family-wide default applies to every module; `perModule`
// lets a parent loosen/tighten one module (e.g. fuel swings more than
// groceries) without affecting the rest. The band guards PRICE PER UNIT
// only — quantity edits stay free, and the unit model is untouched.
export interface PurchaseConfig {
  /** Family-wide max ± price change a helper can make, as a percent
   *  (e.g. 15 = ±15%). 0 disables the guardrail (any price allowed). */
  maxPriceChangePct: number;
  /** Optional per-module overrides of `maxPriceChangePct`. */
  perModule?: Partial<Record<PurchaseModule, number>>;
}

export const DEFAULT_PURCHASE_CONFIG: PurchaseConfig = {
  maxPriceChangePct: 15,
};

/** Merge the family's stored partial config over the defaults. */
export function readPurchaseConfig(
  family: { purchaseConfig?: Partial<PurchaseConfig> } | null | undefined,
): PurchaseConfig {
  const f = family?.purchaseConfig || {};
  const pct = typeof f.maxPriceChangePct === 'number' && f.maxPriceChangePct >= 0
    ? f.maxPriceChangePct
    : DEFAULT_PURCHASE_CONFIG.maxPriceChangePct;
  return {
    maxPriceChangePct: pct,
    ...(f.perModule ? { perModule: f.perModule } : {}),
  };
}

/** The effective band percent for a given module — the per-module
 *  override if set, else the family-wide default. */
export function bandPctFor(config: PurchaseConfig, module: PurchaseModule): number {
  const override = config.perModule?.[module];
  return typeof override === 'number' && override >= 0 ? override : config.maxPriceChangePct;
}

/** Inclusive [min, max] per-unit cents allowed for an approved price at
 *  a given band percent. Returns null when there's no anchor to compare
 *  against (no approved price, or band disabled with pct <= 0). */
export function priceBandRange(
  approvedCents: number | undefined,
  bandPct: number,
): { minCents: number; maxCents: number } | null {
  if (!approvedCents || approvedCents <= 0) return null;
  if (!bandPct || bandPct <= 0) return null;
  const delta = approvedCents * (bandPct / 100);
  return {
    minCents: Math.floor(approvedCents - delta),
    maxCents: Math.ceil(approvedCents + delta),
  };
}

/** True when an entered per-unit price is within the allowed band of the
 *  approved price. When there's no anchor/band (range null), nothing is
 *  out of band — returns true (the guardrail simply doesn't apply). */
export function priceWithinBand(
  approvedCents: number | undefined,
  enteredCents: number | undefined,
  bandPct: number,
): boolean {
  const range = priceBandRange(approvedCents, bandPct);
  if (!range) return true;
  if (enteredCents == null) return true;
  return enteredCents >= range.minCents && enteredCents <= range.maxCents;
}

/** Whether a reconciled line is currently blocking a clean close — i.e.
 *  its price is over-band and the exception is still pending a parent. */
export function itemPriceExceptionPending(item: PurchaseRequestItem): boolean {
  return item.priceException === 'pending';
}

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

// ── Drivers request kinds (Drivers v2 — 2026-07-05) ─────────────────
// A Drivers request declares WHAT it is at creation: fuel (structured
// litres × price form), maintenance (ad-hoc works), service (scheduled —
// closing one resets the vehicle's service clock) or other. Item
// categories keep living underneath; legacy requests without a kind
// render as a plain mixed basket, untouched.
export type DriversRequestKind = 'fuel' | 'maintenance' | 'service' | 'other';

export const DRIVERS_KINDS: {
  id: DriversRequestKind; emoji: string; label: string; sub: string;
}[] = [
  { id: 'fuel',        emoji: '⛽', label: 'Fuel',        sub: 'Litres × price, auto-amount' },
  { id: 'maintenance', emoji: '🔧', label: 'Maintenance', sub: 'Repairs, parts, wash, tyres' },
  { id: 'service',     emoji: '🛠️', label: 'Service',     sub: 'Scheduled — resets the clock' },
  { id: 'other',       emoji: '📦', label: 'Other',       sub: 'Tolls, parking, anything else' },
];

export function driversKindMeta(kind: DriversRequestKind | undefined) {
  return DRIVERS_KINDS.find((k) => k.id === kind) ?? null;
}

/** Unit label for the fuel form — follows the vehicle's fuel type
 *  (litres for petrol/diesel, kWh for electric, kg for CNG). */
export function fuelUnitFor(fuel: string | undefined): string {
  if (fuel === 'electric') return 'kWh';
  if (fuel === 'cng') return 'kg';
  return 'L';
}

// ── Drivers config (odometer guardrails — Drivers v2, 2026-07-05) ───
// Same family-doc partial + merge-on-read pattern as PurchaseConfig.
export interface DriversConfig {
  /** When true, helpers can't send a Drivers request without an
   *  odometer reading. Parents are always nudged, never blocked. */
  odometerMandatoryForHelpers: boolean;
  /** A new reading more than this many km above the last one asks for
   *  an explicit confirm (typo protection: 850,000 vs 85,000). */
  odometerJumpBandKm: number;
}

export const DEFAULT_DRIVERS_CONFIG: DriversConfig = {
  odometerMandatoryForHelpers: false,
  odometerJumpBandKm: 5000,
};

export function readDriversConfig(
  family: { driversConfig?: Partial<DriversConfig> } | null | undefined,
): DriversConfig {
  const f = family?.driversConfig || {};
  return {
    odometerMandatoryForHelpers: f.odometerMandatoryForHelpers === true,
    odometerJumpBandKm:
      typeof f.odometerJumpBandKm === 'number' && f.odometerJumpBandKm > 0
        ? f.odometerJumpBandKm
        : DEFAULT_DRIVERS_CONFIG.odometerJumpBandKm,
  };
}

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
export type PayrollCategory = 'advance' | 'loan' | 'bonus' | 'reimbursement' | 'savings_tip';

export const PAYROLL_CATEGORIES: { id: PayrollCategory; emoji: string; label: string }[] = [
  { id: 'advance',       emoji: '💵', label: 'Salary advance' },
  { id: 'loan',          emoji: '🏦', label: 'Loan' },
  { id: 'bonus',         emoji: '🎁', label: 'Bonus' },
  { id: 'reimbursement', emoji: '↩️', label: 'Reimbursement' },
  // 2026-05-19 — Savings tip: when a purchase request closes UNDER
  // approved budget, the parent can give the saved amount to the
  // helper as a thank-you. Lands as a payroll bonus-type request so
  // it threads through the same approve → reconcile → close flow and
  // the helper's payroll history accumulates "savings earned over
  // time" — visible signal of frugal shopping.
  { id: 'savings_tip',   emoji: '🌱', label: 'Savings tip' },
];

/** Categories specific to the Dine Out module — meals away from home,
 *  parent-logged as quick amounts (restaurant / takeaway / delivery /
 *  coffee). Low-frequency; grouped with Home behind the "More" tiles. */
export type DineOutCategory =
  | 'restaurant' | 'takeaway' | 'delivery' | 'coffee' | 'other';

export const DINE_OUT_CATEGORIES: { id: DineOutCategory; emoji: string; label: string }[] = [
  { id: 'restaurant', emoji: '🍽️', label: 'Restaurant' },
  { id: 'takeaway',   emoji: '🥡', label: 'Takeaway' },
  { id: 'delivery',   emoji: '🛵', label: 'Delivery' },
  { id: 'coffee',     emoji: '☕', label: 'Coffee & snacks' },
  { id: 'other',      emoji: '📦', label: 'Other' },
];

/** Categories specific to the Home & Wellness module — durable
 *  household goods + self-care, mostly parent-bought (furniture,
 *  appliances, décor, fittings, wellness). */
export type HomeCategory =
  | 'furniture' | 'appliances' | 'decor' | 'fittings' | 'wellness' | 'other';

export const HOME_CATEGORIES: { id: HomeCategory; emoji: string; label: string }[] = [
  { id: 'furniture',  emoji: '🛋️', label: 'Furniture' },
  { id: 'appliances', emoji: '🔌', label: 'Appliances' },
  { id: 'decor',      emoji: '🖼️', label: 'Décor' },
  { id: 'fittings',   emoji: '🔧', label: 'Fittings & repairs' },
  { id: 'wellness',   emoji: '🧖', label: 'Self-care & wellness' },
  { id: 'other',      emoji: '📦', label: 'Other' },
];

/** Module → emoji + label shortcuts for consistent branding across
 *  pickers, tab bars, Finances roll-up, etc. */
export const MODULE_EMOJI: Record<PurchaseModule, string> = {
  pantry:         '🛒',
  outdoor:        '🌿',
  drivers:        '🚗',
  utility:        '⚡',
  payroll:        '🤝',
  dineOut:        '🍽️',
  home:           '🛋️',
  subscriptions:  '🔁',
  contributions:  '🤲',
};

export const MODULE_LABEL: Record<PurchaseModule, string> = {
  pantry:         'Pantry',
  outdoor:        'Outdoor',
  drivers:        'Drivers',
  utility:        'Utilities',
  payroll:        'Payroll',
  dineOut:        'Dine Out',
  home:           'Home & Wellness',
  subscriptions:  'Subscriptions',
  contributions:  'Contributions',
};

/** Short module code used in the auto-generated request name +
 *  serial pill. 2026-05-18 (Elia: structured naming proposal).
 *  Format: `{MODULE_CODE}-{0042} · {DDMMYY}( · {context})?`
 *  e.g. `PNT-0042 · 180526 · Diana's RAV4` for a Drivers request
 *  pinned to a vehicle. Three letters chosen for compact scanning
 *  on mobile + so the pill stays under ~10 chars. */
export const MODULE_CODE: Record<PurchaseModule, string> = {
  pantry:         'PNT',
  outdoor:        'OUT',
  drivers:        'CAR',
  utility:        'UTL',
  payroll:        'PAY',
  dineOut:        'DIN',
  home:           'HOM',
  subscriptions:  'SUB',
  contributions:  'CTR',
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
  /** True when the helper added this line during reconciliation (not
   *  part of the approved basket). Marks the row with an "added at
   *  shop" badge so the audit trail makes it obvious which items were
   *  ad-hoc additions versus part of the approved scope.
   *  (2026-05-19.) */
  addedDuringReconcile?: boolean;
  // ── Price-change guardrail (2026-05-31) ──────────────────────────
  // When a helper's actual price-per-unit lands OUTSIDE the family's
  // allowed ± band (vs the approved estimate), the line can't post on
  // the helper's say-so. They attach a reason; the line travels with
  // `priceException: 'pending'` and surfaces to the parent at close
  // review, who flips it to 'approved' or 'rejected'. Comments are kept
  // permanently for the audit trail. Lines within band never set these.
  /** Set when the actual per-unit price is outside the allowed band. */
  priceException?: 'pending' | 'approved' | 'rejected';
  /** Helper's required reason for the over-band price. */
  priceExceptionReason?: string;
  /** Parent's note left when resolving the exception (approve or reject). */
  priceExceptionParentNote?: string;
  /** Parent uid who resolved the exception. */
  priceExceptionResolvedBy?: string;
  /** Drivers v2 (2026-07-05) — this line IS the structured fuel line
   *  of a fuel-kind request (qty = litres/kWh/kg, estimatedCents =
   *  price per unit). The FuelCard maintains it; the fuel-price
   *  memory reads it back from closed requests. */
  isFuelLine?: boolean;
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

  /** Submit-for-close-review flow (2026-05-19): when the helper
   *  finishes reconcile they hand off to the parent, who reviews
   *  the actuals + allocates overrun + decides on savings + leaves
   *  a note, then posts to budget. Filled when state moves from
   *  `reconciling` → `pending_close`. */
  submittedForCloseAt?: Timestamp;
  submittedForCloseBy?: string;

  /** Parent's free-text note attached during close review — captures
   *  context like "shop was further this week so transport added
   *  $5" or "next month's budget covers this". Optional. */
  closeApprovalNote?: string;

  /** Post-close decision when actuals came in OVER approved — the
   *  parent picks how the overage is treated for budget reporting.
   *    'absorb'     — count the overage against this month's cap
   *                   (default — money already spent, budget eats it).
   *    'unbudgeted' — mark as a one-off / exceptional expense so the
   *                   per-module monthly trend doesn't get distorted.
   *  Stored as a permanent audit field. (2026-05-19) */
  overrunAllocation?: {
    kind: 'absorb' | 'unbudgeted';
    amountCents: number;
    decidedBy: string;
    decidedAt: Timestamp;
  };

  /** Post-close decision when actuals came in UNDER approved — the
   *  parent picks one of: tip the helper, carry the balance forward
   *  to the next request, or skip. Stored as a permanent audit
   *  field so the family can see the trail later. (2026-05-19) */
  savingsDecision?: {
    kind: 'tip' | 'balance' | 'skip';
    /** Cents of savings the decision was made against. Snapshot — if
     *  someone later edits actuals (shouldn't happen post-close, but
     *  guard anyway) we keep the number that was decided on. */
    amountCents: number;
    /** When `kind === 'tip'` — the helper UID being tipped, and the
     *  PAY-* request id we created for them. Skipped when carry/skip. */
    helperUid?: string;
    tipRequestId?: string;
    decidedBy: string;
    decidedAt: Timestamp;
  };

  createdAt: Timestamp;
  createdBy: string;
  createdByRole: 'parent' | 'helper';
  updatedAt?: Timestamp;

  /** Per-parent cost attribution (2026-05-30). null/unset = Shared.
   *  Set by a parent on the detail page (the cost is theirs vs the
   *  shared family budget). For payroll requests it inherits from the
   *  helper's payroll config `paidByUid` at generation time. Distinct
   *  from `createdBy` (who raised the request — often a helper/kid). */
  paidByUid?: string | null;

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

  /** For Utility requests auto-generated from a recurring bill — the
   *  `Utility` doc this payment satisfies. The mirror of the bill's
   *  `lastGeneratedRequestId` pointer. On close, closeReconcile stamps
   *  the bill's lastPayment* fields via this link so the Outstanding
   *  banner + row pill + budget roll-up flip in sync. Unset for
   *  free-form top-ups (variable, not tied to a recurring bill).
   *  (Utilities v2, 2026-05-20.) */
  utilityId?: string;

  /** The `Payment` doc id closeReconcile created against the linked
   *  bill on close. Lets reopen/delete reverse exactly that payment
   *  (rather than guessing) so the bill returns to Outstanding.
   *  Cleared on reopen. (Reopen v1, 2026-05-20.) */
  utilityPaymentId?: string;

  // ── Reopen audit (Reopen v1, 2026-05-20) ───────────────────────
  // A parent can reopen a closed request back to `reconciling` to fix
  // actuals or delete it. These breadcrumbs survive the reclose so the
  // trail shows the request WAS reopened (and how many times).
  reopenedAt?: Timestamp;
  reopenedBy?: string;
  reopenCount?: number;

  /** For Drivers requests — which vehicle this request is for
   *  (2026-05-18). Pinned at draft creation via the vehicle picker
   *  on /pantry/drivers. Finances rolls up per-vehicle spend via
   *  this field. Unused for non-drivers modules. */
  vehicleId?: string;

  // ── Drivers v2 (2026-07-05) ────────────────────────────────────────
  /** What the request IS: fuel / maintenance / service / other.
   *  Chosen at creation on /pantry/drivers; steers the detail page
   *  (fuel form, service card). Legacy requests have no kind and
   *  render as a plain mixed basket. */
  kind?: DriversRequestKind;
  /** Snapshot of the pinned vehicle's fuel type at creation — keys the
   *  fuel-price memory (petrol prices ≠ diesel prices) without a
   *  vehicle join on every read. */
  fuelType?: string;
  /** Odometer reading captured with this request (canonical km).
   *  Mirrored into the Pulse readings ledger via /api/drivers/odometer
   *  at send time — THAT ledger is the source of truth; this field is
   *  the request-local audit stamp. */
  odometerKm?: number;

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
    /** Pay window (cycle model · 2026-06-08) — when the salary is paid,
     *  separate from the work cycle. ISO dates; display + "Mark paid"
     *  expectation only. Absent on legacy/weekly entries. */
    payWindowStart?: string;
    payWindowEnd?: string;
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

  /** True when a parent posted the request straight to the budget at
   *  creation, skipping the approval + reconcile chain (2026-05-20).
   *  Parents have direct oversight, so they can record their own
   *  spend in one step. Helpers always go through the full flow.
   *  Audit-only flag — the detail page badges it as "Posted by parent". */
  postedDirect?: boolean;

  /** Explicit budget month 'YYYY-MM' (2026-06-08). When set, budget
   *  surfaces count this request in this month regardless of when it
   *  closed. Salaries set it to their WORK month so May's pay (paid
   *  early June) lands in May's budget. `budgetMonthKeyFor()` falls
   *  back to the payroll work-period, then closedAt, when unset. */
  budgetMonth?: string;

  /** Salary payment confirmation (2026-06-08). A salary is booked to
   *  budget as "Processing" (closed, paidAt unset); the parent taps
   *  "Mark paid" in the pay window, which stamps paidAt = the payment
   *  day. Status stays `closed`; the budget month never moves. */
  paidAt?: Timestamp;

  /** Edit trail for post-close corrections (2026-06-15). Every parent
   *  edit to a posted payroll entry — work period, payment day, or
   *  budget month — appends an entry here so the change is traceable
   *  ("Budget month → May 2026 · Elia · 15 Jun"). Append-only; the
   *  detail page renders it as a quiet history line. */
  editLog?: PayrollEditLogEntry[];
}

/** One line in a posted entry's edit trail. `at`/`by` are stamped at
 *  edit time (Timestamp.now, since serverTimestamp can't live inside an
 *  array element); `summary` is the human-readable change. */
export interface PayrollEditLogEntry {
  at: Timestamp;
  by: string;
  byName?: string;
  field: 'period' | 'paidAt' | 'budgetMonth';
  summary: string;
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
    where('status', 'in', ['draft', 'pending_approval', 'approved', 'reconciling', 'pending_close']),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest)));
  });
}

/** Module-scoped open-requests subscription. (2026-05-19)
 *
 *  Why this exists: `subscribeToOpenRequests` reads ALL modules,
 *  including payroll. The Firestore rule for payroll requires the
 *  reader to be a parent OR the helperUid of the doc — so a broad
 *  listen for a HELPER fails with permission_denied when the family
 *  has any payroll doc not pinned to them, blocking visibility into
 *  approved Pantry / Outdoor / Drivers / Utility requests too.
 *
 *  This variant constrains the query at the DB layer to a single
 *  module, eliminating cross-module bleed entirely. Each non-payroll
 *  module home should use this for helpers; parents can keep using
 *  the broad subscription (rules allow them unconstrained read).
 *
 *  Index: (module ASC, status ASC, createdAt DESC). */
export function subscribeToOpenRequestsByModule(
  familyId: string,
  module: PurchaseModule,
  cb: (requests: PurchaseRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('module', '==', module),
    where('status', 'in', ['draft', 'pending_approval', 'approved', 'reconciling', 'pending_close']),
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

/** Module-scoped recent-requests subscription — companion to
 *  `subscribeToOpenRequestsByModule`. Same rationale: helper-side
 *  reads can't bleed across modules without hitting permission_denied
 *  on payroll docs.
 *  Index: (module ASC, status ASC, closedAt DESC). */
export function subscribeToRecentRequestsByModule(
  familyId: string,
  module: PurchaseModule,
  cb: (requests: PurchaseRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('module', '==', module),
    where('status', 'in', ['closed', 'rejected']),
    orderBy('closedAt', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as PurchaseRequest)));
  });
}

// ── Fuel-price memory (Drivers v2 — 2026-07-05) ─────────────────────
// The last RECONCILED fuel prices are the family's price memory: the
// fuel form pre-fills from the most recent one for the same fuel type
// and chips the deviation when the entered price moves. Reads the same
// (module, status, closedAt) query shape as subscribeToRecentRequests-
// ByModule so no new composite index is needed.
export interface FuelFillRecord {
  requestId: string;
  vehicleId?: string;
  fuelType?: string;
  /** Actual per-unit price (cents) — reconciled when available, else
   *  the approved estimate. */
  pricePerUnitCents: number;
  /** Litres (or kWh/kg) actually bought. */
  units: number;
  /** Odometer stamp on the request, when captured. */
  odometerKm?: number;
  closedAtMs: number;
}

/** Most-recent-first closed fuel fills. Optionally narrowed to a fuel
 *  type (price memory) or a vehicle (sparkline + efficiency). */
export async function fetchRecentFuelFills(
  familyId: string,
  opts?: { fuelType?: string; vehicleId?: string; max?: number },
): Promise<FuelFillRecord[]> {
  if (isGuestActive()) return [];
  const q = query(
    requestCol(familyId),
    where('module', '==', 'drivers'),
    where('status', 'in', ['closed', 'rejected']),
    orderBy('closedAt', 'desc'),
    limit(60),
  );
  const snap = await getDocs(q);
  const fills: FuelFillRecord[] = [];
  for (const d of snap.docs) {
    const r = { id: d.id, ...d.data() } as PurchaseRequest;
    if (r.status !== 'closed' || r.kind !== 'fuel') continue;
    if (opts?.fuelType && r.fuelType && r.fuelType !== opts.fuelType) continue;
    if (opts?.vehicleId && r.vehicleId !== opts.vehicleId) continue;
    const line = r.items.find((i) => i.isFuelLine) ?? (r.items.length === 1 ? r.items[0] : undefined);
    if (!line) continue;
    const price = line.actualCents ?? line.estimatedCents;
    const units = line.actualQty ?? line.qty;
    if (!price || price <= 0 || !units || units <= 0) continue;
    fills.push({
      requestId: r.id,
      ...(r.vehicleId ? { vehicleId: r.vehicleId } : {}),
      ...(r.fuelType ? { fuelType: r.fuelType } : {}),
      pricePerUnitCents: price,
      units,
      ...(typeof r.odometerKm === 'number' ? { odometerKm: r.odometerKm } : {}),
      closedAtMs: r.closedAt ? r.closedAt.toMillis() : 0,
    });
    if (fills.length >= (opts?.max ?? 12)) break;
  }
  return fills;
}

/** Lite view of recent CLOSED Drivers requests — feeds the Vehicle
 *  Health Card (spend vs cap, cost/km) + fleet comparison without
 *  hauling full item arrays around. Same indexed query shape as the
 *  recent-requests subscription. */
export interface DriversClosedLite {
  requestId: string;
  vehicleId?: string;
  kind?: DriversRequestKind;
  actualTotalCents: number;
  closedAtMs: number;
}

export async function fetchRecentDriversClosed(
  familyId: string,
  max = 80,
): Promise<DriversClosedLite[]> {
  if (isGuestActive()) return [];
  const q = query(
    requestCol(familyId),
    where('module', '==', 'drivers'),
    where('status', 'in', ['closed', 'rejected']),
    orderBy('closedAt', 'desc'),
    limit(max),
  );
  const snap = await getDocs(q);
  const out: DriversClosedLite[] = [];
  for (const d of snap.docs) {
    const r = { id: d.id, ...d.data() } as PurchaseRequest;
    if (r.status !== 'closed') continue;
    out.push({
      requestId: r.id,
      ...(r.vehicleId ? { vehicleId: r.vehicleId } : {}),
      ...(r.kind ? { kind: r.kind } : {}),
      actualTotalCents: r.actualTotalCents ?? r.estimatedTotalCents ?? 0,
      closedAtMs: r.closedAt ? r.closedAt.toMillis() : 0,
    });
  }
  return out;
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
    ? ['draft', 'pending_approval', 'approved', 'reconciling', 'pending_close']
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
 *  can't collide.
 *
 *  Returns 0 (sentinel) on failure — typically when the counters
 *  firestore rule hasn't been deployed yet. The caller treats 0 as
 *  "no seq available" and skips the audit-pill + falls back to a
 *  weekday-based draft name. Without this resilience, a rule-deploy
 *  miss after a rule-touching PR silently breaks ALL request
 *  creation (which is exactly what bit production on 2026-05-19). */
async function nextRequestSeq(familyId: string, module: PurchaseModule): Promise<number> {
  if (isGuestActive()) return 1;
  const counterRef = doc(
    db, 'families', familyId, 'counters', `purchaseRequests-${module}`,
  );
  try {
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
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(
      '[purchase] counter allocation failed — falling back to anonymous draft. ' +
      'Run `firebase deploy --only firestore:rules` to re-enable PNT-NNNN audit naming.',
      e,
    );
    return 0;
  }
}

/** Legacy weekday-noun draft names, used as a fallback when the
 *  counter transaction can't allocate a seq. Matches the v2 naming
 *  (`Monday shop` / `Monday outdoor` / etc.) so the UX is still
 *  intelligible even without the structured PNT-NNNN scheme. */
function fallbackDraftName(module: PurchaseModule, context?: string): string {
  const day = new Date().toLocaleDateString('en-US', { weekday: 'long' });
  const noun: Record<PurchaseModule, string> = {
    pantry:         'shop',
    outdoor:        'outdoor',
    drivers:        'drive',
    utility:        'utility',
    payroll:        'payroll',
    dineOut:        'dine-out',
    home:           'home',
    subscriptions:  'subscription',
    contributions:  'contribution',
  };
  const head = `${day} ${noun[module]}`;
  return context?.trim() ? `${head} · ${context.trim()}` : head;
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
    utilityId?: string;
    vehicleId?: string;
    /** Drivers v2 — request kind picked at creation (fuel / maintenance
     *  / service / other). Drivers module only. */
    kind?: DriversRequestKind;
    /** Drivers v2 — pinned vehicle's fuel type snapshot (keys the
     *  fuel-price memory). */
    fuelType?: string;
    /** System-generated payroll requests skip 'draft' and land
     *  directly in 'pending_approval' (parents review the auto-
     *  computed paystub). Set `initialStatus: 'pending_approval'`
     *  + `generatedBy: 'system'` for these. */
    initialStatus?: PurchaseRequestStatus;
    generatedBy?: 'system';
    /** Payroll cycle breakdown — set together with `module: 'payroll'`
     *  + generatedBy. The detail page renders it as a paystub. */
    payrollCycle?: PurchaseRequest['payrollCycle'];
    /** Explicit budget month 'YYYY-MM' (salaries → their work month). */
    budgetMonth?: string;
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
    : seq > 0
      ? buildAutoRequestName(module, seq, new Date(), args.context)
      : fallbackDraftName(module, args.context);
  const payload: Record<string, unknown> = {
    name: finalName,
    // Only stamp seq when we got one — fallback drafts skip the
    // field entirely (the detail page hides the audit pill when
    // seq is missing).
    ...(seq > 0 ? { seq } : {}),
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
  if (args.utilityId) payload.utilityId = args.utilityId;
  if (args.vehicleId) payload.vehicleId = args.vehicleId;
  if (args.kind) payload.kind = args.kind;
  if (args.fuelType) payload.fuelType = args.fuelType;
  if (args.generatedBy) payload.generatedBy = args.generatedBy;
  if (args.payrollCycle) payload.payrollCycle = args.payrollCycle;
  if (args.budgetMonth) payload.budgetMonth = args.budgetMonth;
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

/** Persist the family's purchase guardrail config (parent-only; rules
 *  enforce). Stored as a partial + merged on read by readPurchaseConfig. */
export async function setPurchaseConfig(
  familyId: string,
  patch: Partial<PurchaseConfig>,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(doc(db, 'families', familyId), { purchaseConfig: patch } as Record<string, unknown>, { merge: true });
}

/** Persist the family's Drivers config (odometer guardrails —
 *  parent-only; rules enforce the family-doc write). Stored as a
 *  partial + merged on read by readDriversConfig. */
export async function setDriversConfig(
  familyId: string,
  patch: Partial<DriversConfig>,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(doc(db, 'families', familyId), { driversConfig: patch } as Record<string, unknown>, { merge: true });
}

/** Rename + edit metadata on a draft. */
export async function updateRequestMeta(
  familyId: string,
  requestId: string,
  patch: { name?: string; note?: string; paidByUid?: string | null; odometerKm?: number },
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

/** Parent fast-path: post a draft STRAIGHT to the budget, skipping the
 *  approval → reconcile → close-review chain (2026-05-20). The parent
 *  confirms the final amount (defaults to the estimate at the call
 *  site). We stamp the approval / reconcile / close marks so the
 *  request lands as an ordinary `closed` row that the finances roll-up
 *  counts exactly like any other closed request. Parent-only — the
 *  detail page never offers this to helpers. */
export async function postDraftToBudget(
  familyId: string,
  requestId: string,
  parentUid: string,
  actualTotalCents: number,
): Promise<void> {
  if (isGuestActive()) return;
  const reqRef = requestDoc(familyId, requestId);
  const snap = await getDoc(reqRef);
  const data = snap.exists() ? (snap.data() as PurchaseRequest) : null;
  const now = serverTimestamp();
  // 2026-05-21 — a direct post has no separate reconcile, so the amount
  // posted IS the spend. Mirror each item's estimate into its actuals so
  // sumActual(items) == the basket and the closed request reads "actual =
  // amount spent, no savings" instead of the bogus "actual 0 · -100%".
  const items = (data?.items ?? []).map((it) => ({
    ...it,
    actualCents: it.estimatedCents ?? 0,
    actualQty: it.qty,
  }));
  await updateDoc(reqRef, {
    status: 'closed' as PurchaseRequestStatus,
    items,
    approvedBy: [parentUid],
    approvedAt: now,
    reconciledAt: now,
    closedAt: now,
    actualTotalCents: Math.max(0, Math.round(actualTotalCents)),
    postedDirect: true,
    updatedAt: now,
  });
  // Drivers v2 — a direct-posted Service resets the clock too.
  await resetServiceBaselineOnClose(familyId, data);
}

// ── Drivers v2 — service clock auto-reset (2026-07-05) ──────────────
// Closing a Service-kind request IS the "service happened" signal:
// baseline km ← the request's odometer stamp (when captured), baseline
// date ← today. Without this the reminders would nag forever (closed
// logic, flaw #7). Fire-and-forget AFTER the close commit — a baseline
// hiccup must never roll back the close itself. Manual reset lives in
// Setup → Vehicles & service for services done outside Kaya.
async function resetServiceBaselineOnClose(
  familyId: string,
  reqData: Pick<PurchaseRequest, 'module' | 'kind' | 'vehicleId' | 'odometerKm'> | null,
): Promise<void> {
  if (!reqData || reqData.module !== 'drivers' || reqData.kind !== 'service' || !reqData.vehicleId) return;
  try {
    const { updateVehicle } = await import('./vehicles');
    const todayIso = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
    await updateVehicle(familyId, reqData.vehicleId, {
      serviceBaselineDate: todayIso,
      ...(typeof reqData.odometerKm === 'number' && reqData.odometerKm > 0
        ? { serviceBaselineKm: reqData.odometerKm }
        : {}),
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[drivers] service baseline reset failed:', e);
  }
}

/** YYYY-MM key for a request's BUDGET month. Priority:
 *   1. explicit `budgetMonth` (set on salaries + parent direct posts)
 *   2. payroll work period (`payrollCycle.periodStart`) — so a May salary
 *      paid/closed in early June still counts in MAY, and any salary
 *      mis-booked into the wrong month auto-corrects at read time
 *   3. `closedAt` — the default for ordinary helper purchases
 *  Returns null when none apply (e.g. an open request). */
export function budgetMonthKeyFor(
  r: Pick<PurchaseRequest, 'budgetMonth' | 'module' | 'payrollCycle' | 'closedAt'>,
): string | null {
  if (r.budgetMonth) return r.budgetMonth;
  if (r.module === 'payroll' && r.payrollCycle?.periodStart) {
    return r.payrollCycle.periodStart.slice(0, 7);   // 'YYYY-MM-DD' → 'YYYY-MM'
  }
  const at = r.closedAt?.toDate?.();
  return at ? `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}` : null;
}

/** A short human label for the editor stamped on an edit-trail entry. */
export interface EditActor { uid: string; name?: string }

/** Build an edit-trail entry (Timestamp.now — serverTimestamp can't live
 *  inside an arrayUnion element). Returns null when no actor is supplied
 *  so callers can opt out of trailing (e.g. system writes). */
function editLogEntry(
  actor: EditActor | undefined,
  field: PayrollEditLogEntry['field'],
  summary: string,
): PayrollEditLogEntry | null {
  if (!actor?.uid) return null;
  const e: PayrollEditLogEntry = { at: Timestamp.now(), by: actor.uid, field, summary };
  if (actor.name) e.byName = actor.name;
  return e;
}

/** Short "12 Jun 2026" for edit-trail summaries. */
function fmtDay(d: Date): string {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Mark a salary (or any closed payroll request) as paid. Stamps `paidAt`
 *  to the chosen payment day — a status-only change that captures WHEN it
 *  was paid without ever moving the budget month. Parent-only; used by the
 *  one-tap "Mark paid" in the pay window (1st–5th) and by the post-close
 *  "edit payment date" control. Pass `actor` to record an edit-trail entry. */
export async function markSalaryPaid(
  familyId: string,
  requestId: string,
  paidOn?: Date,
  actor?: EditActor,
): Promise<void> {
  if (isGuestActive()) return;
  const entry = paidOn
    ? editLogEntry(actor, 'paidAt', `Payment day → ${fmtDay(paidOn)}`)
    : null;
  await updateDoc(requestDoc(familyId, requestId), {
    paidAt: paidOn ? Timestamp.fromDate(paidOn) : serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...(entry ? { editLog: arrayUnion(entry) } : {}),
  });
}

/** Set of `${helperUid}|${cycleKey}` for every live (non-rejected) payroll
 *  request — the cycles a helper already has a salary for. The generator uses
 *  this to avoid raising a second salary for a month that already has one
 *  (e.g. a manual entry), preventing a double-pay. One-shot read. */
export async function listPayrollCycleKeys(familyId: string): Promise<Set<string>> {
  const keys = new Set<string>();
  if (isGuestActive()) return keys;
  const q = query(
    requestCol(familyId),
    where('module', '==', 'payroll'),
    where('status', 'in', ['draft', 'pending_approval', 'approved', 'reconciling', 'pending_close', 'closed']),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) {
    const r = { id: d.id, ...d.data() } as PurchaseRequest;
    if (!r.helperUid) continue;
    const ck = budgetMonthKeyFor(r);
    if (ck) keys.add(`${r.helperUid}|${ck}`);
  }
  return keys;
}

/** Re-attribute a request to a specific budget month 'YYYY-MM'. Parent
 *  correction for a salary that was stamped with the wrong work-period —
 *  e.g. a payment made on the 1st–5th of June that belongs to MAY. Sets
 *  `budgetMonth`, which `budgetMonthKeyFor()` honours above everything, so
 *  the cost moves to the right month without touching history. */
export async function setRequestBudgetMonth(
  familyId: string,
  requestId: string,
  budgetMonth: string,
  actor?: EditActor,
): Promise<void> {
  if (isGuestActive()) return;
  const [y, m] = budgetMonth.split('-').map(Number);
  const label = y && m
    ? new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    : budgetMonth;
  const entry = editLogEntry(actor, 'budgetMonth', `Budget month → ${label}`);
  await updateDoc(requestDoc(familyId, requestId), {
    budgetMonth,
    updatedAt: serverTimestamp(),
    ...(entry ? { editLog: arrayUnion(entry) } : {}),
  });
}

/** Edit the work period (periodStart/periodEnd ISO 'YYYY-MM-DD') of a
 *  posted payroll entry (2026-06-15). The dates are kept FULLY INDEPENDENT
 *  of the budget month: `budgetMonthKeyFor` would otherwise derive the
 *  month from periodStart, so we PIN the current resolved budget month
 *  into `budgetMonth` first — changing the period then never moves which
 *  month the cost lands in. Parent-only. Pass `actor` for the edit trail. */
export async function editPayrollPeriod(
  familyId: string,
  requestId: string,
  periodStart: string,
  periodEnd: string,
  actor?: EditActor,
): Promise<void> {
  if (isGuestActive()) return;
  const ref = requestDoc(familyId, requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const req = { id: snap.id, ...snap.data() } as PurchaseRequest;
  if (req.module !== 'payroll' || !req.payrollCycle) return;
  // Pin the month so the period change stays independent of it.
  const pinnedMonth = req.budgetMonth ?? budgetMonthKeyFor(req) ?? undefined;
  const entry = editLogEntry(
    actor, 'period',
    `Work period → ${toDisplayDate(periodStart)} – ${toDisplayDate(periodEnd)}`,
  );
  await updateDoc(ref, {
    'payrollCycle.periodStart': periodStart,
    'payrollCycle.periodEnd': periodEnd,
    ...(pinnedMonth ? { budgetMonth: pinnedMonth } : {}),
    updatedAt: serverTimestamp(),
    ...(entry ? { editLog: arrayUnion(entry) } : {}),
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
  // Single-field equality only — `where(module) + orderBy(createdAt)` needs
  // a composite index that isn't deployed; without it onSnapshot errors and
  // the picker silently never renders. Sort newest-first in memory instead.
  const q = query(templateCol(familyId), where('module', '==', module));
  return onSnapshot(
    q,
    (snap) => {
      const templates = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as PurchaseTemplate))
        .sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      cb(templates);
    },
    (err) => console.error('subscribeToTemplates failed', err),
  );
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

/** Recycle a past invoice into a fresh draft — the per-invoice
 *  counterpart to {@link createDraftFromTemplate}. Reads the source
 *  request and seeds the new draft with what was ACTUALLY bought last
 *  time (actualQty / actualCents), falling back to the original
 *  estimate where no actual was recorded. Reconcile-only fields
 *  (actuals, ad-hoc + pending-promote flags) are dropped so the draft
 *  starts clean, and module pins (meter / vehicle / helper / utility)
 *  carry over so the recycled draft targets the same surface. Lines
 *  that netted zero (requested but not bought) are skipped. Returns the
 *  new draft id. */
export async function createDraftFromRequest(
  familyId: string,
  sourceRequestId: string,
  args: {
    createdBy: string;
    createdByRole: 'parent' | 'helper';
    /** Optional explicit name; otherwise a fresh auto-name is built. */
    nameOverride?: string;
  },
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const snap = await getDoc(requestDoc(familyId, sourceRequestId));
  if (!snap.exists()) throw new Error('Request not found');
  const src = { id: snap.id, ...snap.data() } as PurchaseRequest;
  const freshId = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? (crypto as Crypto).randomUUID()
      : Math.random().toString(36).slice(2, 10);
  // Seed from last actuals, fall back to the estimate. Build each clone
  // field-by-field so we never write `undefined` into Firestore (which
  // rejects it) and so reconcile-only fields are intentionally left off.
  const items: PurchaseRequestItem[] = (src.items ?? [])
    .map((it) => {
      const qty = it.actualQty != null ? it.actualQty : it.qty;
      const estimatedCents = it.actualCents != null ? it.actualCents : it.estimatedCents;
      const clone: PurchaseRequestItem = {
        id: freshId(),
        name: it.name,
        qty,
        unit: it.unit,
      };
      if (it.stapleId != null) clone.stapleId = it.stapleId;
      if (it.name2 != null) clone.name2 = it.name2;
      if (it.category != null) clone.category = it.category;
      if (estimatedCents != null) clone.estimatedCents = estimatedCents;
      return clone;
    })
    .filter((it) => (it.qty ?? 0) > 0);
  return createDraftRequest(familyId, {
    name: args.nameOverride,
    createdBy: args.createdBy,
    createdByRole: args.createdByRole,
    module: src.module,
    items,
    helperUid: src.helperUid,
    meterId: src.meterId,
    utilityId: src.utilityId,
    vehicleId: src.vehicleId,
  });
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

  // Budget routing (2026-06-08): a fully-approved request that a helper did
  // NOT initiate — salaries + auto top-ups (generatedBy 'system') and the
  // parent's own uploads (createdByRole 'parent') — posts STRAIGHT to budget,
  // skipping the reconcile + close-review chain. There's nothing for a helper
  // to reconcile on a fixed salary or a parent's own expense. Helper-initiated
  // requests keep the full approve → shop → reconcile → close flow.
  const directToBudget = meetsThreshold && data.createdByRole !== 'helper';
  const nextStatus: PurchaseRequestStatus = directToBudget
    ? 'closed'
    : meetsThreshold ? 'approved' : 'pending_approval';

  const patch: Record<string, unknown> = {
    approvedBy: approvers,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  };
  if (meetsThreshold) patch.approvedAt = serverTimestamp();
  if (directToBudget) {
    // Mirror each item's estimate into its actuals so the closed request
    // reads "actual = amount posted" (matches postDraftToBudget).
    const items = (data.items ?? []).map((it) => ({
      ...it,
      actualCents: it.estimatedCents ?? 0,
      actualQty: it.qty,
    }));
    patch.items = items;
    patch.actualTotalCents = Math.max(0, data.estimatedTotalCents ?? sumEstimated(data.items ?? []));
    patch.reconciledAt = serverTimestamp();
    patch.closedAt = serverTimestamp();
    patch.postedDirect = true;
  }
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
  byUid?: string,
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

  // Drivers v2 — closing a Service-kind request resets the vehicle's
  // service clock (baseline km + date). After the commit so a baseline
  // hiccup can't roll back the close.
  await resetServiceBaselineOnClose(familyId, reqData);

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

  // Utilities v2 — when a utility payment request linked to a recurring
  // bill closes, mark that bill paid for this period. This is the one
  // write that keeps the Outstanding banner, the bill's status pill, and
  // the Budget roll-up in sync (all three read Utility.lastPayment*).
  // After the batch so a payment-write failure can't roll back the close;
  // the actual amount paid (sumActual) is what we record, which may
  // differ from the bill's recurring figure.
  if (reqData?.module === 'utility' && reqData.utilityId) {
    try {
      const { getUtility, recordPayment, currentPeriodKey } = await import('./pantry');
      const bill = await getUtility(familyId, reqData.utilityId);
      if (bill) {
        const paidAt = Timestamp.now();
        const paymentId = await recordPayment(familyId, bill, {
          amountCents: sumActual(items),
          paidAt,
          paidBy: byUid || reqData.createdBy || '',
          periodKey: currentPeriodKey(paidAt.toDate()),
          reference: reqData.name || '',
          notes: '',
        });
        // Remember which payment we created so a later reopen/delete can
        // reverse exactly this one.
        await updateDoc(reqRef, { utilityPaymentId: paymentId, updatedAt: serverTimestamp() });
      }
    } catch { /* swallow — the bill can be marked paid manually if this fails */ }
  }
}

// ── Submit-for-close-review flow (2026-05-19) ───────────────────────
// Previously the helper pressed "Close · post to budget" and the
// actuals went straight to the family budget. Per Elia's request,
// we now insert a parent review step: helper submits → parent reviews
// (allocates overrun, decides savings, leaves a note) → parent posts
// to budget. State machine: reconciling → pending_close → closed.

/** Parent resolves a single over-band price exception on a request that
 *  is in close review. 'approved' lets the helper's price stand;
 *  'rejected' is recorded too (the parent can then kick back or post — the
 *  comment is always kept either way). Stamps who decided + an optional
 *  note onto the item. (2026-05-31) */
export async function resolvePriceException(
  familyId: string,
  requestId: string,
  itemId: string,
  decision: 'approved' | 'rejected',
  resolvedBy: string,
  parentNote?: string,
): Promise<void> {
  if (isGuestActive()) return;
  const reqRef = requestDoc(familyId, requestId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) return;
  const req = snap.data() as PurchaseRequest;
  const items = (req.items || []).map((i) =>
    i.id === itemId
      ? {
          ...i,
          priceException: decision,
          priceExceptionResolvedBy: resolvedBy,
          ...(parentNote && parentNote.trim() ? { priceExceptionParentNote: parentNote.trim() } : {}),
        }
      : i,
  );
  await updateDoc(reqRef, { items, updatedAt: serverTimestamp() });
}

/** True when a request still has an over-band price line awaiting a
 *  parent decision — used to gate the "post to budget" action. */
export function hasUnresolvedPriceException(req: Pick<PurchaseRequest, 'items'>): boolean {
  return (req.items || []).some((i) => i.priceException === 'pending');
}

/** Helper hands off a reconciled request to the parent for review.
 *  Writes the final items + actualTotalCents now (so the parent sees
 *  a frozen snapshot to review), flips status to pending_close, and
 *  stamps submittedForCloseAt/By. Receipt URL is finalized too — the
 *  parent shouldn't be reviewing a moving target. */
export async function submitForCloseReview(
  familyId: string,
  requestId: string,
  items: PurchaseRequestItem[],
  args: { submittedBy: string; receiptUrl?: string },
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'pending_close' as PurchaseRequestStatus,
    items,
    actualTotalCents: sumActual(items),
    receiptUrl: args.receiptUrl ?? '',
    reconciledAt: serverTimestamp(),
    submittedForCloseAt: serverTimestamp(),
    submittedForCloseBy: args.submittedBy,
    updatedAt: serverTimestamp(),
  });
}

/** Parent approves a pending_close request — applies overrun
 *  allocation + savings decision atomically, then runs closeReconcile
 *  (staple write-back, payroll deductions, status → closed). Single
 *  user-facing action; multiple writes underneath. */
export async function approveCloseAndPost(
  familyId: string,
  requestId: string,
  args: {
    decidedBy: string;
    closeApprovalNote?: string;
    /** Required when actuals went OVER approved budget. */
    overrunAllocation?: { kind: 'absorb' | 'unbudgeted' };
    /** Required when actuals came in UNDER approved budget. */
    savings?: {
      kind: 'tip' | 'balance' | 'skip';
      helperUid?: string;
    };
  },
): Promise<{ tipRequestId?: string }> {
  if (isGuestActive()) return {};
  const reqRef = requestDoc(familyId, requestId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('Request not found');
  const reqData = reqSnap.data() as PurchaseRequest;

  const approved = reqData.estimatedTotalCents;
  const actual = reqData.actualTotalCents ?? sumActual(reqData.items);
  const savingsCents = approved - actual;
  const overrunCents = actual - approved;

  // 1) Stamp the review-decision fields. Doing this BEFORE the close
  //    so post-close consumers (budget page, etc.) see the allocation
  //    in the same render that picks up status='closed'.
  const reviewPatch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (args.closeApprovalNote) {
    reviewPatch.closeApprovalNote = args.closeApprovalNote;
  }
  if (overrunCents > 0 && args.overrunAllocation) {
    reviewPatch.overrunAllocation = {
      kind: args.overrunAllocation.kind,
      amountCents: overrunCents,
      decidedBy: args.decidedBy,
      decidedAt: serverTimestamp(),
    };
  }
  if (Object.keys(reviewPatch).length > 1) {
    await updateDoc(reqRef, reviewPatch);
  }

  // 2) Apply savings decision if savings exist + a kind was picked.
  //    recordSavingsDecision stamps the savingsDecision field AND
  //    handles the tip-request creation + pendingModuleBalance bump.
  let tipRequestId: string | undefined;
  if (savingsCents > 0 && args.savings) {
    const r = await recordSavingsDecision(familyId, requestId, {
      kind: args.savings.kind,
      amountCents: savingsCents,
      helperUid: args.savings.kind === 'tip' ? args.savings.helperUid : undefined,
      module: args.savings.kind === 'balance' ? reqData.module : undefined,
      decidedBy: args.decidedBy,
    });
    tipRequestId = r.tipRequestId;
  }

  // 3) Post to budget — the existing closeReconcile handles status
  //    flip, staple write-back, payroll deductions, and (for bill-linked
  //    utility requests) marking the recurring bill paid for the period.
  await closeReconcile(familyId, requestId, reqData.items, reqData.receiptUrl, args.decidedBy);

  return { tipRequestId };
}

/** Optional kick-back: parent can send a pending_close request back
 *  to the helper for fixes (e.g. "you forgot the receipt"). Resets
 *  status to reconciling so the helper can edit + re-submit. */
export async function kickBackToReconcile(
  familyId: string,
  requestId: string,
  args: { decidedBy: string; reason?: string },
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(requestDoc(familyId, requestId), {
    status: 'reconciling' as PurchaseRequestStatus,
    // Keep submittedForCloseAt/By as a breadcrumb — the parent can
    // see it WAS submitted once; the new submit will overwrite.
    closeApprovalNote: args.reason
      ? `Sent back by parent: ${args.reason}`
      : 'Sent back by parent for revisions',
    updatedAt: serverTimestamp(),
  });
}

// ── Reopen a closed request (Reopen v1, 2026-05-20) ─────────────────
// Parent-only. Flips a `closed` request back to `reconciling` so the
// actuals/receipt are editable again and the existing submit-for-review
// → approve-&-post path can reclose it. Crucially it UNWINDS the close:
//   • the bill payment this close made is reversed → the bill drops back
//     into Outstanding until the parent recloses;
//   • the budget un-counts it automatically (it's no longer `closed`).
// Payroll is excluded in v1 (deduction re-credit is a follow-up).
//
// Legacy bridge: requests closed before the utilityId link existed have
// no back-reference. The bill still points forward via
// lastGeneratedRequestId, so we backfill utilityId from that — letting
// reopen → reclose clear bills that predate the link.
//
// Returns `{ ok: false, reason }` when the reopen is refused (so the UI
// can explain why) — currently only when the close already paid a
// savings tip out to the helper (see below). Otherwise `{ ok: true }`.
export type ReopenResult = { ok: true } | { ok: false; reason: string };

export async function reopenRequest(
  familyId: string,
  requestId: string,
  byUid: string,
): Promise<ReopenResult> {
  if (isGuestActive()) return { ok: true };
  const reqRef = requestDoc(familyId, requestId);
  const snap = await getDoc(reqRef);
  if (!snap.exists()) return { ok: true };
  const req = { id: snap.id, ...snap.data() } as PurchaseRequest;
  if (req.status !== 'closed') return { ok: true };   // only closed can reopen
  if (req.module === 'payroll') return { ok: true };  // v1 excludes payroll

  // ── Unwind the savings decision so the shop can't be double-counted
  //    when it recloses. Done FIRST and the block-case returns before
  //    any mutation, so a refused reopen leaves everything untouched.
  const sd = req.savingsDecision;
  if (sd && sd.kind === 'tip' && sd.tipRequestId) {
    const tipRef = requestDoc(familyId, sd.tipRequestId);
    const tipSnap = await getDoc(tipRef);
    if (tipSnap.exists()) {
      const tip = tipSnap.data() as PurchaseRequest;
      if (tip.status === 'closed') {
        // The tip was already received by the helper — clawing back paid
        // money silently would be wrong. Refuse and point them to fix it.
        return {
          ok: false,
          reason: `This shop's savings were already tipped to the helper and paid out (${tip.name || 'the payroll tip'} is closed). Undo that tip in Payroll first, so reclosing can't pay it twice.`,
        };
      }
      // Not yet received — cancel the pending tip request.
      if (tip.status !== 'rejected') {
        try { await deleteDoc(tipRef); } catch { /* swallow */ }
      }
    }
  }
  if (sd && sd.kind === 'balance' && sd.amountCents > 0) {
    // Pull the carried-forward balance back out, clamped at 0 so a
    // balance a later request already consumed can't go negative.
    const mod = req.module ?? 'pantry';
    try {
      await runTransaction(db, async (tx) => {
        const famRef = doc(db, 'families', familyId);
        const fsnap = await tx.get(famRef);
        const cur = ((fsnap.data() as { pendingModuleBalance?: Record<string, number> } | undefined)
          ?.pendingModuleBalance?.[mod]) ?? 0;
        tx.update(famRef, { [`pendingModuleBalance.${mod}`]: Math.max(0, cur - sd.amountCents) });
      });
    } catch { /* swallow — carry-forward is best-effort */ }
  }

  // Backfill the bill link for legacy utility requests.
  let utilityId = req.utilityId;
  if (req.module === 'utility' && !utilityId) {
    try {
      const { listUtilities } = await import('./pantry');
      const bills = await listUtilities(familyId);
      const bill = bills.find((b) => b.lastGeneratedRequestId === requestId);
      if (bill) utilityId = bill.id;
    } catch { /* swallow — link backfill is best-effort */ }
  }

  // Unwind the payment this close stamped on the bill, so it returns to
  // Outstanding. Best-effort: the bill can still be corrected via the
  // Log payment screen if this fails.
  if (req.module === 'utility' && utilityId && req.utilityPaymentId) {
    try {
      const { reverseUtilityPayment } = await import('./pantry');
      await reverseUtilityPayment(familyId, utilityId, req.utilityPaymentId);
    } catch { /* swallow */ }
  }

  const patch: Record<string, unknown> = {
    status: 'reconciling' as PurchaseRequestStatus,
    reopenedAt: serverTimestamp(),
    reopenedBy: byUid,
    reopenCount: (req.reopenCount ?? 0) + 1,
    // Clear the now-stale close stamps + the reversed savings decision so
    // the reclose review starts fresh.
    closedAt: deleteField(),
    utilityPaymentId: deleteField(),
    savingsDecision: deleteField(),
    updatedAt: serverTimestamp(),
  };
  // Persist a backfilled link so the reclose stamps the right bill.
  if (utilityId && !req.utilityId) patch.utilityId = utilityId;
  await updateDoc(reqRef, patch);
  return { ok: true };
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
  // draft / pending_approval never posted anything. `reconciling` is
  // reachable post-close only via reopenRequest, which already unwound
  // the bill payment + (by virtue of status ≠ closed) the budget, so
  // the doc is safe to remove with no further reversal here.
  if (status !== 'draft' && status !== 'pending_approval' && status !== 'reconciling') return;
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
  pending_close: 'Submitted for review',
  closed: 'Closed',
};

// ── Savings-decision flow (2026-05-19) ──────────────────────────────
// When a request closes UNDER approved budget, the parent decides
// what to do with the leftover: tip the helper (creates a payroll
// bonus request tagged 'savings_tip'), carry the balance forward to
// the next request in the same module (writes Family.pendingModuleBalance),
// or skip. Either way, `savingsDecision` is stamped on the request so
// the audit trail is permanent.

/** Suggest a default savings decision based on the savings ratio.
 *  Elia's rule: if savings < 1% of approved, the savings is too
 *  small to be a useful carry-forward — recommend a tip to the
 *  helper as a thank-you for closing tight. Above that, recommend
 *  carrying the balance forward so the family banks the saving. */
export function recommendedSavingsDecision(
  approvedCents: number,
  savingsCents: number,
): 'tip' | 'balance' {
  if (approvedCents <= 0 || savingsCents <= 0) return 'tip';
  return (savingsCents / approvedCents) < 0.01 ? 'tip' : 'balance';
}

/** Record the parent's savings decision on a closed request. Three
 *  paths:
 *    'tip'     → creates a payroll PAY-* request for the helper with
 *                category 'savings_tip', status 'approved' (parent's
 *                already deciding here — no need to re-approve).
 *    'balance' → writes to family.pendingModuleBalance[module], where
 *                the next createDraftRequest for that module will
 *                pick it up as a credit.
 *    'skip'    → just records the decision (no money movement).
 *  Idempotent on the savingsDecision field — re-running with the
 *  same request will be rejected by the UI (post-close, the card
 *  hides once savingsDecision is set). */
export async function recordSavingsDecision(
  familyId: string,
  requestId: string,
  args: {
    kind: 'tip' | 'balance' | 'skip';
    /** Snapshot — savings amount from approved - actual at decision time. */
    amountCents: number;
    /** Required when kind === 'tip'. */
    helperUid?: string;
    /** Required when kind === 'balance' — module the balance carries on. */
    module?: PurchaseModule;
    decidedBy: string;
  },
): Promise<{ tipRequestId?: string }> {
  if (isGuestActive()) return {};
  const decision: NonNullable<PurchaseRequest['savingsDecision']> = {
    kind: args.kind,
    amountCents: args.amountCents,
    decidedBy: args.decidedBy,
    // serverTimestamp() can't be nested inside an object on update;
    // we cast it later. Set to a sentinel here that we replace in the
    // patch payload below.
    decidedAt: serverTimestamp() as unknown as Timestamp,
    ...(args.helperUid ? { helperUid: args.helperUid } : {}),
  };

  let tipRequestId: string | undefined;

  if (args.kind === 'tip' && args.helperUid && args.amountCents > 0) {
    // Create a payroll-bonus request for the helper. Status starts
    // as 'approved' so it goes straight into the helper's "ready to
    // reconcile / receive" bucket — the parent has already approved
    // by deciding to tip. The helper's payroll page will surface it
    // alongside any other pay items.
    tipRequestId = await createDraftRequest(familyId, {
      module: 'payroll',
      helperUid: args.helperUid,
      createdBy: args.decidedBy,
      createdByRole: 'parent',
      payrollCycle: undefined,
      initialStatus: 'approved',
      items: [
        {
          id: `${Date.now().toString(36)}-tip`,
          name: 'Savings tip',
          category: 'other',
          qty: 1,
          unit: 'x',
          estimatedCents: args.amountCents,
          actualCents: args.amountCents,
          actualQty: 1,
        },
      ],
      context: 'savings tip',
    });
    decision.tipRequestId = tipRequestId;
  }

  if (args.kind === 'balance' && args.module && args.module !== 'payroll' && args.amountCents > 0) {
    // Add to family.pendingModuleBalance[module] — next request in
    // this module reads + consumes it.
    await updateDoc(doc(db, 'families', familyId), {
      [`pendingModuleBalance.${args.module}`]: (
        // Read-modify-write would race; Firestore increment is the safe
        // primitive here. Use FieldValue.increment via the SDK helper.
        // (Imported below — we use the modular `increment` from
        // firebase/firestore.)
        increment(args.amountCents)
      ),
    });
  }

  // Stamp the decision on the request.
  await updateDoc(requestDoc(familyId, requestId), {
    savingsDecision: decision,
    updatedAt: serverTimestamp(),
  });
  return { tipRequestId };
}
