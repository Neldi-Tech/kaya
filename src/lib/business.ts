// Kaya Business · data layer.
//
// Each kid runs ONE business — a singleton doc plus flat collections of
// assets, sales and costs. Money never moves here directly: sales and
// wallet-funded costs become entries in the shared Hive `approvalRequests`
// queue (types `business_sale` / `business_cost`), and Hive's
// `resolveApprovalRequest` does the atomic wallet write on parent approval.
// Float-funded costs are the one exception — they draw down the
// parent-funded `floatBalanceCents` on the business doc and never touch
// the Hive wallet.
//
// All collections live under `families/{familyId}/kids/{kidId}/...` so the
// existing `kids/{kidId}/{document=**}` read rule already grants the whole
// family read access; only write rules are added in firestore.rules.
//
// Like hive.ts this is all client-side `runTransaction` / `writeBatch`
// (Spark plan — no Cloud Functions). Parent-vs-kid is enforced in the
// rules; this module trusts them and fails fast on obvious errors.

import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, orderBy, limit, where, Timestamp, serverTimestamp,
  onSnapshot, writeBatch, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { CashDestination } from './hive';

// ── Types ─────────────────────────────────────────────────────────

export type AssetTypeKey =
  | 'passion_fruit' | 'laying_hen' | 'veg_garden' | 'goat'
  | 'bakery_product' | 'custom';

export type CostFundingSource = 'float' | 'wallet';
export type SaleType = 'family' | 'relative';

/** Lifecycle of a sale or cost as it moves through parent approval.
 *  Float-funded costs skip straight to `approved`. */
export type BusinessApprovalStatus = 'pending_approval' | 'approved' | 'rejected';

export type LossReason =
  | 'died' | 'lost' | 'given_away' | 'consumed_at_home' | 'spoiled' | 'other';

export type CostCategory =
  | 'feed' | 'seed' | 'fertilizer' | 'packaging' | 'tools'
  | 'ingredients' | 'other';

export interface AssetStage {
  key: string;
  label: string;
  /** A loose starting hint for the per-unit price (family-currency minor
   *  units). The kid sets the real number when adding the asset. */
  defaultUnitPriceCents: number;
}

export interface BusinessAssetType {
  key: AssetTypeKey;
  name: string;
  emoji: string;
  /** Default unit label for this type's assets (e.g. "vines", "hens"). */
  unit: string;
  /** Ordered stage progression — last entry is the terminal "retired". */
  stages: AssetStage[];
}

/** The business singleton — one per kid, at kids/{kidId}/business/config. */
export interface Business {
  tagline: string;                       // kid-written, e.g. "Diella's Garden Magic"
  emoji: string;
  active: boolean;
  // ── Cost float (parent-funded working capital) ──
  floatBalanceCents: number;
  floatLifetimeFundedCents: number;
  costFundingDefault: CostFundingSource;
  // ── Sale defaults ──
  /** Reserved for v1.1 auto-approve-under-threshold. 0 = always approve. */
  saleAutoApproveUnderCents: number;
  defaultSaleCashDestination: CashDestination;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const EMPTY_BUSINESS: Omit<Business, 'createdAt' | 'updatedAt'> = {
  tagline: '',
  emoji: '🌱',
  active: true,
  floatBalanceCents: 0,
  floatLifetimeFundedCents: 0,
  costFundingDefault: 'wallet',
  saleAutoApproveUnderCents: 0,
  defaultSaleCashDestination: 'on_hand',
};

export interface Asset {
  id: string;
  typeKey: AssetTypeKey;
  name: string;
  count: number;
  stage: string;            // matches a stage key of the asset's type
  unitPriceCents: number;   // current per-unit valuation, family-currency cents
  notes?: string;
  retiredAt?: Timestamp | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface AssetLossEvent {
  id: string;
  occurredAt: Timestamp;
  countLost: number;
  reason: LossReason;
  notes?: string;
  estValueLostCents: number;   // non-cash cost — surfaces in the weekly P&L
  loggedByKidId: string;
}

export interface SaleItem {
  itemName: string;
  emoji?: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
}

export interface Sale {
  id: string;
  saleDate: Timestamp;
  saleType: SaleType;
  buyerName: string;
  items: SaleItem[];
  totalCents: number;
  cashDestination: CashDestination;
  status: BusinessApprovalStatus;
  hiveTxId?: string;
  hiveApprovalRequestId?: string;
  approvedByParentId?: string;
  rejectionReason?: string;
  createdBy: string;
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}

export interface Cost {
  id: string;
  costDate: Timestamp;
  category: CostCategory;
  description: string;
  amountCents: number;
  fundingSource: CostFundingSource;
  /** Float-funded costs are `approved` on creation. Wallet-funded costs
   *  start `pending_approval` and resolve through the Hive queue. */
  status: BusinessApprovalStatus;
  hiveTxId?: string;
  hiveApprovalRequestId?: string;
  approvedByParentId?: string;
  rejectionReason?: string;
  createdBy: string;
  createdAt: Timestamp;
  resolvedAt?: Timestamp;
}

export interface PriceListItem {
  id: string;
  itemName: string;
  emoji?: string;
  unit: string;
  unitPriceCents: number;
  /** Optional — restrict this item to one kid's sale catalog. */
  sellerKidId?: string;
  active: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FloatTopUp {
  id: string;
  amountCents: number;
  note?: string;
  byParentId: string;
  occurredAt: Timestamp;
}

// ── Asset-type catalog ────────────────────────────────────────────
// v1 ships five built-in types plus a generic "custom" slot. Stored as
// a code constant (not Firestore) — a family-editable asset library is
// a deferred v2 concern. `defaultUnitPriceCents` is a loose hint only;
// the kid sets the real per-unit price when adding the asset.

export const BUSINESS_ASSET_TYPES: BusinessAssetType[] = [
  {
    key: 'passion_fruit',
    name: 'Passion fruit',
    emoji: '🍈',
    unit: 'vines',
    stages: [
      { key: 'seedling', label: 'Seedling', defaultUnitPriceCents: 150_00 },
      { key: 'growing',  label: 'Growing',  defaultUnitPriceCents: 300_00 },
      { key: 'fruiting', label: 'Fruiting', defaultUnitPriceCents: 600_00 },
      { key: 'retired',  label: 'Retired',  defaultUnitPriceCents: 0 },
    ],
  },
  {
    key: 'laying_hen',
    name: 'Laying hens',
    emoji: '🐔',
    unit: 'hens',
    stages: [
      { key: 'chick',   label: 'Chick',   defaultUnitPriceCents: 500_00 },
      { key: 'pullet',  label: 'Pullet',  defaultUnitPriceCents: 1_200_00 },
      { key: 'laying',  label: 'Laying',  defaultUnitPriceCents: 2_500_00 },
      { key: 'retired', label: 'Retired', defaultUnitPriceCents: 800_00 },
    ],
  },
  {
    key: 'veg_garden',
    name: 'Vegetable garden',
    emoji: '🥬',
    unit: 'plants',
    stages: [
      { key: 'seedling',  label: 'Seedling',  defaultUnitPriceCents: 50_00 },
      { key: 'producing', label: 'Producing', defaultUnitPriceCents: 150_00 },
      { key: 'retired',   label: 'Retired',   defaultUnitPriceCents: 0 },
    ],
  },
  {
    key: 'goat',
    name: 'Goats',
    emoji: '🐐',
    unit: 'goats',
    stages: [
      { key: 'kid',     label: 'Kid',     defaultUnitPriceCents: 3_000_00 },
      { key: 'adult',   label: 'Adult',   defaultUnitPriceCents: 8_000_00 },
      { key: 'retired', label: 'Retired', defaultUnitPriceCents: 4_000_00 },
    ],
  },
  {
    key: 'bakery_product',
    name: 'Bakery / kitchen',
    emoji: '🍪',
    unit: 'batches',
    stages: [
      { key: 'active',  label: 'Active',  defaultUnitPriceCents: 0 },
      { key: 'retired', label: 'Retired', defaultUnitPriceCents: 0 },
    ],
  },
  {
    key: 'custom',
    name: 'Something else',
    emoji: '🌱',
    unit: 'units',
    stages: [
      { key: 'active',  label: 'Active',  defaultUnitPriceCents: 0 },
      { key: 'retired', label: 'Retired', defaultUnitPriceCents: 0 },
    ],
  },
];

export const COST_CATEGORIES: { id: CostCategory; emoji: string; label: string }[] = [
  { id: 'feed',        emoji: '🌾', label: 'Feed' },
  { id: 'seed',        emoji: '🌰', label: 'Seed / seedlings' },
  { id: 'fertilizer',  emoji: '🧪', label: 'Fertilizer' },
  { id: 'packaging',   emoji: '📦', label: 'Packaging' },
  { id: 'tools',       emoji: '🛠️', label: 'Tools' },
  { id: 'ingredients', emoji: '🧂', label: 'Ingredients' },
  { id: 'other',       emoji: '✨', label: 'Other' },
];

export const LOSS_REASONS: { id: LossReason; emoji: string; label: string }[] = [
  { id: 'died',             emoji: '💔', label: 'Died' },
  { id: 'lost',             emoji: '❓', label: 'Lost' },
  { id: 'given_away',       emoji: '🎁', label: 'Given away' },
  { id: 'consumed_at_home', emoji: '🍽️', label: 'Eaten at home' },
  { id: 'spoiled',          emoji: '🦠', label: 'Spoiled' },
  { id: 'other',            emoji: '•',  label: 'Other' },
];

// ── Pure helpers ──────────────────────────────────────────────────

/** Look up a built-in asset type by key; falls back to the custom slot. */
export function assetType(key: AssetTypeKey): BusinessAssetType {
  return BUSINESS_ASSET_TYPES.find((t) => t.key === key)
    || BUSINESS_ASSET_TYPES[BUSINESS_ASSET_TYPES.length - 1];
}

/** Stage meta for an asset (label + default price hint). */
export function assetStage(typeKey: AssetTypeKey, stageKey: string): AssetStage | undefined {
  return assetType(typeKey).stages.find((s) => s.key === stageKey);
}

/** Live valuation of one asset: count × current unit price. */
export function assetValuationCents(asset: Pick<Asset, 'count' | 'unitPriceCents'>): number {
  return Math.max(0, Math.round(asset.count * asset.unitPriceCents));
}

/** Total asset value across a kid's active (non-retired) assets. */
export function totalAssetValueCents(assets: Asset[]): number {
  return assets
    .filter((a) => !a.retiredAt && a.stage !== 'retired')
    .reduce((sum, a) => sum + assetValuationCents(a), 0);
}

/** Sum the cents that actually moved this week — approved sales minus
 *  approved costs. `since` is an epoch-ms cutoff. */
export function weeklyNetCents(
  sales: Sale[], costs: Cost[], since: number,
): { revenueCents: number; costsCents: number; profitCents: number } {
  const inWindow = (ts: any) => {
    const ms = ts?.toMillis?.();
    return typeof ms === 'number' && ms >= since;
  };
  let revenueCents = 0;
  for (const s of sales) {
    if (s.status !== 'approved') continue;
    if (!inWindow(s.saleDate) && !inWindow(s.createdAt)) continue;
    revenueCents += s.totalCents;
  }
  let costsCents = 0;
  for (const c of costs) {
    if (c.status !== 'approved') continue;
    if (!inWindow(c.costDate) && !inWindow(c.createdAt)) continue;
    costsCents += c.amountCents;
  }
  return { revenueCents, costsCents, profitCents: revenueCents - costsCents };
}

// ── Path helpers ──────────────────────────────────────────────────

const businessRef = (familyId: string, kidId: string) =>
  doc(db, 'families', familyId, 'kids', kidId, 'business', 'config');

const assetCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'assets');

const lossCol = (familyId: string, kidId: string, assetId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'assets', assetId, 'lossEvents');

const saleCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'sales');

const costCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'costs');

const floatTopUpCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'business', 'config', 'floatTopUps');

const priceListCol = (familyId: string) =>
  collection(db, 'families', familyId, 'priceList');

const approvalCol = (familyId: string) =>
  collection(db, 'families', familyId, 'approvalRequests');

// ── Reads + subscriptions ─────────────────────────────────────────

export async function getBusiness(familyId: string, kidId: string): Promise<Business | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(businessRef(familyId, kidId));
  return snap.exists() ? (snap.data() as Business) : null;
}

export function subscribeToBusiness(
  familyId: string, kidId: string, cb: (b: Business | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(businessRef(familyId, kidId), (snap) => {
    cb(snap.exists() ? (snap.data() as Business) : null);
  });
}

export function subscribeToAssets(
  familyId: string, kidId: string, cb: (assets: Asset[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(query(assetCol(familyId, kidId), orderBy('createdAt', 'asc')), (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
  });
}

export function subscribeToAssetLosses(
  familyId: string, kidId: string, assetId: string, cb: (losses: AssetLossEvent[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(
    query(lossCol(familyId, kidId, assetId), orderBy('occurredAt', 'desc')),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as AssetLossEvent))),
  );
}

export function subscribeToSales(
  familyId: string, kidId: string, cb: (sales: Sale[]) => void, max = 100,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(
    query(saleCol(familyId, kidId), orderBy('createdAt', 'desc'), limit(max)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Sale))),
  );
}

export function subscribeToCosts(
  familyId: string, kidId: string, cb: (costs: Cost[]) => void, max = 100,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(
    query(costCol(familyId, kidId), orderBy('createdAt', 'desc'), limit(max)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Cost))),
  );
}

export function subscribeToFloatTopUps(
  familyId: string, kidId: string, cb: (topUps: FloatTopUp[]) => void, max = 50,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(
    query(floatTopUpCol(familyId, kidId), orderBy('occurredAt', 'desc'), limit(max)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as FloatTopUp))),
  );
}

export function subscribeToPriceList(
  familyId: string, cb: (items: PriceListItem[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(query(priceListCol(familyId), orderBy('itemName', 'asc')), (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as PriceListItem)));
  });
}

// ── Business config ───────────────────────────────────────────────

/** Create the business singleton if it doesn't exist yet. Idempotent —
 *  safe to call on every visit to the Business tab. */
export async function ensureBusiness(
  familyId: string, kidId: string, tagline = '',
): Promise<void> {
  if (isGuestActive()) return;
  const ref = businessRef(familyId, kidId);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  await setDoc(ref, {
    ...EMPTY_BUSINESS,
    tagline: tagline.trim(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** Patch editable business config (tagline, emoji, defaults). Does not
 *  touch the float — that only moves through `topUpFloat` / cost debits. */
export async function setBusinessConfig(
  familyId: string, kidId: string,
  patch: Partial<Pick<Business,
    'tagline' | 'emoji' | 'active' | 'costFundingDefault'
    | 'saleAutoApproveUnderCents' | 'defaultSaleCashDestination'>>,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(
    businessRef(familyId, kidId),
    { ...patch, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Parent funds the kid's working-capital float. Atomic: bumps the
 *  balance + lifetime total on the business doc and logs a topUp row. */
export async function topUpFloat(
  familyId: string, kidId: string, amountCents: number, byParentId: string, note = '',
): Promise<void> {
  if (isGuestActive()) return;
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('Top-up amount must be positive.');
  }
  await runTransaction(db, async (txn) => {
    const ref = businessRef(familyId, kidId);
    const snap = await txn.get(ref);
    if (!snap.exists()) throw new Error('Business not set up yet.');
    const b = snap.data() as Business;
    txn.set(ref, {
      ...b,
      floatBalanceCents: b.floatBalanceCents + amountCents,
      floatLifetimeFundedCents: b.floatLifetimeFundedCents + amountCents,
      updatedAt: serverTimestamp(),
    });
    txn.set(doc(floatTopUpCol(familyId, kidId)), {
      amountCents, note: note.trim(), byParentId, occurredAt: serverTimestamp(),
    });
  });
}

// ── Assets ────────────────────────────────────────────────────────

export async function addAsset(
  familyId: string, kidId: string,
  input: { typeKey: AssetTypeKey; name: string; count: number; stage: string; unitPriceCents: number; notes?: string },
): Promise<string> {
  if (isGuestActive()) return 'guest-asset';
  if (!input.name.trim()) throw new Error('Give the asset a name.');
  if (!Number.isFinite(input.count) || input.count <= 0) throw new Error('Count must be positive.');
  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) throw new Error('Price must be 0 or more.');
  const ref = await addDoc(assetCol(familyId, kidId), {
    typeKey: input.typeKey,
    name: input.name.trim(),
    count: input.count,
    stage: input.stage,
    unitPriceCents: input.unitPriceCents,
    notes: input.notes?.trim() || '',
    retiredAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Adjust an asset's count and/or per-unit price. For a *drop* in count
 *  the caller should log a loss event separately via `logAssetLoss`. */
export async function updateAsset(
  familyId: string, kidId: string, assetId: string,
  patch: Partial<Pick<Asset, 'count' | 'unitPriceCents' | 'name' | 'notes'>>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(assetCol(familyId, kidId), assetId), {
    ...patch, updatedAt: serverTimestamp(),
  });
}

/** Advance / change an asset's stage. The caller passes the new
 *  `unitPriceCents` (UI pre-fills it from the stage's default hint). */
export async function updateAssetStage(
  familyId: string, kidId: string, assetId: string,
  newStage: string, newUnitPriceCents: number,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(assetCol(familyId, kidId), assetId), {
    stage: newStage,
    unitPriceCents: newUnitPriceCents,
    updatedAt: serverTimestamp(),
  });
}

/** Log a loss (death / spoilage / give-away). Atomic: writes the loss
 *  event and decrements the asset's count in one transaction. */
export async function logAssetLoss(
  familyId: string, kidId: string, assetId: string,
  input: { countLost: number; reason: LossReason; notes?: string; estValueLostCents: number; loggedByKidId: string },
): Promise<void> {
  if (isGuestActive()) return;
  if (!Number.isFinite(input.countLost) || input.countLost <= 0) throw new Error('Count lost must be positive.');
  await runTransaction(db, async (txn) => {
    const aRef = doc(assetCol(familyId, kidId), assetId);
    const aSnap = await txn.get(aRef);
    if (!aSnap.exists()) throw new Error('Asset not found.');
    const asset = aSnap.data() as Asset;
    const nextCount = Math.max(0, asset.count - input.countLost);
    txn.set(doc(lossCol(familyId, kidId, assetId)), {
      occurredAt: serverTimestamp(),
      countLost: input.countLost,
      reason: input.reason,
      notes: input.notes?.trim() || '',
      estValueLostCents: Math.max(0, Math.round(input.estValueLostCents)),
      loggedByKidId: input.loggedByKidId,
    });
    txn.update(aRef, { count: nextCount, updatedAt: serverTimestamp() });
  });
}

/** Wind an asset down — keeps it in history but out of active valuation. */
export async function retireAsset(
  familyId: string, kidId: string, assetId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(assetCol(familyId, kidId), assetId), {
    stage: 'retired',
    retiredAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ── Sales ─────────────────────────────────────────────────────────

/**
 * Log a sale. Always creates a `pending_approval` sale doc plus a paired
 * Hive `approvalRequest` of type `business_sale` — written together in a
 * batch so they can't orphan each other. On parent approval Hive's
 * `resolveApprovalRequest` credits the chosen Cash sub-balance and flips
 * this sale doc to `approved`.
 *
 * (Auto-approve-under-threshold is a v1.1 refinement — for now every sale
 * goes through the parent queue.)
 */
export async function submitSale(
  familyId: string, kidId: string,
  input: {
    saleType: SaleType;
    buyerName: string;
    buyerKidIdOrUserId?: string;
    items: SaleItem[];
    cashDestination: CashDestination;
    createdBy: string;
  },
): Promise<{ saleId: string; requestId: string }> {
  if (isGuestActive()) return { saleId: 'guest-sale', requestId: 'guest-req' };
  if (!input.buyerName.trim()) throw new Error('Who is buying?');
  if (input.items.length === 0) throw new Error('Add at least one item.');
  const totalCents = input.items.reduce(
    (sum, it) => sum + Math.round(it.quantity * it.unitPriceCents), 0,
  );
  if (totalCents <= 0) throw new Error('Sale total must be positive.');

  const batch = writeBatch(db);
  const saleRef = doc(saleCol(familyId, kidId));
  const reqRef = doc(approvalCol(familyId));
  const itemSummary = input.items
    .map((it) => `${it.quantity} ${it.unit} ${it.itemName}`)
    .join(', ');

  batch.set(saleRef, {
    saleDate: serverTimestamp(),
    saleType: input.saleType,
    buyerName: input.buyerName.trim(),
    items: input.items,
    totalCents,
    cashDestination: input.cashDestination,
    status: 'pending_approval' as BusinessApprovalStatus,
    hiveApprovalRequestId: reqRef.id,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
  });
  batch.set(reqRef, {
    kidId,
    type: 'business_sale',
    amountCents: totalCents,
    cashDestination: input.cashDestination,
    ventureSaleId: saleRef.id,
    description: `Sale to ${input.buyerName.trim()} · ${itemSummary}`,
    status: 'pending',
    createdAt: serverTimestamp(),
    createdBy: input.createdBy,
  });
  await batch.commit();
  return { saleId: saleRef.id, requestId: reqRef.id };
}

// ── Costs ─────────────────────────────────────────────────────────

/**
 * Log a cost. Two paths:
 *  - `float`  → atomic: checks + debits the parent-funded float, writes
 *               the cost doc already `approved`. Never touches Hive.
 *  - `wallet` → batch: a `pending_approval` cost doc + a Hive
 *               `approvalRequest` of type `business_cost`. On approval
 *               Hive debits the kid's on-hand Cash.
 */
export async function submitCost(
  familyId: string, kidId: string,
  input: {
    category: CostCategory;
    description: string;
    amountCents: number;
    fundingSource: CostFundingSource;
    createdBy: string;
  },
): Promise<{ costId: string; requestId?: string }> {
  if (isGuestActive()) return { costId: 'guest-cost' };
  if (!input.description.trim()) throw new Error('What is the cost for?');
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('Cost amount must be positive.');
  }

  if (input.fundingSource === 'float') {
    let costId = '';
    await runTransaction(db, async (txn) => {
      const bRef = businessRef(familyId, kidId);
      const bSnap = await txn.get(bRef);
      if (!bSnap.exists()) throw new Error('Business not set up yet.');
      const b = bSnap.data() as Business;
      if (b.floatBalanceCents < input.amountCents) {
        throw new Error('Not enough in the float. Ask a parent to top it up.');
      }
      const cRef = doc(costCol(familyId, kidId));
      costId = cRef.id;
      txn.set(bRef, {
        ...b,
        floatBalanceCents: b.floatBalanceCents - input.amountCents,
        updatedAt: serverTimestamp(),
      });
      txn.set(cRef, {
        costDate: serverTimestamp(),
        category: input.category,
        description: input.description.trim(),
        amountCents: input.amountCents,
        fundingSource: 'float' as CostFundingSource,
        status: 'approved' as BusinessApprovalStatus,
        createdBy: input.createdBy,
        createdAt: serverTimestamp(),
        resolvedAt: serverTimestamp(),
      });
    });
    return { costId };
  }

  // Wallet-funded — needs parent approval through the Hive queue.
  const batch = writeBatch(db);
  const costRef = doc(costCol(familyId, kidId));
  const reqRef = doc(approvalCol(familyId));
  batch.set(costRef, {
    costDate: serverTimestamp(),
    category: input.category,
    description: input.description.trim(),
    amountCents: input.amountCents,
    fundingSource: 'wallet' as CostFundingSource,
    status: 'pending_approval' as BusinessApprovalStatus,
    hiveApprovalRequestId: reqRef.id,
    createdBy: input.createdBy,
    createdAt: serverTimestamp(),
  });
  batch.set(reqRef, {
    kidId,
    type: 'business_cost',
    amountCents: input.amountCents,
    ventureCostId: costRef.id,
    description: `Business cost · ${input.description.trim()}`,
    category: 'business',
    status: 'pending',
    createdAt: serverTimestamp(),
    createdBy: input.createdBy,
  });
  await batch.commit();
  return { costId: costRef.id, requestId: reqRef.id };
}

// ── Family price list ─────────────────────────────────────────────

/** Upsert a price-list item (parent action). Pass `id` to edit. */
export async function setPriceListItem(
  familyId: string,
  input: {
    id?: string;
    itemName: string;
    emoji?: string;
    unit: string;
    unitPriceCents: number;
    sellerKidId?: string;
    active?: boolean;
  },
): Promise<string> {
  if (isGuestActive()) return 'guest-price';
  if (!input.itemName.trim()) throw new Error('Name the item.');
  if (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0) {
    throw new Error('Price must be 0 or more.');
  }
  const data = {
    itemName: input.itemName.trim(),
    emoji: input.emoji?.trim() || '',
    unit: input.unit.trim() || 'unit',
    unitPriceCents: input.unitPriceCents,
    sellerKidId: input.sellerKidId || '',
    active: input.active ?? true,
    updatedAt: serverTimestamp(),
  };
  if (input.id) {
    await setDoc(doc(priceListCol(familyId), input.id), data, { merge: true });
    return input.id;
  }
  const ref = await addDoc(priceListCol(familyId), {
    ...data, createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Soft-remove a price-list item (kept for historical sales references). */
export async function deactivatePriceListItem(
  familyId: string, itemId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(
    doc(priceListCol(familyId), itemId),
    { active: false, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

/** Hard-delete a price-list item. */
export async function deletePriceListItem(
  familyId: string, itemId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(priceListCol(familyId), itemId));
}
