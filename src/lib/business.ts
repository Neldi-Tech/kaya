// Kaya Business · Phase 1 data layer.
//
// The micro-enterprise layer that bridges Kaya (House Points) and The Hive
// (real money). A kid runs a tiny company with proper books: inventory,
// sales, costs, profit — and the profit sweeps into their Hive Cash wallet.
//
// ── Collection layout ─────────────────────────────────────────────
//   families/{f}/businesses/{businessId}            identity + status + denormalized stats
//   families/{f}/businesses/{businessId}/items/{id} inventory (assets + stock)
//   families/{f}/businesses/{businessId}/ledger/{id} the books (sales + costs, append-only)
//   families/{f}/kids/{kidId}/investments/{symbol}  Junior Investor simulated holdings
//   families/{f}/kids/{kidId}/businessMilestones/{id} unlocked milestones
//   marketQuotes/{symbol}                           top-level, server-written real prices (USD)
//
// Business data that's per-kid (investments, milestones) lives under the
// existing Hive kid sub-tree (`kids/{kidId}/...`) so the platform read rule
// `match /kids/{kidId}/{document=**}` already grants family read — and the
// Portfolio screen reads them alongside the wallet with no new top-level query.
//
// ── Money ─────────────────────────────────────────────────────────
// Every amount is an INTEGER in the minor units ("cents") of the family's
// display currency (`hiveConfig.currency`) — identical to `wallet.cashCents`
// in hive.ts. A paid sale's profit therefore drops into Hive Cash with no
// per-record FX conversion. The ONE exception is investment prices: real
// stock prices are quoted in USD (`MarketQuote.priceUsd`) and converted to
// the family currency at *display* time using the same `fxUsdToFamily` the
// Hive already computes (see HiveContext). Stored cost basis stays in family
// cents so a holding's "what you put in" never drifts with the FX rate.
//
// ── Scope ─────────────────────────────────────────────────────────
// This module is the PR1 foundation: types, constants, config, path helpers,
// pure roll-up math, and read/subscribe functions. Mutations that move money
// or recompute stats (createBusiness, logSale, logCost, addItem,
// buyInvestment, the milestone engine) land in their own PRs and run through
// `runTransaction` like the Hive does. Every read is guarded for guest mode.

import {
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, runTransaction,
  query, where, orderBy, limit, onSnapshot,
  Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
// Type-only — Business reuses the Hive's unified `approvalRequests` queue.
// hive.ts does not import this module, so this is cycle-free.
import type { ApprovalRequest } from './hive';

// ── Business identity ─────────────────────────────────────────────

// Full type space. Phase 1 ships goods/service/adhoc; the rest are defined
// now so the data model + UI switches don't need a rewrite when Phase 2
// turns them on (`PHASE1_BUSINESS_TYPES` gates what's currently creatable).
export type BusinessType =
  | 'goods' | 'service' | 'adhoc'
  | 'advice' | 'sport' | 'learning' | 'coop';

export type BusinessStatus = 'idea' | 'pilot' | 'active' | 'paused' | 'closed';

// Where a business is allowed to sell. Neighbours is parent-gated (dual-parent
// unlock) and external/marketplace is Phase 3 — both defined for forward
// compatibility; `PHASE1_CHANNELS` gates the current set.
export type CustomerChannel = 'family' | 'relatives' | 'neighbours' | 'external';

/** Profit allocation percentages. Must sum to 100. Advisory in Phase 1: the
 *  wallet stays a single cash balance; this drives the displayed breakdown
 *  and the 1-tap Goal/Invest actions, not four stored sub-balances. */
export interface HiveSplit {
  spend: number;
  save: number;
  goal: number;
  invest: number;
}

export interface BusinessStats {
  /** assets + stock@market + retained business cash. The headline number. */
  worthCents: number;
  assetsCents: number;
  stockMarketCents: number;
  /** Profit kept inside the business (reinvested / not yet swept to Hive). */
  cashPositionCents: number;
  monthRevenueCents: number;
  monthProfitCents: number;
  lifetimeProfitCents: number;
  salesCount: number;
  lastActivityAt?: Timestamp;
}

export const EMPTY_STATS: BusinessStats = {
  worthCents: 0,
  assetsCents: 0,
  stockMarketCents: 0,
  cashPositionCents: 0,
  monthRevenueCents: 0,
  monthProfitCents: 0,
  lifetimeProfitCents: 0,
  salesCount: 0,
};

export interface Business {
  id: string;
  /** Child.id of the sole owner. Phase 2 co-ops add `ownerIds[]`; until then
   *  this single field is the source of truth and `ownerIds` is ignored. */
  ownerId: string;
  ownerIds?: string[];          // Phase 2 (co-ops) — hook only
  type: BusinessType;
  status: BusinessStatus;
  name: string;
  mission?: string;
  emoji: string;
  customerChannels: CustomerChannel[];
  // ── Pricing ──
  unitLabel?: string;           // "fruit", "wash", "session"
  unitPriceCents?: number;      // current sale price
  /** A single parent can move price within this band; outside it needs an
   *  approval request (type 'business_price_change'). */
  priceBand?: { minCents: number; maxCents: number };
  // ── Hive routing ──
  hiveSplit: HiveSplit;         // effective split (defaults from BusinessConfig)
  reinvestPct?: number;         // 0–100 kept in the business instead of swept
  // ── Denormalized roll-up (recomputed on item/ledger writes, like the Hive
  //    wallet) so the Family Grid + Portfolio read one doc, never the ledger.
  stats: BusinessStats;
  // ── Ad-hoc lifecycle ──
  autoCloseAfterDays?: number;  // default from config (14)
  createdBy: string;
  createdAt: Timestamp;
  startedAt?: Timestamp;        // idea → pilot/active
  closedAt?: Timestamp;
}

// ── Inventory ─────────────────────────────────────────────────────

export type ItemKind =
  | 'asset'   // keeps working for you: trees, hens, tools, infrastructure
  | 'stock';  // ready (or ripening) to sell: fruits, eggs, finished crafts

export interface BusinessItem {
  id: string;
  businessId: string;
  kind: ItemKind;
  /** Named single item ("Big Mama"), a grouped batch ("Batch C-12"), or a
   *  stock pile by stage. `qty` is 1 for a single named item, N for a batch. */
  name: string;
  groupId?: string;             // optional grouping key/label for batches
  qty: number;
  /** Business-defined lifecycle stage. Free-form so each business type names
   *  its own: fruit → ready|ripening|flowering|spoiled; eggs → eggsToday|…;
   *  orchids → mature-blooming|young|seedling. Assets often have no stage. */
  stage?: string;
  unitCostCents?: number;       // cost basis per unit (what you spent)
  unitMarketCents?: number;     // current market value per unit
  producing?: boolean;          // assets: is it generating output right now
  /** Counts toward worth. Defaults true; set false for not-yet-sellable stock
   *  (e.g. flowering) so worth isn't inflated by stock that may not arrive. */
  countedInWorth: boolean;
  loss?: boolean;               // spoilage / death write-off (never counted)
  notes?: string;
  photoUrl?: string;
  acquiredAt?: Timestamp;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// ── The books (sales + costs) ─────────────────────────────────────

export type LedgerKind = 'sale' | 'cost';
export type PaymentMethod = 'cash' | 'hive_transfer' | 'iou';
/** IOU sales are 'unpaid' until settled — profit only sweeps to Hive once a
 *  sale is 'paid', so a receivable doesn't inflate the wallet early. */
export type PaymentStatus = 'paid' | 'unpaid';
export type CostType = 'supplies' | 'tools' | 'help' | 'other';

export interface LedgerEntry {
  id: string;
  businessId: string;
  ownerId: string;              // denormalized for kid-wide (cross-business) roll-ups
  kind: LedgerKind;
  // ── Sale fields ──
  customerRef?: string;         // member uid | contactId | '' for free-text
  customerLabel?: string;       // display name ("Aunty Mary")
  qty?: number;
  unitPriceCents?: number;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  // ── Cost fields ──
  costType?: CostType;
  receiptPhotoUrl?: string;
  // ── Shared ──
  description: string;
  amountCents: number;          // always positive; `kind` gives the sign
  /** The Hive cash transaction created when a paid sale's profit swept. */
  hiveDepositTxId?: string;
  occurredAt: Timestamp;        // when it actually happened (editable)
  createdBy: string;
  createdAt: Timestamp;
  // Books are append-only — corrections write a fresh voiding entry rather
  // than mutating history (rules make ledger docs immutable).
  voided?: boolean;
  voidReason?: string;
}

// ── Junior Investor (simulated) ───────────────────────────────────

export interface InvestmentHolding {
  id: string;                   // = symbol (one holding doc per instrument)
  symbol: string;
  label: string;
  emoji: string;
  shares: number;               // fractional allowed
  costBasisCents: number;       // total virtual money put in (family cents)
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface Instrument {
  symbol: string;               // internal id ("LEGO_INDEX", "DIS", "SP500")
  label: string;
  emoji: string;
  blurb: string;                // kid-friendly one-liner
  kind: 'stock' | 'fund' | 'basket';
  /** Ticker the price feed uses. Absent for synthetic baskets (priced by a
   *  server-side recipe in PR6). */
  quoteSymbol?: string;
}

/** Top-level marketQuotes/{symbol} — server-written daily real price in USD. */
export interface MarketQuote {
  symbol: string;
  priceUsd: number;
  asOf: Timestamp;
}

// ── Milestones ────────────────────────────────────────────────────

export type MilestoneScope = 'business' | 'kid' | 'investing';

export interface MilestoneDef {
  key: string;
  label: string;
  emoji: string;
  scope: MilestoneScope;
  description: string;
}

export interface BusinessMilestone {
  id: string;                   // milestone key (kid-level) or `${key}:${businessId}`
  key: string;
  businessId?: string;          // set for per-business milestones
  unlockedAt: Timestamp;
}

// ── Config (on the Family doc, like hiveConfig) ───────────────────

export interface BusinessConfig {
  defaultHiveSplit: HiveSplit;
  /** Where the cash for costs comes from. Phase 1 default is a parent monthly
   *  float (informational — costs are logged, not auto-debited yet). */
  costFunding: 'parent_float' | 'hive_deduction';
  monthlyFloatCents?: number;
  adhocAutoCloseDays: number;
  coachName: string;            // easy to rename — referenced in every AI string
  neighboursApproval: 'per_business' | 'per_sale';
  investing: {
    enabled: boolean;
    perBuyCapCents: number;
    /** Buys at/above this need dual-parent OK. Phase 1 keeps every simulated
     *  buy single-parent (virtual money); the field is honoured in Phase 2. */
    dualParentAboveCents: number;
    menu: string[];             // Instrument.symbol allow-list
  };
  /** Asset Type Library starter set (keys from ASSET_LIBRARY). Parent-managed. */
  assetLibrary?: string[];
}

export const DEFAULT_HIVE_SPLIT: HiveSplit = { spend: 40, save: 25, goal: 20, invest: 15 };

export const DEFAULT_BUSINESS_CONFIG: BusinessConfig = {
  defaultHiveSplit: DEFAULT_HIVE_SPLIT,
  costFunding: 'parent_float',
  adhocAutoCloseDays: 14,
  coachName: 'Kaya Coach',
  neighboursApproval: 'per_business',
  investing: {
    enabled: true,
    perBuyCapCents: 5000_00,    // generous default; parent tightens in Settings
    dualParentAboveCents: 5000_00,
    menu: ['LEGO_INDEX', 'DIS', 'KO', 'SP500', 'BANKS_FUND'],
  },
  assetLibrary: ['passion_fruit', 'eggs', 'chickens', 'vegetables', 'service_generic'],
};

// ── Catalogs (declarative — engines that act on them land in later PRs) ──

export interface BusinessTypeMeta {
  key: BusinessType;
  label: string;
  emoji: string;
  /** The books this type keeps — drives which screens/fields show. */
  shape: Array<'inventory' | 'sales' | 'costs' | 'profit' | 'milestones' | 'reward' | 'sharedBooks' | 'profitSplit'>;
  phase: 1 | 2;
}

export const BUSINESS_TYPES: BusinessTypeMeta[] = [
  { key: 'goods',    label: 'Goods',            emoji: '🌱', shape: ['inventory', 'sales', 'costs', 'profit'], phase: 1 },
  { key: 'service',  label: 'Service',          emoji: '🛠️', shape: ['sales', 'costs', 'profit'],              phase: 1 },
  { key: 'adhoc',    label: 'Ad-hoc',           emoji: '⚡', shape: ['sales', 'costs', 'profit'],              phase: 1 },
  { key: 'advice',   label: 'Advice / Tutoring', emoji: '📚', shape: ['sales', 'profit'],                      phase: 2 },
  { key: 'sport',    label: 'Sport / Coaching', emoji: '⚽', shape: ['sales', 'costs', 'profit'],              phase: 2 },
  { key: 'learning', label: 'Learning-for-pay', emoji: '🎯', shape: ['milestones', 'reward'],                  phase: 2 },
  { key: 'coop',     label: 'Co-op',            emoji: '🤝', shape: ['sharedBooks', 'profitSplit'],            phase: 2 },
];

/** Currently creatable types + channels. Phase 2 widens these. */
export const PHASE1_BUSINESS_TYPES: BusinessType[] = ['goods', 'service', 'adhoc'];
export const PHASE1_CHANNELS: CustomerChannel[] = ['family', 'relatives'];

export interface ChannelMeta {
  key: CustomerChannel;
  label: string;
  /** Needs a parent approval to unlock (neighbours = dual-parent). */
  gated: boolean;
  phase: 1 | 2 | 3;
}

export const CUSTOMER_CHANNELS: ChannelMeta[] = [
  { key: 'family',     label: 'Family',     gated: false, phase: 1 },
  { key: 'relatives',  label: 'Relatives',  gated: false, phase: 1 },
  { key: 'neighbours', label: 'Neighbours', gated: true,  phase: 2 },
  { key: 'external',   label: 'Marketplace', gated: true, phase: 3 },
];

export interface AssetLibraryEntry {
  key: string;
  label: string;
  emoji: string;
  type: BusinessType;
  /** Suggested stage vocabulary for stock of this kind. */
  stages?: string[];
  unitLabel?: string;
}

// Starter library (parent-managed via config.assetLibrary). Geographically
// neutral on purpose — see the brand positioning rule. Families add their own.
export const ASSET_LIBRARY: AssetLibraryEntry[] = [
  { key: 'passion_fruit', label: 'Passion fruit', emoji: '🌿', type: 'goods', unitLabel: 'fruit', stages: ['flowering', 'ripening', 'ready', 'spoiled'] },
  { key: 'eggs',          label: 'Eggs',          emoji: '🥚', type: 'goods', unitLabel: 'egg',   stages: ['fresh', 'older'] },
  { key: 'chickens',      label: 'Chickens',      emoji: '🐔', type: 'goods', unitLabel: 'bird',  stages: ['chick', 'growing', 'layer', 'broiler'] },
  { key: 'vegetables',    label: 'Vegetables',    emoji: '🥬', type: 'goods', unitLabel: 'bunch', stages: ['seedling', 'growing', 'ready'] },
  { key: 'service_generic', label: 'Service',     emoji: '🛠️', type: 'service', unitLabel: 'job' },
];

// Curated investment menu. Geographically neutral defaults; the menu is
// configurable per family (config.investing.menu). Synthetic baskets
// (no quoteSymbol) get priced by a server recipe in PR6.
export const INVESTMENT_MENU: Instrument[] = [
  { symbol: 'LEGO_INDEX', label: 'Toy Makers Basket', emoji: '🧱', kind: 'basket', blurb: 'A bundle of toy companies — things you already play with.' },
  { symbol: 'DIS',        label: 'Disney',            emoji: '🎬', kind: 'stock',  blurb: 'Movies and theme parks you know.', quoteSymbol: 'DIS' },
  { symbol: 'KO',         label: 'Coca-Cola',         emoji: '🥤', kind: 'stock',  blurb: "You've seen this everywhere — pays small dividends.", quoteSymbol: 'KO' },
  { symbol: 'SP500',      label: 'Global Index Fund',  emoji: '🌍', kind: 'fund',   blurb: 'A tiny slice of hundreds of big companies at once.', quoteSymbol: '^GSPC' },
  { symbol: 'BANKS_FUND', label: 'Big Banks Fund',    emoji: '🏦', kind: 'fund',   blurb: 'A basket of large banks — pays small dividends.', quoteSymbol: 'KBE' },
];

// Milestone catalog. User-facing labels are currency-neutral (the brand rule)
// — the headline currency symbol is rendered dynamically at display time.
// The engine that unlocks these from real numbers lands in PR4.
export const BUSINESS_MILESTONES: MilestoneDef[] = [
  { key: 'first_earnings',   label: 'First earnings',     emoji: '🪙', scope: 'business',  description: 'Your very first sale.' },
  { key: 'first_1000',       label: 'First 1,000 profit', emoji: '💯', scope: 'business',  description: 'You crossed 1,000 in profit.' },
  { key: 'month_in_black',   label: 'Month in the black', emoji: '📈', scope: 'business',  description: 'A whole month where you earned more than you spent.' },
  { key: 'repeat_customer',  label: 'First repeat customer', emoji: '🔁', scope: 'business', description: 'Someone bought from you twice.' },
  { key: 'sales_10',         label: '10 sales',           emoji: '🛍️', scope: 'business',  description: 'Ten sales logged.' },
  { key: 'sales_100',        label: '100 sales',          emoji: '🚀', scope: 'business',  description: 'One hundred sales logged.' },
  { key: 'sales_1000',       label: '1,000 sales',        emoji: '🌟', scope: 'business',  description: 'One thousand sales logged.' },
  { key: 'black_book',       label: 'Black Book',         emoji: '🧮', scope: 'business',  description: 'Three months of clean books.' },
  { key: 'first_pivot',      label: 'First pivot',        emoji: '🔄', scope: 'business',  description: 'You changed your plan to do better.' },
  { key: 'first_coop',       label: 'First co-op',        emoji: '🤝', scope: 'kid',       description: 'You started a business with others.' },
  { key: 'reinvestor',       label: 'Reinvestor',         emoji: '↻',  scope: 'kid',       description: 'Three months of keeping profit in your business.' },
  { key: 'first_investor',   label: 'First investor',     emoji: '📊', scope: 'investing', description: 'Your first share bought.' },
  { key: 'diversified',      label: 'Diversified',        emoji: '🧺', scope: 'investing', description: 'Three or more different holdings.' },
  { key: 'skill_mastered',   label: 'Skill mastered',     emoji: '🎓', scope: 'kid',       description: 'A Learning-track milestone cleared.' },
];

// ── Pure helpers (no I/O — safe to unit test) ─────────────────────

/** Worth a single inventory item contributes. Loss + not-counted items add 0;
 *  market value wins over cost basis; cost basis is the fallback. */
export function itemWorthCents(item: Pick<BusinessItem, 'qty' | 'unitMarketCents' | 'unitCostCents' | 'countedInWorth' | 'loss'>): number {
  if (item.loss || !item.countedInWorth) return 0;
  const unit = item.unitMarketCents ?? item.unitCostCents ?? 0;
  return Math.max(0, Math.round(unit * (item.qty || 0)));
}

/** Roll up an item list into the asset / stock / total worth figures stored
 *  on `business.stats`. Business cash position is added by the caller. */
export function rollUpInventory(items: BusinessItem[]): { assetsCents: number; stockMarketCents: number; worthCents: number } {
  let assetsCents = 0;
  let stockMarketCents = 0;
  for (const it of items) {
    const w = itemWorthCents(it);
    if (it.kind === 'asset') assetsCents += w;
    else stockMarketCents += w;
  }
  return { assetsCents, stockMarketCents, worthCents: assetsCents + stockMarketCents };
}

/** Split a profit amount into Spend/Save/Goal/Invest cents. Uses largest-
 *  remainder rounding so the four slices always sum back to `profitCents`
 *  exactly (no cent lost or invented). */
export function splitProfitCents(profitCents: number, split: HiveSplit): Record<keyof HiveSplit, number> {
  const keys: Array<keyof HiveSplit> = ['spend', 'save', 'goal', 'invest'];
  const total = Math.max(0, Math.round(profitCents));
  const raw = keys.map((k) => (total * (split[k] || 0)) / 100);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  // Hand the leftover cents to the slices with the largest fractional parts.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let j = 0; j < order.length && remainder > 0; j++, remainder--) out[order[j].i] += 1;
  return { spend: out[0], save: out[1], goal: out[2], invest: out[3] };
}

/** Current value of a holding in family cents = shares × USD price × FX. */
export function holdingValueCents(holding: Pick<InvestmentHolding, 'shares'>, quote: Pick<MarketQuote, 'priceUsd'> | null | undefined, fxUsdToFamily: number = 1): number {
  if (!quote) return 0;
  return Math.round(holding.shares * quote.priceUsd * (fxUsdToFamily || 1) * 100);
}

export function readBusinessConfig(family: { businessConfig?: Partial<BusinessConfig> } | null | undefined): BusinessConfig {
  const f = family?.businessConfig || {};
  return {
    ...DEFAULT_BUSINESS_CONFIG,
    ...f,
    // Merge nested objects so a partial override doesn't wipe sibling defaults.
    defaultHiveSplit: { ...DEFAULT_HIVE_SPLIT, ...(f.defaultHiveSplit || {}) },
    investing: { ...DEFAULT_BUSINESS_CONFIG.investing, ...(f.investing || {}) },
  };
}

// ── Path helpers ──────────────────────────────────────────────────

const businessesCol = (familyId: string) =>
  collection(db, 'families', familyId, 'businesses');
const businessDoc = (familyId: string, businessId: string) =>
  doc(db, 'families', familyId, 'businesses', businessId);
const itemsCol = (familyId: string, businessId: string) =>
  collection(db, 'families', familyId, 'businesses', businessId, 'items');
const ledgerCol = (familyId: string, businessId: string) =>
  collection(db, 'families', familyId, 'businesses', businessId, 'ledger');
const investmentsCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'investments');
const milestonesCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'businessMilestones');
const marketQuotesCol = () => collection(db, 'marketQuotes');

// ── Config writes (parent-only; rules enforce) ────────────────────

export async function setBusinessConfig(familyId: string, patch: Partial<BusinessConfig>): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(doc(db, 'families', familyId), { businessConfig: patch } as any, { merge: true });
}

// ── Reads + subscriptions ─────────────────────────────────────────

/** All businesses in the family (Parent Console family grid). */
export function subscribeToFamilyBusinesses(familyId: string, cb: (businesses: Business[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(businessesCol(familyId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Business))));
}

/** One kid's businesses (kid Portfolio). Equality-only query + client-side
 *  sort so it needs no composite index — the family's set per kid is tiny. */
export function subscribeToKidBusinesses(familyId: string, kidId: string, cb: (businesses: Business[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(businessesCol(familyId), where('ownerId', '==', kidId));
  return onSnapshot(q, (s) => cb(sortByCreatedDesc(s.docs.map((d) => ({ id: d.id, ...d.data() } as Business)))));
}

export async function getBusiness(familyId: string, businessId: string): Promise<Business | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(businessDoc(familyId, businessId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Business) : null;
}

export function subscribeToBusiness(familyId: string, businessId: string, cb: (business: Business | null) => void): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(businessDoc(familyId, businessId), (snap) =>
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as Business) : null));
}

export function subscribeToBusinessItems(familyId: string, businessId: string, cb: (items: BusinessItem[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(itemsCol(familyId, businessId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as BusinessItem))));
}

export function subscribeToLedger(familyId: string, businessId: string, cb: (entries: LedgerEntry[]) => void, max = 100): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(ledgerCol(familyId, businessId), orderBy('occurredAt', 'desc'), limit(max));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as LedgerEntry))));
}

export function subscribeToInvestments(familyId: string, kidId: string, cb: (holdings: InvestmentHolding[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(investmentsCol(familyId, kidId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as InvestmentHolding))));
}

export function subscribeToBusinessMilestones(familyId: string, kidId: string, cb: (milestones: BusinessMilestone[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(milestonesCol(familyId, kidId), orderBy('unlockedAt', 'desc'));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as BusinessMilestone))));
}

/** Latest cached real prices for the curated menu (USD). Server-written. */
export async function getMarketQuotes(symbols?: string[]): Promise<Record<string, MarketQuote>> {
  if (isGuestActive()) return {};
  const snap = await getDocs(marketQuotesCol());
  const out: Record<string, MarketQuote> = {};
  snap.docs.forEach((d) => {
    const q = { symbol: d.id, ...d.data() } as MarketQuote;
    if (!symbols || symbols.includes(q.symbol)) out[q.symbol] = q;
  });
  return out;
}

export function subscribeToMarketQuotes(cb: (quotes: Record<string, MarketQuote>) => void): () => void {
  if (isGuestActive()) { cb({}); return () => {}; }
  return onSnapshot(marketQuotesCol(), (s) => {
    const out: Record<string, MarketQuote> = {};
    s.docs.forEach((d) => { out[d.id] = { symbol: d.id, ...d.data() } as MarketQuote; });
    cb(out);
  });
}

const approvalRequestsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'approvalRequests');

function tsMillis(t: Timestamp | undefined): number {
  return (t as any)?.toMillis?.() ?? 0;
}
function sortByCreatedDesc<T extends { createdAt: Timestamp }>(rows: T[]): T[] {
  return rows.sort((a, b) => tsMillis(b.createdAt) - tsMillis(a.createdAt));
}

/** Business requests (pending + resolved) for the Parent Console. Filtered to
 *  module:'business' so Hive-native items never leak in; resolved ones are
 *  retained as the family's business approval history. Equality-only query +
 *  client sort — no composite index required. */
export function subscribeToBusinessRequests(
  familyId: string,
  cb: (requests: ApprovalRequest[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(approvalRequestsCol(familyId), where('module', '==', 'business'));
  return onSnapshot(q, (s) => {
    const rows = s.docs.map((d) => ({ id: d.id, ...d.data() } as ApprovalRequest));
    rows.sort((a, b) => tsMillis(b.createdAt as Timestamp) - tsMillis(a.createdAt as Timestamp));
    cb(rows);
  });
}

// ── Mutations ─────────────────────────────────────────────────────
// Money-moving + stats-recomputing writes (logSale, logCost, addItem,
// buyInvestment, the milestone engine) land in PR3/PR4/PR6. PR2 ships the
// business lifecycle: create, status flips, and the launch approval loop.

export interface NewBusinessInput {
  type: BusinessType;
  name: string;
  emoji: string;
  mission?: string;
  customerChannels: CustomerChannel[];
  unitLabel?: string;
  unitPriceCents?: number;
  /** Effective split — caller resolves it from BusinessConfig.defaultHiveSplit. */
  hiveSplit: HiveSplit;
  reinvestPct?: number;
  autoCloseAfterDays?: number;
}

export interface BusinessActor {
  uid: string;
  /** Child.id of the owner. A kid creating their own → their own childId; a
   *  parent creating → the kid they're setting it up for. */
  ownerId: string;
  isParent: boolean;
}

/** Create a business. A parent's goes live immediately (the parent IS the
 *  approver); a kid's starts as a 'pilot' sandbox — taking it 'active'
 *  ("launch") needs a parent OK via {@link requestBusinessLaunch}. Returns
 *  the new business id. */
export async function createBusiness(
  familyId: string,
  input: NewBusinessInput,
  actor: BusinessActor,
): Promise<string> {
  if (isGuestActive()) return 'guest-business';
  const status: BusinessStatus = actor.isParent ? 'active' : 'pilot';
  const now = serverTimestamp();
  // Build with no `undefined` fields — Firestore rejects them.
  const data: Record<string, unknown> = {
    ownerId: actor.ownerId,
    type: input.type,
    status,
    name: input.name.trim(),
    emoji: input.emoji || '💼',
    customerChannels: input.customerChannels,
    hiveSplit: input.hiveSplit,
    stats: EMPTY_STATS,
    createdBy: actor.uid,
    createdAt: now,
    startedAt: now,
  };
  if (input.mission?.trim()) data.mission = input.mission.trim();
  if (input.unitLabel?.trim()) data.unitLabel = input.unitLabel.trim();
  if (typeof input.unitPriceCents === 'number') data.unitPriceCents = input.unitPriceCents;
  if (typeof input.reinvestPct === 'number') data.reinvestPct = input.reinvestPct;
  if (typeof input.autoCloseAfterDays === 'number') data.autoCloseAfterDays = input.autoCloseAfterDays;
  const ref = await addDoc(businessesCol(familyId), data);
  return ref.id;
}

/** Lifecycle flip — pilot/idea → active, active ↔ paused, → closed. `startedAt`
 *  is set at creation; `closedAt` is stamped on close so the ledger keeps a
 *  closing date for archived ad-hoc gigs. */
export async function setBusinessStatus(
  familyId: string,
  businessId: string,
  status: BusinessStatus,
): Promise<void> {
  if (isGuestActive()) return;
  const patch: Record<string, unknown> = { status };
  if (status === 'closed') patch.closedAt = serverTimestamp();
  await updateDoc(businessDoc(familyId, businessId), patch);
}

/** Light edits to a business's identity / pricing. Kept narrow on purpose —
 *  money + stats never flow through here. */
export async function updateBusiness(
  familyId: string,
  businessId: string,
  patch: Partial<Pick<Business, 'name' | 'mission' | 'emoji' | 'unitLabel' | 'unitPriceCents' | 'customerChannels' | 'hiveSplit' | 'reinvestPct'>>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(businessDoc(familyId, businessId), patch as Record<string, unknown>);
}

/** A kid asks a parent to take a pilot live. Writes a `business_launch` item
 *  into the unified queue (module:'business'); the parent resolves it in the
 *  Business console. Disable the button while one is already pending. */
export async function requestBusinessLaunch(
  familyId: string,
  business: Pick<Business, 'id' | 'ownerId' | 'name' | 'emoji'>,
  createdByUid: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const ref = await addDoc(approvalRequestsCol(familyId), {
    kidId: business.ownerId,
    type: 'business_launch',
    module: 'business',
    businessId: business.id,
    description: `Take "${business.name}" ${business.emoji} from pilot to active.`,
    status: 'pending',
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Parent resolves a business approval. Retained as history (never deleted).
 *  Approving a `business_launch` flips the business to 'active' in the same
 *  transaction so request + business move together. Other business approval
 *  types (price_change, investment_*) get their branches in later PRs. */
export async function resolveBusinessRequest(
  familyId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  approverUid: string,
  reason?: string,
): Promise<void> {
  if (isGuestActive()) return;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(approvalRequestsCol(familyId), requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = reqSnap.data() as Pick<ApprovalRequest, 'type' | 'status' | 'businessId'>;
    if (req.status !== 'pending') throw new Error('Request already resolved.');

    const now = serverTimestamp();
    if (decision === 'rejected') {
      tx.update(reqRef, {
        status: 'rejected', rejectionReason: reason || '',
        resolvedAt: now, resolvedBy: approverUid,
      });
      return;
    }
    if (req.type === 'business_launch' && req.businessId) {
      tx.update(businessDoc(familyId, req.businessId), { status: 'active', startedAt: now });
    }
    tx.update(reqRef, { status: 'approved', resolvedAt: now, resolvedBy: approverUid });
  });
}
