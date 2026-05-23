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
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc, runTransaction,
  query, where, orderBy, limit, onSnapshot,
  Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
// Type-only — Business reuses the Hive's unified `approvalRequests` queue.
// hive.ts does not import this module, so this is cycle-free.
import type { ApprovalRequest } from './hive';
// Runtime — a paid sale's earnings sweep into the kid's Hive Cash wallet via
// the Hive's own deposit path (one-way dependency: business → hive).
import { depositCash } from './hive';

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

export interface BusinessReminder {
  enabled: boolean;
  hourUtc: number;     // 0–23, computed client-side from the local pick
  localLabel: string;  // display only, e.g. "6:00 PM"
}

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
  /** AI-generated (or uploaded) logo image. When set, shown instead of the
   *  emoji on the dashboard + cards. */
  logoUrl?: string;
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
  /** Daily stock-take reminder (Phase 2 · A2). hourUtc is computed from the
   *  parent's local pick on the client, so the hourly cron needs no per-family
   *  timezone; localLabel is just for display. */
  reminder?: BusinessReminder;
  createdBy: string;
  /** Who set it up — a parent (for/with a kid) or the kid themselves. Drives
   *  the "started by …" attribution. createdByName is a display snapshot. */
  createdByRole?: 'parent' | 'kid';
  createdByName?: string;
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
  /** Per-product unit label (e.g. "kg", "bunch"). Products in one business can
   *  differ; the business-level unitLabel is just the headline default. */
  unitLabel?: string;
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
  /** House Points for stock-take effort (Phase 2 · A3). 'parent_review' (default):
   *  a parent awards weekly from the effort summary. 'auto': a weekly cron awards
   *  perDayHp × stock-take days, capped at weeklyCapHp. */
  hpAward: {
    mode: 'parent_review' | 'auto';
    perDayHp: number;
    weeklyCapHp: number;
  };
  /** How big "worth / value" numbers are shown (Portfolio worth, business
   *  worth, inventory roll-up, investor portfolio). Kid-readability vs
   *  precision — parent picks. Transaction amounts (prices/sales/costs) stay
   *  exact regardless. Default 'whole' (no cents). */
  displayRounding: DisplayRounding;
  /** Asset Type Library starter set (keys from ASSET_LIBRARY). Parent-managed. */
  assetLibrary?: string[];
}

/** Worth-display rounding: exact (with cents) · whole unit · nearest 10 · 100. */
export type DisplayRounding = 'exact' | 'whole' | 'ten' | 'hundred';

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
  hpAward: { mode: 'parent_review', perDayHp: 5, weeklyCapHp: 40 },
  displayRounding: 'whole',
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

/** Common units a kid can tap when naming what they sell (free text still
 *  allowed). Goods-leaning first, then service. */
export const UNIT_SUGGESTIONS: string[] = [
  'pcs', 'kg', 'g', 'litre', 'bunch', 'dozen', 'pack', 'box', 'plate', 'cup',
  'wash', 'session', 'hour', 'job',
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
    hpAward: { ...DEFAULT_BUSINESS_CONFIG.hpAward, ...(f.hpAward || {}) },
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

/** A product the kid lists at creation. For inventory-keeping types (goods)
 *  each becomes a stock BusinessItem seeded at qty 0 — its worth fills in at
 *  the first stock-take. priceCents is the per-unit sale/market price. */
export interface ProductDraft {
  name: string;
  unit: string;
  priceCents: number;
  /** Already-uploaded (https) product picture, optional. */
  photoUrl?: string;
}

export interface NewBusinessInput {
  type: BusinessType;
  name: string;
  emoji: string;
  mission?: string;
  customerChannels: CustomerChannel[];
  unitLabel?: string;
  unitPriceCents?: number;
  /** AI-generated (or uploaded) logo, already in Storage. Redrawn later on the
   *  Business Info page. */
  logoUrl?: string;
  /** Per-product rows. For goods these seed Inventory items (qty 0). The first
   *  product also fills the headline unitLabel/unitPriceCents when those aren't
   *  set explicitly. */
  products?: ProductDraft[];
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
  /** Display name of the creator, snapshotted onto the business for the
   *  "started by …" attribution. */
  name?: string;
}

/** Allocate a business id without writing. Lets the caller upload product
 *  pictures to the right Storage path (which needs the id) BEFORE the doc is
 *  created, then pass the same id into {@link createBusiness} as `presetId`. */
export function newBusinessId(familyId: string): string {
  return doc(businessesCol(familyId)).id;
}

/** Create a business. A parent's goes live immediately (the parent IS the
 *  approver); a kid's starts as a 'pilot' sandbox — taking it 'active'
 *  ("launch") needs a parent OK via {@link requestBusinessLaunch}.
 *
 *  Products: for inventory-keeping types (goods) every product in
 *  `input.products` is seeded as a stock item at qty 0 — the worth fills in at
 *  the first stock-take. The first product also fills the headline
 *  unit/price when those aren't set explicitly. Pass `presetId` (from
 *  {@link newBusinessId}) when product pictures were uploaded ahead of time.
 *  Returns the business id. */
export async function createBusiness(
  familyId: string,
  input: NewBusinessInput,
  actor: BusinessActor,
  presetId?: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-business';
  const status: BusinessStatus = actor.isParent ? 'active' : 'pilot';
  const now = serverTimestamp();
  const products = (input.products || []).filter((p) => p.name?.trim());
  const head = products[0];
  // Headline unit/price: explicit input wins, else fall back to the first product.
  const headUnit = input.unitLabel?.trim() || head?.unit?.trim();
  const headPrice = typeof input.unitPriceCents === 'number'
    ? input.unitPriceCents
    : (typeof head?.priceCents === 'number' && head.priceCents > 0 ? head.priceCents : undefined);
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
    createdByRole: actor.isParent ? 'parent' : 'kid',
    createdAt: now,
    startedAt: now,
  };
  if (actor.name?.trim()) data.createdByName = actor.name.trim();
  if (input.mission?.trim()) data.mission = input.mission.trim();
  if (input.logoUrl) data.logoUrl = input.logoUrl;
  if (headUnit) data.unitLabel = headUnit;
  if (typeof headPrice === 'number') data.unitPriceCents = headPrice;
  if (typeof input.reinvestPct === 'number') data.reinvestPct = input.reinvestPct;
  if (typeof input.autoCloseAfterDays === 'number') data.autoCloseAfterDays = input.autoCloseAfterDays;

  let businessId: string;
  if (presetId) {
    await setDoc(businessDoc(familyId, presetId), data);
    businessId = presetId;
  } else {
    const ref = await addDoc(businessesCol(familyId), data);
    businessId = ref.id;
  }

  // Seed inventory for inventory-keeping types (goods): one stock item per
  // product at qty 0. Worth stays 0 (so stats need no recompute) until the
  // first stock-take. Each item carries its own unit + per-unit market price
  // and an optional AI/uploaded picture.
  const keepsInventory = !!BUSINESS_TYPES.find((t) => t.key === input.type)?.shape.includes('inventory');
  if (keepsInventory && products.length) {
    for (const p of products) {
      const item: Record<string, unknown> = {
        businessId,
        kind: 'stock',
        name: p.name.trim(),
        qty: 0,
        countedInWorth: true,
        createdBy: actor.uid,
        createdAt: now,
        updatedAt: now,
      };
      if (p.unit?.trim()) item.unitLabel = p.unit.trim();
      if (typeof p.priceCents === 'number' && p.priceCents > 0) item.unitMarketCents = p.priceCents;
      if (p.photoUrl) item.photoUrl = p.photoUrl;
      await addDoc(itemsCol(familyId, businessId), item);
    }
  }
  return businessId;
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

/** Set (or clear) the daily stock-take reminder. */
export async function setBusinessReminder(
  familyId: string,
  businessId: string,
  reminder: BusinessReminder,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(businessDoc(familyId, businessId), { reminder });
}

/** Light edits to a business's identity / pricing. Kept narrow on purpose —
 *  money + stats never flow through here. */
export async function updateBusiness(
  familyId: string,
  businessId: string,
  patch: Partial<Pick<Business, 'name' | 'mission' | 'emoji' | 'logoUrl' | 'unitLabel' | 'unitPriceCents' | 'customerChannels' | 'hiveSplit' | 'reinvestPct'>>,
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
 *  - business_launch → flips the business to 'active'.
 *  - investment_buy  → upserts the simulated holding (virtual money) with the
 *    shares + cost basis snapshotted on the request.
 *  All in one transaction so the request + its effect move together. */
export async function resolveBusinessRequest(
  familyId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  approverUid: string,
  reason?: string,
): Promise<void> {
  if (isGuestActive()) return;
  let investedKidId: string | null = null;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(approvalRequestsCol(familyId), requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = reqSnap.data() as Pick<ApprovalRequest,
      'type' | 'status' | 'businessId' | 'kidId' | 'instrumentSymbol' | 'shares' | 'amountCents'>;
    if (req.status !== 'pending') throw new Error('Request already resolved.');

    const now = serverTimestamp();
    if (decision === 'rejected') {
      tx.update(reqRef, { status: 'rejected', rejectionReason: reason || '', resolvedAt: now, resolvedBy: approverUid });
      return;
    }

    // Reads before writes (Firestore transaction rule).
    const holdRef = req.type === 'investment_buy' && req.kidId && req.instrumentSymbol
      ? doc(investmentsCol(familyId, req.kidId), req.instrumentSymbol)
      : null;
    const prevHolding = holdRef ? ((await tx.get(holdRef)).data() as InvestmentHolding | undefined) : undefined;

    if (req.type === 'business_launch' && req.businessId) {
      tx.update(businessDoc(familyId, req.businessId), { status: 'active', startedAt: now });
    } else if (holdRef && req.instrumentSymbol) {
      const inst = INVESTMENT_MENU.find((i) => i.symbol === req.instrumentSymbol);
      tx.set(holdRef, {
        symbol: req.instrumentSymbol,
        label: inst?.label ?? req.instrumentSymbol,
        emoji: inst?.emoji ?? '📈',
        shares: (prevHolding?.shares ?? 0) + (req.shares ?? 0),
        costBasisCents: (prevHolding?.costBasisCents ?? 0) + (req.amountCents ?? 0),
        createdAt: prevHolding?.createdAt ?? now,
        updatedAt: now,
      }, { merge: true });
      investedKidId = req.kidId ?? null;
    }
    tx.update(reqRef, { status: 'approved', resolvedAt: now, resolvedBy: approverUid });
  });

  // Milestone check needs a collection read — run it after the transaction.
  if (investedKidId) {
    try { await unlockInvestingMilestones(familyId, investedKidId); } catch { /* best-effort */ }
  }
}

/** Junior Investor · a kid asks a parent to OK a (virtual-money) buy. Shares are
 *  snapshotted from the live quote + FX at request time and applied on approve.
 *  Single-parent in Phase 1. */
export async function requestInvestmentBuy(
  familyId: string,
  kidId: string,
  instrumentSymbol: string,
  shares: number,
  amountCents: number,
  createdByUid: string,
  description?: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const ref = await addDoc(approvalRequestsCol(familyId), {
    kidId,
    type: 'investment_buy',
    module: 'business',
    instrumentSymbol,
    shares,
    amountCents,
    description: description || `Buy a piece of ${instrumentSymbol}`,
    status: 'pending',
    createdBy: createdByUid,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Unlock investing-scope milestones (kid-level ids) from the holdings count. */
export async function unlockInvestingMilestones(familyId: string, kidId: string): Promise<string[]> {
  if (isGuestActive()) return [];
  const holdings = await getDocs(investmentsCol(familyId, kidId));
  const count = holdings.docs.filter((d) => ((d.data() as InvestmentHolding).shares ?? 0) > 0).length;
  const met: string[] = [];
  if (count >= 1) met.push('first_investor');
  if (count >= 3) met.push('diversified');
  if (met.length === 0) return [];
  const existing = await getDocs(milestonesCol(familyId, kidId));
  const have = new Set(existing.docs.map((d) => d.id));
  const out: string[] = [];
  for (const key of met) {
    if (have.has(key)) continue; // investing milestones are kid-level (id = key)
    await setDoc(doc(milestonesCol(familyId, kidId), key), { key, unlockedAt: serverTimestamp() });
    out.push(key);
  }
  return out;
}

// ── Inventory mutations (PR3) ─────────────────────────────────────
// Items roll up into the denormalized business.stats so the Portfolio +
// Family Grid read one doc, never the item list. The recompute touches only
// the inventory fields (dot-path) so it never clobbers the ledger-owned
// profit/cash figures that arrive in PR4.

export interface NewItemInput {
  kind: ItemKind;
  name: string;
  qty: number;
  unitLabel?: string;
  groupId?: string;
  stage?: string;
  unitCostCents?: number;
  unitMarketCents?: number;
  producing?: boolean;
  /** Defaults true. Set false for not-yet-sellable stock (e.g. flowering). */
  countedInWorth?: boolean;
  notes?: string;
}

export type ItemPatch = Partial<Pick<BusinessItem,
  'name' | 'qty' | 'unitLabel' | 'stage' | 'groupId' | 'unitCostCents' | 'unitMarketCents' | 'producing' | 'countedInWorth' | 'notes'>>;

/** Recompute assets / stock / worth on business.stats from the current item
 *  set. Reads items with getDocs (can't run a query inside a txn) then writes
 *  via dot-paths so the profit/cash fields are left untouched. cashPosition
 *  (0 until PR4) is folded into worth. */
export async function recomputeInventoryStats(familyId: string, businessId: string): Promise<void> {
  if (isGuestActive()) return;
  const snap = await getDocs(itemsCol(familyId, businessId));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as BusinessItem));
  const { assetsCents, stockMarketCents } = rollUpInventory(items);
  const bizSnap = await getDoc(businessDoc(familyId, businessId));
  const cashPos = Number(bizSnap.data()?.stats?.cashPositionCents ?? 0);
  await updateDoc(businessDoc(familyId, businessId), {
    'stats.assetsCents': assetsCents,
    'stats.stockMarketCents': stockMarketCents,
    'stats.worthCents': assetsCents + stockMarketCents + cashPos,
    'stats.lastActivityAt': serverTimestamp(),
  });
}

/** Add an inventory item (named single, grouped batch, or stock pile), then
 *  refresh the worth roll-up. */
export async function addBusinessItem(
  familyId: string,
  businessId: string,
  input: NewItemInput,
  uid: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-item';
  const now = serverTimestamp();
  const data: Record<string, unknown> = {
    businessId,
    kind: input.kind,
    name: input.name.trim(),
    qty: Math.max(0, Math.round(input.qty || 0)),
    countedInWorth: input.countedInWorth !== false,
    createdBy: uid,
    createdAt: now,
    updatedAt: now,
  };
  if (input.unitLabel?.trim()) data.unitLabel = input.unitLabel.trim();
  if (input.groupId?.trim()) data.groupId = input.groupId.trim();
  if (input.stage?.trim()) data.stage = input.stage.trim();
  if (typeof input.unitCostCents === 'number') data.unitCostCents = input.unitCostCents;
  if (typeof input.unitMarketCents === 'number') data.unitMarketCents = input.unitMarketCents;
  if (typeof input.producing === 'boolean') data.producing = input.producing;
  if (input.notes?.trim()) data.notes = input.notes.trim();
  const ref = await addDoc(itemsCol(familyId, businessId), data);
  await recomputeInventoryStats(familyId, businessId);
  return ref.id;
}

export async function updateBusinessItem(
  familyId: string,
  businessId: string,
  itemId: string,
  patch: ItemPatch,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(itemsCol(familyId, businessId), itemId), {
    ...patch,
    updatedAt: serverTimestamp(),
  } as Record<string, unknown>);
  await recomputeInventoryStats(familyId, businessId);
}

/** Spoilage / death write-off — keeps the record so the AI can learn from it,
 *  but drops it from worth. */
export async function markItemLoss(familyId: string, businessId: string, itemId: string): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(itemsCol(familyId, businessId), itemId), {
    loss: true, countedInWorth: false, updatedAt: serverTimestamp(),
  });
  await recomputeInventoryStats(familyId, businessId);
}

/** Hard delete — for a mistaken entry (vs markItemLoss, a real write-off
 *  worth keeping). */
export async function removeBusinessItem(familyId: string, businessId: string, itemId: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(itemsCol(familyId, businessId), itemId));
  await recomputeInventoryStats(familyId, businessId);
}

// ── The books · sales + costs (PR4) ───────────────────────────────
// A paid sale's earnings sweep into the owner's Hive Cash (1-tap, no per-sale
// approval — earning is frictionless; *spending* from the Hive still needs a
// parent OK). Costs are logged for P&L + margin but, under the parent-float
// default (config.costFunding), do NOT debit the Hive. Stats recompute from
// the ledger after every write (no incremental drift). The ledger is
// append-only per the rules, so corrections are a later PR.

const startOfMonthMs = (): number => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};

export interface SaleInput {
  qty: number;
  unitPriceCents: number;
  customerRef?: string;          // member uid | contactId | '' (free-text)
  customerLabel?: string;        // display name ("Aunty Mary")
  paymentMethod: PaymentMethod;  // cash | hive_transfer | iou
  description?: string;
  occurredAt?: Date;
}

export interface CostInput {
  costType: CostType;            // supplies | tools | help | other
  description: string;
  amountCents: number;
  occurredAt?: Date;
}

export interface LedgerActor {
  uid: string;
  /** Business owner's Child.id — the wallet a paid sale sweeps into. */
  ownerId: string;
}

/** Recompute the ledger-derived figures on business.stats (revenue / profit /
 *  count) from the full ledger. Dot-path so it never clobbers the inventory
 *  worth fields. Only paid sales count as revenue; an unpaid IOU is a
 *  receivable that lands when it's settled (a later PR). */
export async function recomputeLedgerStats(familyId: string, businessId: string): Promise<void> {
  if (isGuestActive()) return;
  const snap = await getDocs(ledgerCol(familyId, businessId));
  const monthStart = startOfMonthMs();
  let monthRevenue = 0, monthCosts = 0, lifeRevenue = 0, lifeCosts = 0, salesCount = 0;
  snap.docs.forEach((d) => {
    const e = d.data() as LedgerEntry;
    if (e.voided) return;
    const ms = (e.occurredAt as any)?.toMillis?.() ?? 0;
    const inMonth = ms >= monthStart;
    if (e.kind === 'sale') {
      if (e.paymentStatus !== 'paid') return;  // receivable — not yet revenue
      salesCount += 1;
      lifeRevenue += e.amountCents;
      if (inMonth) monthRevenue += e.amountCents;
    } else if (e.kind === 'cost') {
      lifeCosts += e.amountCents;
      if (inMonth) monthCosts += e.amountCents;
    }
  });
  await updateDoc(businessDoc(familyId, businessId), {
    'stats.monthRevenueCents': monthRevenue,
    'stats.monthProfitCents': monthRevenue - monthCosts,
    'stats.lifetimeProfitCents': lifeRevenue - lifeCosts,
    'stats.salesCount': salesCount,
    'stats.lastActivityAt': serverTimestamp(),
  });
}

/** Log a sale. A paid sale (cash / hive_transfer) sweeps its full amount into
 *  the owner's Hive Cash; an IOU is recorded unpaid and doesn't sweep. Then
 *  stats refresh + milestone check. */
export async function logSale(
  familyId: string,
  businessId: string,
  input: SaleInput,
  actor: LedgerActor,
): Promise<void> {
  if (isGuestActive()) return;
  const qty = Math.max(1, Math.round(input.qty || 1));
  const amountCents = Math.max(0, Math.round(qty * input.unitPriceCents));
  if (amountCents <= 0) throw new Error('Sale amount must be positive.');
  const paymentStatus: PaymentStatus = input.paymentMethod === 'iou' ? 'unpaid' : 'paid';
  const occurred = input.occurredAt ?? new Date();
  const entry: Record<string, unknown> = {
    businessId,
    ownerId: actor.ownerId,
    kind: 'sale',
    qty,
    unitPriceCents: input.unitPriceCents,
    paymentMethod: input.paymentMethod,
    paymentStatus,
    amountCents,
    description: (input.description || '').trim() || 'Sale',
    occurredAt: Timestamp.fromDate(occurred),
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  };
  if (input.customerRef) entry.customerRef = input.customerRef;
  if (input.customerLabel?.trim()) entry.customerLabel = input.customerLabel.trim();
  await addDoc(ledgerCol(familyId, businessId), entry);
  if (paymentStatus === 'paid') {
    const note = `${input.customerLabel ? input.customerLabel + ' · ' : ''}${input.description || 'Sale'}`.slice(0, 80);
    await depositCash(familyId, actor.ownerId, amountCents, 'business', note, actor.uid);
  }
  await recomputeLedgerStats(familyId, businessId);
  await runThresholdMilestones(familyId, businessId, actor.ownerId);
}

/** Log a cost. Tracked for P&L + margin; under the parent-float default it does
 *  NOT debit the Hive (the parent covers it). */
export async function logCost(
  familyId: string,
  businessId: string,
  input: CostInput,
  actor: LedgerActor,
): Promise<void> {
  if (isGuestActive()) return;
  const amountCents = Math.max(0, Math.round(input.amountCents));
  if (amountCents <= 0) throw new Error('Cost amount must be positive.');
  const occurred = input.occurredAt ?? new Date();
  await addDoc(ledgerCol(familyId, businessId), {
    businessId,
    ownerId: actor.ownerId,
    kind: 'cost',
    costType: input.costType,
    amountCents,
    description: input.description.trim() || input.costType,
    occurredAt: Timestamp.fromDate(occurred),
    createdBy: actor.uid,
    createdAt: serverTimestamp(),
  });
  await recomputeLedgerStats(familyId, businessId);
}

// ── Milestone engine (PR4 · stat-threshold subset) ────────────────
// Unlocks the milestones that fall straight out of business.stats after a
// sale. Idempotent: one doc per `${key}:${businessId}`, written once. Richer
// triggers (repeat_customer, month_in_black, black_book) need history scans —
// left as hooks for a later PR.

/** 1,000 in profit, in the family's minor units. */
const FIRST_PROFIT_TARGET_CENTS = 1000 * 100;

export async function runThresholdMilestones(
  familyId: string,
  businessId: string,
  ownerId: string,
): Promise<string[]> {
  if (isGuestActive()) return [];
  const biz = await getBusiness(familyId, businessId);
  if (!biz) return [];
  const s = biz.stats;
  const met: string[] = [];
  if (s.salesCount >= 1) met.push('first_earnings');
  if (s.salesCount >= 10) met.push('sales_10');
  if (s.salesCount >= 100) met.push('sales_100');
  if (s.salesCount >= 1000) met.push('sales_1000');
  if (s.lifetimeProfitCents >= FIRST_PROFIT_TARGET_CENTS) met.push('first_1000');
  if (met.length === 0) return [];

  const existing = await getDocs(milestonesCol(familyId, ownerId));
  const have = new Set(existing.docs.map((d) => d.id));
  const newlyUnlocked: string[] = [];
  for (const key of met) {
    const id = `${key}:${businessId}`;
    if (have.has(id)) continue;
    await setDoc(doc(milestonesCol(familyId, ownerId), id), {
      key, businessId, unlockedAt: serverTimestamp(),
    });
    newlyUnlocked.push(key);
  }
  return newlyUnlocked;
}

// ── Daily stock-take (Phase 2 · A1) ───────────────────────────────
// A kid's once-a-day update of a business: tap counts (via updateBusinessItem,
// which already recomputes worth) + an always-required photo + an optional
// note. One record per business per day (doc id = YYYY-MM-DD) powers the
// streak + the weekly effort summary that drives House-Points awards (A3).

export interface StockTake {
  id: string;            // = date (YYYY-MM-DD)
  businessId: string;
  ownerId: string;
  date: string;          // YYYY-MM-DD (local)
  note?: string;
  photoUrl?: string;
  itemsTouched: number;  // how many inventory items the kid updated
  byUid: string;
  at: Timestamp;
}

export interface StockTakeInput {
  date: string;          // YYYY-MM-DD
  ownerId: string;
  itemsTouched: number;
  note?: string;
  photoUrl?: string;
}

const stockTakesCol = (familyId: string, businessId: string) =>
  collection(db, 'families', familyId, 'businesses', businessId, 'stockTakes');

/** Local date as YYYY-MM-DD. */
export function todayKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Record (or overwrite) a day's stock-take. Item count/stage edits flow
 *  through updateBusinessItem separately; this captures the daily snapshot. */
export async function saveStockTake(
  familyId: string,
  businessId: string,
  input: StockTakeInput,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  const data: Record<string, unknown> = {
    businessId,
    ownerId: input.ownerId,
    date: input.date,
    itemsTouched: Math.max(0, Math.round(input.itemsTouched || 0)),
    byUid: uid,
    at: serverTimestamp(),
  };
  if (input.note?.trim()) data.note = input.note.trim();
  if (input.photoUrl) data.photoUrl = input.photoUrl;
  await setDoc(doc(stockTakesCol(familyId, businessId), input.date), data, { merge: true });
  await updateDoc(businessDoc(familyId, businessId), { 'stats.lastActivityAt': serverTimestamp() });
}

/** Recent stock-takes (newest first) for the streak + weekly view. Single-
 *  field order — no composite index. */
export function subscribeToStockTakes(
  familyId: string,
  businessId: string,
  cb: (takes: StockTake[]) => void,
  max = 30,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(stockTakesCol(familyId, businessId), orderBy('date', 'desc'), limit(max));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as StockTake))));
}

/** Consecutive-day streak ending today (or yesterday, so a not-yet-done today
 *  doesn't break it). Pure — safe to unit test. */
export function stockTakeStreak(takes: Pick<StockTake, 'date'>[], today: string = todayKey()): number {
  const done = new Set(takes.map((t) => t.date));
  let streak = 0;
  const d = new Date(`${today}T12:00:00`);
  if (!done.has(today)) d.setDate(d.getDate() - 1); // today not done yet → count from yesterday
  for (;;) {
    if (!done.has(todayKey(d))) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

/** This-week stock-take effort for a kid across their businesses: the count of
 *  distinct calendar days they did any stock-take (last 7 days). On-demand
 *  read (not a subscription) — used by the parent's weekly HP award. */
export async function getKidWeeklyEffort(
  familyId: string,
  kidId: string,
): Promise<{ stockTakeDays: number; businessCount: number }> {
  if (isGuestActive()) return { stockTakeDays: 0, businessCount: 0 };
  const weekDates = new Set<string>();
  const t = new Date();
  for (let i = 0; i < 7; i++) { const d = new Date(t); d.setDate(t.getDate() - i); weekDates.add(todayKey(d)); }
  const bizSnap = await getDocs(query(businessesCol(familyId), where('ownerId', '==', kidId)));
  const days = new Set<string>();
  for (const b of bizSnap.docs) {
    const stSnap = await getDocs(stockTakesCol(familyId, b.id));
    stSnap.docs.forEach((s) => {
      const date = (s.data() as StockTake).date;
      if (weekDates.has(date)) days.add(date);
    });
  }
  return { stockTakeDays: days.size, businessCount: bizSnap.size };
}

/** Suggested weekly HP from effort, capped. Pure. */
export function suggestedWeeklyHp(stockTakeDays: number, perDayHp: number, weeklyCapHp: number): number {
  return Math.min(weeklyCapHp, stockTakeDays * perDayHp);
}
