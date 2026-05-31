// The Hive · Phase 1 (ledger-only) data layer.
//
// Three balance layers per kid:
//   L1 House Points (HP)  → already lives on `families/{f}/children/{kidId}.totalPoints`
//   L2 Honey Coins (🍯)   → committed savings, integer
//   L3 Cash ($)            → integer cents (avoids float drift)
//
// All Hive collections live under `families/{familyId}/kids/{kidId}/...`
// (separate sub-tree from the existing `children/{kidId}` doc so the legacy
// gameplay schema stays untouched). The `kidId` here is the same Child id.
//
// Every balance-touching write goes through `runTransaction` so the wallet
// doc and the ledger row always update together. Parent vs kid role is
// enforced in `firestore.rules`; this module trusts the rules and writes
// directly from the client (Spark plan — no Cloud Functions yet).
//
// All transfers + spends route through `approvalRequests` — a parent must
// resolve each one. Per Family.requireApprovalForHpToHoney (default true)
// even HP→Honey conversions wait for parent approval; flip the flag off
// to restore the design's "auto-approved" HP→Honey behaviour.

import {
  collection, doc, getDoc, setDoc, addDoc,
  query, where, orderBy, limit, Timestamp, serverTimestamp,
  onSnapshot, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

// ── Types ─────────────────────────────────────────────────────────

export type HiveLayer = 'house_points' | 'honey' | 'treasury' | 'cash';
export type TxDirection = 'in' | 'out';
export type TxStatus = 'completed' | 'pending_approval' | 'approved' | 'rejected';

export type ApprovalType =
  | 'hp_to_honey' | 'cash_out' | 'spend'
  | 'treasury_to_cash'       // parent turns the kid's Treasury Reserve (Honey Pot) into real Cash
  // ── Kaya Business ──────────────────────────────────────────────
  // Business reuses this one queue so the parent inbox stays unified
  // (the Business console renders a filtered view via `module`). The
  // resolution branches for these land in the Business PRs (PR2/PR6);
  // until then no business requests are created, so the resolve switch's
  // existing else-throw is a correct guard.
  | 'business_launch'        // idea/pilot → active (single-parent in Phase 1)
  | 'business_price_change'  // price moved outside the business's band
  | 'neighbours_unlock'      // open sales to neighbours (dual-parent, Phase 2)
  | 'investment_buy'         // simulated buy (single-parent OK in Phase 1)
  | 'investment_sell'        // simulated sell
  | 'capital_injection'      // parent loan/gift into a kid's business
  | 'business_hp'            // House Points for a stock-take (instant cadence, parent-review)
  | 'business_sale'          // a kid's daily auto-sale, sent for parent approval → logSale on approve
  | 'business_reinvest'      // a kid spends their OWN Honey Pot into a business — one parent OK → Pot out + business cost
  // ── Kaya Chat ──────────────────────────────────────────────────
  | 'create_group_chat';     // a kid asks a parent to open a new group chat (rename/groups, 2026-05-27)
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// Categories used both as the `category` on a HiveTransaction AND as the
// keys of a kid's monthly spending plan. Earning categories (chore, quest,
// award, convert, allowance, gift, business) are also valid TxCategory
// values but never appear in a budget — they're income, not expenses.
//
// 'spend' remains as a generic fallback for legacy / "I'm not sure" entries.
export type TxCategory =
  | 'chore' | 'quest' | 'award' | 'convert' | 'allowance'
  | 'gift'  | 'business'
  | 'spend' | 'shopping' | 'books' | 'treats' | 'donation' | 'savings' | 'other';

// Subset of TxCategory that can appear on a budget line. Keep this list
// lined up with the chips on /hive/cash-out and /hive/plan.
export const PLAN_CATEGORIES: { id: TxCategory; emoji: string; label: string }[] = [
  { id: 'shopping', emoji: '🛒', label: 'Shopping' },
  { id: 'books',    emoji: '📚', label: 'Books' },
  { id: 'treats',   emoji: '🍦', label: 'Treats' },
  { id: 'donation', emoji: '❤️', label: 'Donation' },
  { id: 'savings',  emoji: '🍯', label: 'Savings' },
  { id: 'other',    emoji: '✨', label: 'Other' },
];

export interface HiveConfig {
  hpToHoneyRate: number;            // HP per 1 Honey Coin (default 100)
  /**
   * USD per 1 Honey Coin. **Always denominated in USD**, regardless of
   * the family's display currency. This makes 🍯 a globally comparable
   * unit — every family's honey carries the same USD-equivalent value,
   * so kids in different currencies can think about saving in the same
   * "honey-language". For non-USD families we convert at the live FX
   * rate when honey actually moves into Cash.
   */
  honeyToCashRate: number;          // USD per 1 Honey Coin (default 1.00)
  currency: string;                 // ISO-4217-like; default "USD"
  minCashOut: number;               // minimum Honey to allow a cash-out request (default 5)
  spendRequiresApproval: boolean;   // default true
  cashOutRequiresApproval: boolean; // default true
  requireApprovalForHpToHoney: boolean; // default true — see comment in code
  /** Spends strictly below this amount (in cents of `currency`) auto-approve
   *  — they skip the parent inbox and post straight to the wallet. Default
   *  0 means "every spend goes through approval". A small threshold lets
   *  kids buy a candy bar without making the parent tap a button.
   *  Per-child overrides live on `Child.spendAutoApproveBelowCents`. */
  spendAutoApproveBelowCents: number;
  /** Minimum HP a kid must keep in their pot at all times — HP→Honey
   *  conversions can't drain below this floor. Default 0 means "no floor"
   *  (kids can convert everything). A non-zero value teaches savings
   *  discipline: e.g. 100 HP reserve = always keep a buffer so a streak
   *  reset doesn't drop them to zero. Cash redemptions are unaffected
   *  (only Honey converts to cash; HP never converts directly). */
  minHpReserve: number;
  /** How many distinct parents must approve a Treasury Reserve → Cash transfer.
   *  1 = single-parent (default); 2 = both parents. */
  treasuryCashApprovers: 1 | 2;
  autoAllowance?: {
    enabled: boolean;
    kidId?: string;
    amountCents?: number;
    cadence?: 'weekly' | 'monthly';
    nextRunAt?: Timestamp;
  };
}

export const DEFAULT_HIVE_CONFIG: HiveConfig = {
  hpToHoneyRate: 100,
  honeyToCashRate: 1.0, // USD
  currency: 'USD',
  minCashOut: 5,
  spendRequiresApproval: true,
  cashOutRequiresApproval: true,
  requireApprovalForHpToHoney: true,
  spendAutoApproveBelowCents: 0,
  minHpReserve: 0,
  treasuryCashApprovers: 1,
};

/**
 * Effective auto-approve threshold for a given kid. A child's per-kid
 * override (if a number) wins over the family-wide default. `null` /
 * `undefined` falls through to the family default.
 */
export function effectiveAutoApproveCents(
  child: { spendAutoApproveBelowCents?: number | null } | null | undefined,
  cfg: HiveConfig,
): number {
  if (child && typeof child.spendAutoApproveBelowCents === 'number') {
    return Math.max(0, child.spendAutoApproveBelowCents);
  }
  return Math.max(0, cfg.spendAutoApproveBelowCents || 0);
}

/**
 * "How many cents of the family's currency does this honey amount equal
 * RIGHT NOW?" Honey is benchmarked in USD, so we apply the configured
 * USD-per-honey rate first, then convert to the family currency at
 * `fxUsdToFamily` (which a caller fetches live, with a graceful fall back
 * to 1 when FX is unavailable or the family already uses USD).
 */
export function honeyToFamilyCents(
  honey: number,
  cfg: HiveConfig,
  fxUsdToFamily: number = 1,
): number {
  const usdValue = honey * cfg.honeyToCashRate;          // USD
  const familyMajor = usdValue * (fxUsdToFamily || 1);   // family-currency major units
  return Math.round(familyMajor * 100);                  // cents (minor units)
}

// Currency catalog — ISO 4217 codes plus a friendly label and a symbol
// hint. Used by the /parent/rates picker and on /parent/hive-deposit
// when accepting deposits in a non-default currency.
//
// Each entry also carries scale hints so UI inputs adapt: "small spends"
// and "Lever B" defaults are dramatically different in TZS (1 USD ≈
// 2,650 TZS) than in USD. The amounts here are in MAJOR units of the
// currency (TSh, USD, EUR…). Storage is always in cents internally.
export interface CurrencyMeta {
  code: string;
  label: string;
  symbol: string;
  /** Quick-chip preset values for the auto-approve threshold (major units). */
  smallSpends: number[];
  /** Step + max for the auto-approve threshold input (major units). */
  step: number;
  max: number;
  /** Suggested max for the Lever B (Honey → Cash) slider — same scale concept. */
  honeyMax: number;
  honeyStep: number;
  /** Sub-unit decimal places shown/entered. 2 for "cents" currencies
   *  (USD, EUR…); 0 for high-denomination currencies where the minor
   *  unit is worthless in practice (KES, TZS, NGN…). Drives both input
   *  (no decimal point) and display (no trailing ".00"). Storage stays
   *  in integer cents everywhere regardless. */
  decimals: number;
}

export const CURRENCIES: CurrencyMeta[] = [
  { code: 'USD', label: 'US Dollar',          symbol: '$',     smallSpends: [1, 2, 5, 10],            step: 0.5,  max: 100,    honeyMax: 5,     honeyStep: 0.05, decimals: 2 },
  { code: 'EUR', label: 'Euro',               symbol: '€',     smallSpends: [1, 2, 5, 10],            step: 0.5,  max: 100,    honeyMax: 5,     honeyStep: 0.05, decimals: 2 },
  { code: 'GBP', label: 'British Pound',      symbol: '£',     smallSpends: [1, 2, 5, 10],            step: 0.5,  max: 100,    honeyMax: 5,     honeyStep: 0.05, decimals: 2 },
  { code: 'TZS', label: 'Tanzanian Shilling', symbol: 'TSh ',  smallSpends: [1000, 2500, 5000, 10000], step: 500,  max: 100000, honeyMax: 10000, honeyStep: 50, decimals: 0 },
  { code: 'KES', label: 'Kenyan Shilling',    symbol: 'KSh ',  smallSpends: [100, 250, 500, 1000],    step: 50,   max: 10000,  honeyMax: 500,   honeyStep: 5, decimals: 0 },
  { code: 'UGX', label: 'Ugandan Shilling',   symbol: 'USh ',  smallSpends: [2000, 5000, 10000, 25000], step: 500, max: 200000, honeyMax: 25000, honeyStep: 100, decimals: 0 },
  { code: 'ZAR', label: 'South African Rand', symbol: 'R ',    smallSpends: [10, 25, 50, 100],        step: 5,    max: 2000,   honeyMax: 100,   honeyStep: 1, decimals: 0 },
  { code: 'NGN', label: 'Nigerian Naira',     symbol: '₦',     smallSpends: [500, 1000, 2500, 5000],  step: 100,  max: 100000, honeyMax: 5000,  honeyStep: 25, decimals: 0 },
  { code: 'AED', label: 'UAE Dirham',         symbol: 'AED ',  smallSpends: [5, 10, 25, 50],          step: 1,    max: 1000,   honeyMax: 25,    honeyStep: 0.25, decimals: 2 },
  { code: 'INR', label: 'Indian Rupee',       symbol: '₹',     smallSpends: [50, 100, 250, 500],      step: 10,   max: 10000,  honeyMax: 500,   honeyStep: 5, decimals: 0 },
  { code: 'CAD', label: 'Canadian Dollar',    symbol: 'C$',    smallSpends: [1, 2, 5, 10],            step: 0.5,  max: 100,    honeyMax: 5,     honeyStep: 0.05, decimals: 2 },
  { code: 'AUD', label: 'Australian Dollar',  symbol: 'A$',    smallSpends: [1, 2, 5, 10],            step: 0.5,  max: 100,    honeyMax: 5,     honeyStep: 0.05, decimals: 2 },
];

/** Find the symbol for the active currency; defaults to '$' if unknown. */
export function currencySymbol(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol || '$';
}

/** Find the full meta for a currency; falls back to the USD entry. */
export function currencyMeta(code: string): CurrencyMeta {
  return CURRENCIES.find((c) => c.code === code) || CURRENCIES[0];
}

/** Sub-unit decimal places for a currency (2 for USD/EUR…, 0 for
 *  high-denomination currencies like KES/TZS). Unknown codes default
 *  to 2 so a new currency never silently drops cents. */
export function currencyDecimals(code: string): number {
  return CURRENCIES.find((c) => c.code === code)?.decimals ?? 2;
}

/** True when the currency uses a sub-unit worth typing (USD cents).
 *  False for whole-number currencies (KES/TZS/NGN) — used to switch
 *  off the decimal point in amount inputs. */
export function currencyAllowsDecimals(code: string): boolean {
  return currencyDecimals(code) > 0;
}

// ── Country → Currency mapping ───────────────────────────────────
// ISO 3166 alpha-2 country code → ISO 4217 currency code. Drives
// the auto-currency-from-location flow on family setup. Anything
// not listed here falls back to USD (the global default). Currencies
// returned MUST exist in the CURRENCIES catalog above so the picker
// UI renders correctly; for countries whose native currency isn't
// yet in the catalog, USD is a safe stand-in until we add full meta.
const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // ── East / Sub-Saharan Africa ──
  TZ: 'TZS',  KE: 'KES',  UG: 'UGX',  ZA: 'ZAR',  NG: 'NGN',
  RW: 'USD',  BI: 'USD',  ET: 'USD',  GH: 'USD',  ZM: 'USD',
  BW: 'USD',  MZ: 'USD',  CI: 'USD',  SN: 'USD',
  // ── North America ──
  US: 'USD',  CA: 'CAD',  MX: 'USD',
  // ── Eurozone ──
  DE: 'EUR',  FR: 'EUR',  IT: 'EUR',  ES: 'EUR',  NL: 'EUR',
  BE: 'EUR',  IE: 'EUR',  AT: 'EUR',  PT: 'EUR',  GR: 'EUR',
  FI: 'EUR',  LU: 'EUR',
  // ── Europe (non-Euro) ──
  GB: 'GBP',  CH: 'USD',  NO: 'USD',  SE: 'USD',  DK: 'USD',
  PL: 'USD',  CZ: 'USD',  HU: 'USD',  RO: 'USD',
  // ── Middle East ──
  AE: 'AED',  SA: 'USD',  QA: 'USD',  BH: 'USD',  KW: 'USD',
  OM: 'USD',  JO: 'USD',  LB: 'USD',  IL: 'USD',
  // ── South Asia ──
  IN: 'INR',  PK: 'USD',  BD: 'USD',  LK: 'USD',  NP: 'USD',
  // ── Asia-Pacific ──
  AU: 'AUD',  NZ: 'USD',  JP: 'USD',  CN: 'USD',  SG: 'USD',
  MY: 'USD',  TH: 'USD',  PH: 'USD',  ID: 'USD',  VN: 'USD',
  KR: 'USD',  HK: 'USD',  TW: 'USD',
  // ── Latin America ──
  BR: 'USD',  AR: 'USD',  CL: 'USD',  CO: 'USD',  PE: 'USD',
};

/** ISO 3166 alpha-2 country code → ISO 4217 currency code.
 *  Defaults to USD when the country is unknown or missing.
 *  Currencies returned are guaranteed to exist in `CURRENCIES`
 *  (the picker meta) so downstream UI renders correctly. */
export function countryToCurrency(countryCode: string | undefined | null): string {
  if (!countryCode) return 'USD';
  return COUNTRY_TO_CURRENCY[countryCode.toUpperCase()] || 'USD';
}

// ── Country picker catalog ────────────────────────────────────────
// Curated list of countries Kaya has known users in or expects to
// soon — sorted with the founders' regions (East Africa, India)
// first so the most-likely options surface at the top of the
// settings dropdown. Add countries here as we expand; the
// COUNTRY_TO_CURRENCY map above must stay in sync.
export interface CountryMeta {
  code: string;   // ISO 3166 alpha-2
  label: string;  // human display name
  flag: string;   // emoji flag for the picker
  region: 'east-africa' | 'africa' | 'middle-east' | 'south-asia'
        | 'asia-pacific' | 'europe' | 'north-america' | 'latin-america';
}

export const COUNTRIES: CountryMeta[] = [
  // East Africa first — Kaya's home region
  { code: 'TZ', label: 'Tanzania',       flag: '🇹🇿', region: 'east-africa' },
  { code: 'KE', label: 'Kenya',          flag: '🇰🇪', region: 'east-africa' },
  { code: 'UG', label: 'Uganda',         flag: '🇺🇬', region: 'east-africa' },
  { code: 'RW', label: 'Rwanda',         flag: '🇷🇼', region: 'east-africa' },
  { code: 'ET', label: 'Ethiopia',       flag: '🇪🇹', region: 'east-africa' },
  // Other Africa
  { code: 'ZA', label: 'South Africa',   flag: '🇿🇦', region: 'africa' },
  { code: 'NG', label: 'Nigeria',        flag: '🇳🇬', region: 'africa' },
  { code: 'GH', label: 'Ghana',          flag: '🇬🇭', region: 'africa' },
  { code: 'ZM', label: 'Zambia',         flag: '🇿🇲', region: 'africa' },
  { code: 'BW', label: 'Botswana',       flag: '🇧🇼', region: 'africa' },
  // Middle East
  { code: 'AE', label: 'UAE',            flag: '🇦🇪', region: 'middle-east' },
  { code: 'SA', label: 'Saudi Arabia',   flag: '🇸🇦', region: 'middle-east' },
  { code: 'QA', label: 'Qatar',          flag: '🇶🇦', region: 'middle-east' },
  // South Asia
  { code: 'IN', label: 'India',          flag: '🇮🇳', region: 'south-asia' },
  { code: 'PK', label: 'Pakistan',       flag: '🇵🇰', region: 'south-asia' },
  { code: 'BD', label: 'Bangladesh',     flag: '🇧🇩', region: 'south-asia' },
  { code: 'LK', label: 'Sri Lanka',      flag: '🇱🇰', region: 'south-asia' },
  // Asia-Pacific
  { code: 'AU', label: 'Australia',      flag: '🇦🇺', region: 'asia-pacific' },
  { code: 'NZ', label: 'New Zealand',    flag: '🇳🇿', region: 'asia-pacific' },
  { code: 'SG', label: 'Singapore',      flag: '🇸🇬', region: 'asia-pacific' },
  { code: 'MY', label: 'Malaysia',       flag: '🇲🇾', region: 'asia-pacific' },
  { code: 'JP', label: 'Japan',          flag: '🇯🇵', region: 'asia-pacific' },
  // Europe
  { code: 'GB', label: 'United Kingdom', flag: '🇬🇧', region: 'europe' },
  { code: 'DE', label: 'Germany',        flag: '🇩🇪', region: 'europe' },
  { code: 'FR', label: 'France',         flag: '🇫🇷', region: 'europe' },
  { code: 'IT', label: 'Italy',          flag: '🇮🇹', region: 'europe' },
  { code: 'ES', label: 'Spain',          flag: '🇪🇸', region: 'europe' },
  { code: 'NL', label: 'Netherlands',    flag: '🇳🇱', region: 'europe' },
  // North America
  { code: 'US', label: 'United States',  flag: '🇺🇸', region: 'north-america' },
  { code: 'CA', label: 'Canada',         flag: '🇨🇦', region: 'north-america' },
  { code: 'MX', label: 'Mexico',         flag: '🇲🇽', region: 'north-america' },
  // Latin America
  { code: 'BR', label: 'Brazil',         flag: '🇧🇷', region: 'latin-america' },
  { code: 'AR', label: 'Argentina',      flag: '🇦🇷', region: 'latin-america' },
];

export const COUNTRY_REGION_LABELS: Record<CountryMeta['region'], string> = {
  'east-africa':   'East Africa',
  'africa':        'Africa',
  'middle-east':   'Middle East',
  'south-asia':    'South Asia',
  'asia-pacific':  'Asia-Pacific',
  'europe':        'Europe',
  'north-america': 'North America',
  'latin-america': 'Latin America',
};

export interface Wallet {
  // Mirror of the kid's HP from the legacy `children/{id}.totalPoints`. Kept
  // in sync on each successful HP-touching transaction so the Wallet screen
  // doesn't need a second query. If they ever drift, `totalPoints` wins.
  housePoints: number;
  honeyCoins: number;
  /** Treasury Reserve (the "Honey Pot") — the kid's earned-money pool. Business
   *  sales (Hive Transfer) land here, and Coins can convert in. A parent turns
   *  it into real Cash (which reduces it). Stored in family-currency cents. */
  treasuryCents: number;
  cashCents: number;
  totalLifetimeEarnedCents: number;
  totalLifetimeSpentCents: number;
  updatedAt?: Timestamp;
}

export const EMPTY_WALLET: Wallet = {
  housePoints: 0,
  honeyCoins: 0,
  treasuryCents: 0,
  cashCents: 0,
  totalLifetimeEarnedCents: 0,
  totalLifetimeSpentCents: 0,
};

/** A kid's spendable balance = Honey Pot + Cash. The Pot is virtual cash the
 *  parent backs and is the primary "what they have"; Cash is a second pocket
 *  a parent can hand over directly. */
export const spendableCents = (w: Pick<Wallet, 'treasuryCents' | 'cashCents'>): number =>
  (w.treasuryCents || 0) + (w.cashCents || 0);

/** A spend draws from the Honey Pot first, then Cash for any remainder.
 *  Returns how much comes from each — or null if the combined balance can't
 *  cover the amount. Single-sourced so the auto-spend path and the
 *  parent-approval resolver split a spend identically. */
export function splitSpendDebit(
  wallet: Pick<Wallet, 'treasuryCents' | 'cashCents'>,
  amountCents: number,
): { fromPot: number; fromCash: number } | null {
  const pot = wallet.treasuryCents || 0;
  const cash = wallet.cashCents || 0;
  if (pot + cash < amountCents) return null;
  const fromPot = Math.min(pot, amountCents);
  return { fromPot, fromCash: amountCents - fromPot };
}

export interface HiveTransaction {
  id: string;
  layer: HiveLayer;
  direction: TxDirection;
  /** HP / Honey are integers; Cash is integer cents. */
  amount: number;
  category: TxCategory;
  description: string;
  status: TxStatus;
  /** Pairs the two halves of a conversion (HP-out + Honey-in share an id). */
  linkedTxId?: string;
  /** Approval request that produced this entry, if any. */
  requestId?: string;
  createdBy: string;     // user uid
  approvedBy?: string;
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

export interface Goal {
  id: string;
  title: string;
  icon: string;          // emoji
  /** Target in the chosen layer's natural unit (Honey integer or Cash cents). */
  targetAmount: number;
  currentAmount: number;
  layer: 'honey' | 'cash';
  status: 'active' | 'completed' | 'abandoned';
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

// ── Monthly spending plan ─────────────────────────────────────────
//
// A kid-set budget for the current calendar month, keyed by category. Total
// is denormalised so the Hive Home can show "$30 planned" without summing
// the map. Lives at families/{f}/kids/{kidId}/monthlyPlans/{YYYY-MM} —
// document id IS the month key so we can read the active month with one
// snapshot listener.
export interface MonthlyPlan {
  monthKey: string;                          // 'YYYY-MM'
  /** Map of category → planned cents. Missing keys = no budget for that category. */
  budget: Partial<Record<TxCategory, number>>;
  totalCents: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** "2026-05" for May 2026. Used as the doc id of the active monthly plan. */
export function currentMonthKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Sum a kid's spending in the given month, grouped by category. Pure
 *  function on the existing transaction stream — no extra Firestore read. */
export function spendingByCategoryInMonth(
  transactions: HiveTransaction[],
  monthKey: string,
): Partial<Record<TxCategory, number>> {
  const [yyyy, mm] = monthKey.split('-').map((n) => parseInt(n, 10));
  if (!yyyy || !mm) return {};
  const start = new Date(yyyy, mm - 1, 1).getTime();
  const end = new Date(yyyy, mm, 1).getTime();
  const out: Partial<Record<TxCategory, number>> = {};
  for (const t of transactions) {
    if (t.layer !== 'cash' || t.direction !== 'out') continue;
    const ts = (t.createdAt as any)?.toMillis?.();
    if (typeof ts !== 'number' || ts < start || ts >= end) continue;
    const c = t.category;
    out[c] = (out[c] || 0) + t.amount;
  }
  return out;
}

export interface ApprovalRequest {
  id: string;
  kidId: string;
  type: ApprovalType;
  /** Always populated for any cash-touching request. */
  amountCents?: number;
  /** Honey amount on hp_to_honey + cash_out requests. */
  honeyAmount?: number;
  /** HP amount on hp_to_honey requests. */
  hpAmount?: number;
  description: string;
  category?: TxCategory;
  // ── Kaya Business (optional; absent on Hive-native requests) ──────
  /** Discriminates the parent inbox into sections. Absent / 'hive' = a Hive
   *  request. Resolved business requests are retained (never deleted) so the
   *  Business console can show them as approval history for future reference. */
  module?: 'hive' | 'business';
  businessId?: string;
  instrumentSymbol?: string;        // investment_buy / investment_sell
  shares?: number;                  // investment_buy / investment_sell
  points?: number;                  // business_hp — House Points to grant on approve
  awardDate?: string;               // business_hp — the stock-take day (YYYY-MM-DD)
  itemId?: string;                  // business_sale — the product sold
  productName?: string;             // business_sale — display name of the product
  saleQty?: number;                 // business_sale — quantity
  saleUnitPriceCents?: number;      // business_sale — price per unit
  /** business_reinvest — the business cost type to book (CostType in
   *  business.ts; typed as string here to avoid a hive↔business import cycle). */
  costType?: string;
  proposedTitle?: string;           // create_group_chat — group name the kid picked
  proposedMemberUids?: string[];    // create_group_chat — uids the kid asked to include
  proposedMembers?: Array<{ uid: string; name: string; role: string; avatar?: string }>; // create_group_chat — denormalized for the parent card
  /** Snapshot of the AI co-pilot context shown to the parent at decide time. */
  aiContext?: string;
  /** Dual-parent gate: distinct parent approvals required (default 1). Phase 1
   *  keeps everything single-parent; `approvals` collects approver uids so
   *  Phase 2 can switch on dual-parent without a migration. */
  requiredApprovals?: number;
  approvals?: string[];
  status: ApprovalStatus;
  rejectionReason?: string;
  /** Parent's free-text comment left at review time (approve or decline),
   *  shown to the kid. For business_hp this is also mirrored onto the
   *  stock-take day's `parentNote`. */
  approvalNote?: string;
  resultingTxIds?: string[];
  createdAt: Timestamp;
  createdBy: string;
  resolvedAt?: Timestamp;
  resolvedBy?: string;
}

// ── Path helpers ──────────────────────────────────────────────────

// Exported so the Business module can reference the same wallet doc + ledger
// collection inside its own approval transaction (Pot → business reinvest),
// keeping the path single-sourced here. One-way dep: business → hive.
export const walletPath = (familyId: string, kidId: string) =>
  doc(db, 'families', familyId, 'kids', kidId, 'wallet', 'balances');

export const txCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'hiveTransactions');

const goalCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'goals');

const requestCol = (familyId: string) =>
  collection(db, 'families', familyId, 'approvalRequests');

const planRef = (familyId: string, kidId: string, monthKey: string) =>
  doc(db, 'families', familyId, 'kids', kidId, 'monthlyPlans', monthKey);

const childRef = (familyId: string, kidId: string) =>
  doc(db, 'families', familyId, 'children', kidId);

// ── Reads + subscriptions ─────────────────────────────────────────

export async function getWallet(familyId: string, kidId: string): Promise<Wallet | null> {
  if (isGuestActive()) return EMPTY_WALLET;
  const snap = await getDoc(walletPath(familyId, kidId));
  return snap.exists() ? (snap.data() as Wallet) : null;
}

export function subscribeToWallet(
  familyId: string,
  kidId: string,
  cb: (wallet: Wallet | null) => void,
): () => void {
  if (isGuestActive()) {
    cb(EMPTY_WALLET);
    return () => {};
  }
  return onSnapshot(walletPath(familyId, kidId), (snap) => {
    cb(snap.exists() ? (snap.data() as Wallet) : null);
  });
}

export function subscribeToHiveTransactions(
  familyId: string,
  kidId: string,
  cb: (txs: HiveTransaction[]) => void,
  max = 50,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    txCol(familyId, kidId),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as HiveTransaction)));
  });
}

export function subscribeToGoals(
  familyId: string,
  kidId: string,
  cb: (goals: Goal[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(goalCol(familyId, kidId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Goal)));
  });
}

/** All pending requests in the family (parent inbox). */
export function subscribeToPendingApprovals(
  familyId: string,
  cb: (requests: ApprovalRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ApprovalRequest)));
  });
}

/** Just one kid's requests — used for the kid's "your pending" surface. */
export function subscribeToKidRequests(
  familyId: string,
  kidId: string,
  cb: (requests: ApprovalRequest[]) => void,
  max = 20,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('kidId', '==', kidId),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ApprovalRequest)));
  });
}

// ── Monthly plan ──────────────────────────────────────────────────

export function subscribeToMonthlyPlan(
  familyId: string,
  kidId: string,
  monthKey: string,
  cb: (plan: MonthlyPlan | null) => void,
): () => void {
  if (isGuestActive()) {
    cb(null);
    return () => {};
  }
  return onSnapshot(planRef(familyId, kidId, monthKey), (snap) => {
    cb(snap.exists() ? ({ ...(snap.data() as MonthlyPlan), monthKey }) : null);
  });
}

/** Save a kid's plan for a given month. Idempotent — re-saving the same
 *  month overwrites. Total is recomputed from the budget map. */
export async function saveMonthlyPlan(
  familyId: string,
  kidId: string,
  monthKey: string,
  budget: Partial<Record<TxCategory, number>>,
): Promise<void> {
  if (isGuestActive()) return;
  // Drop zero / negative entries so the doc stays clean.
  const cleaned: Partial<Record<TxCategory, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(budget)) {
    if (typeof v === 'number' && v > 0) {
      cleaned[k as TxCategory] = Math.round(v);
      total += Math.round(v);
    }
  }
  await setDoc(
    planRef(familyId, kidId, monthKey),
    {
      monthKey,
      budget: cleaned,
      totalCents: total,
      updatedAt: serverTimestamp(),
      // Set createdAt only if absent — Firestore preserves the existing
      // value when merge:true and the field is omitted on update.
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ── Wallet bootstrap ──────────────────────────────────────────────

/** Idempotent: ensures a wallet doc exists for the kid, mirroring HP from
 *  the legacy `children/{id}.totalPoints` on first creation. */
export async function ensureWallet(
  familyId: string,
  kidId: string,
  initialHousePoints = 0,
): Promise<void> {
  if (isGuestActive()) return;
  const ref = walletPath(familyId, kidId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return;
    const seed: Wallet = { ...EMPTY_WALLET, housePoints: initialHousePoints };
    tx.set(ref, { ...seed, updatedAt: serverTimestamp() });
  });
}

// ── Hive config helpers ───────────────────────────────────────────

export function readHiveConfig(family: { hiveConfig?: Partial<HiveConfig> } | null): HiveConfig {
  return { ...DEFAULT_HIVE_CONFIG, ...(family?.hiveConfig || {}) };
}

// ── Approval request creation (kid-side) ──────────────────────────

/** Create a HP→Honey request. The actual balance move happens on parent
 *  approval. Returns the new request id.
 *
 *  `currentHp` is the kid's HP balance at request time. It's used to
 *  enforce the family's `minHpReserve` floor — if a conversion would
 *  drain the pot below the reserve, we block it here so the kid sees a
 *  clear error before submitting. (The convert UI also blocks the button,
 *  but this is the defensive backstop.) Pass `undefined` to skip the
 *  reserve check — e.g. from admin scripts.
 */
export async function requestHpToHoney(
  familyId: string,
  kidId: string,
  hpAmount: number,
  cfg: HiveConfig,
  createdBy: string,
  currentHp?: number,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(hpAmount) || hpAmount <= 0) throw new Error('Pick a positive HP amount.');
  const honeyAmount = Math.floor(hpAmount / cfg.hpToHoneyRate);
  if (honeyAmount <= 0) throw new Error(`You need at least ${cfg.hpToHoneyRate} HP to make 1 🍯.`);
  // Reserve floor: never let HP→Honey drain below the family minimum.
  if (typeof currentHp === 'number' && cfg.minHpReserve > 0 && currentHp - hpAmount < cfg.minHpReserve) {
    throw new Error(`You need to keep at least ${cfg.minHpReserve} HP in your pot. You'd have ${Math.max(0, currentHp - hpAmount)} left.`);
  }

  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'hp_to_honey' as ApprovalType,
    hpAmount,
    honeyAmount,
    description: `Convert ${hpAmount} HP → ${honeyAmount} 🍯`,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

export async function requestCashOut(
  familyId: string,
  kidId: string,
  honeyAmount: number,
  cfg: HiveConfig,
  createdBy: string,
  /** Live USD → family-currency rate; pass 1 for USD families. The FX
   *  rate at *request* time is the rate the kid sees promised; we lock
   *  it in via the computed amountCents so today's deal sticks even if
   *  the parent approves a few days later. */
  fxUsdToFamily: number = 1,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(honeyAmount) || honeyAmount <= 0) throw new Error('Pick a positive 🍯 amount.');
  if (honeyAmount < cfg.minCashOut) throw new Error(`Cash-out minimum is ${cfg.minCashOut} 🍯.`);
  const amountCents = honeyToFamilyCents(honeyAmount, cfg, fxUsdToFamily);

  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'cash_out' as ApprovalType,
    honeyAmount,
    amountCents,
    // Snapshot the rate so the audit trail shows what the kid was promised.
    fxUsdToFamily,
    description: `Cash out ${honeyAmount} 🍯`,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Kid asks a parent to turn part of their Treasury Reserve (Honey Pot) into
 *  real Cash. The balance move happens on approval — single- or both-parent per
 *  `config.treasuryCashApprovers`. `amountCents` is family-currency cents. */
export async function requestTreasuryToCash(
  familyId: string,
  kidId: string,
  amountCents: number,
  createdBy: string,
  requiredApprovals: number = 1,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Pick a positive amount.');
  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'treasury_to_cash' as ApprovalType,
    amountCents,
    description: 'Turn Honey Pot into Cash',
    requiredApprovals: requiredApprovals >= 2 ? 2 : 1,
    approvals: [] as string[],
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Kid moves Coins (Honey) into their Treasury Reserve (Honey Pot). Instant —
 *  pooling their own earned value needs no parent OK; only the Pot → Cash step
 *  is gated. Coins convert to family cents at the current rate + FX. */
export async function convertCoinsToTreasury(
  familyId: string,
  kidId: string,
  honeyAmount: number,
  cfg: HiveConfig,
  createdBy: string,
  fxUsdToFamily: number = 1,
): Promise<void> {
  if (isGuestActive()) return;
  if (!Number.isInteger(honeyAmount) || honeyAmount <= 0) throw new Error('Pick a positive 🪙 amount.');
  const cents = honeyToFamilyCents(honeyAmount, cfg, fxUsdToFamily);
  await runTransaction(db, async (tx) => {
    const wRef = walletPath(familyId, kidId);
    const wSnap = await tx.get(wRef);
    if (!wSnap.exists()) throw new Error('Wallet not initialised.');
    const wallet = wSnap.data() as Wallet;
    if (wallet.honeyCoins < honeyAmount) throw new Error('Not enough Coins.');
    const link = doc(txCol(familyId, kidId)).id;
    const outRef = doc(txCol(familyId, kidId), `${link}-out`);
    const inRef = doc(txCol(familyId, kidId), `${link}-in`);
    const now = serverTimestamp();
    tx.set(wRef, {
      ...wallet,
      honeyCoins: wallet.honeyCoins - honeyAmount,
      treasuryCents: (wallet.treasuryCents || 0) + cents,
      updatedAt: now,
    });
    tx.set(outRef, {
      layer: 'honey', direction: 'out', amount: honeyAmount, category: 'convert',
      description: `Moved ${honeyAmount} 🪙 into the Honey Pot`,
      status: 'completed', linkedTxId: link,
      createdBy, approvedBy: createdBy, createdAt: now, completedAt: now,
    });
    tx.set(inRef, {
      layer: 'treasury', direction: 'in', amount: cents, category: 'convert',
      description: `From ${honeyAmount} 🪙`,
      status: 'completed', linkedTxId: link,
      createdBy, approvedBy: createdBy, createdAt: now, completedAt: now,
    });
  });
}

export async function requestSpend(
  familyId: string,
  kidId: string,
  amountCents: number,
  description: string,
  category: TxCategory,
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Pick a positive amount.');
  if (!description.trim()) throw new Error('Tell us what the money is for.');

  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'spend' as ApprovalType,
    amountCents,
    description: description.trim(),
    category,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Kid asks a parent to open a new group chat. The approval doc carries the
 *  proposed title + denormalized member list; on approve the resolver writes
 *  the thread directly (kids can't write `messageThreads` themselves). */
export async function requestCreateGroupChat(
  familyId: string,
  kidId: string,
  proposedTitle: string,
  proposedMembers: Array<{ uid: string; name: string; role: string; avatar?: string }>,
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  const title = (proposedTitle || '').trim().slice(0, 60);
  if (!title) throw new Error('Pick a name for the group.');
  if (proposedMembers.length < 2) throw new Error('Add at least one other person.');
  // Dedupe by uid; strip undefined avatars (Firestore rejects them).
  const seen = new Set<string>();
  const members = proposedMembers
    .filter((m) => m?.uid && !seen.has(m.uid) && (seen.add(m.uid), true))
    .map((m) => ({ uid: m.uid, name: m.name || 'Member', role: m.role, ...(m.avatar ? { avatar: m.avatar } : {}) }));
  const memberUids = members.map((m) => m.uid);
  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'create_group_chat' as ApprovalType,
    description: `New group chat: "${title}" (${members.length} members)`,
    proposedTitle: title,
    proposedMemberUids: memberUids,
    proposedMembers: members,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/**
 * Either creates a parent-approval request OR posts the spend straight
 * through to the wallet, depending on `autoApproveBelowCents`. The
 * caller computes the effective threshold (per-child override beats
 * family default — see `effectiveAutoApproveCents`).
 *
 * Returns `{ kind, txId | requestId }` so the caller can branch its UX —
 * auto-approved spends should show "Approved automatically · under your
 * family's $X auto-approve limit" instead of the pending banner.
 */
export async function requestOrAutoSpend(
  familyId: string,
  kidId: string,
  amountCents: number,
  description: string,
  category: TxCategory,
  autoApproveBelowCents: number,
  createdBy: string,
): Promise<{ kind: 'auto'; txId: string } | { kind: 'pending'; requestId: string }> {
  if (isGuestActive()) return { kind: 'pending', requestId: 'guest-request' };
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Pick a positive amount.');
  if (!description.trim()) throw new Error('Tell us what the money is for.');

  const auto = autoApproveBelowCents > 0 && amountCents < autoApproveBelowCents;

  if (!auto) {
    const id = await requestSpend(familyId, kidId, amountCents, description, category, createdBy);
    return { kind: 'pending', requestId: id };
  }

  // Below the family's auto-approve threshold → atomic wallet+ledger write,
  // no approvalRequest doc. The kid still sees the spend in their cash-out
  // ledger immediately. Description is tagged "[auto]" so the family can
  // distinguish from a parent-approved entry when reading the ledger later.
  let createdTxId = '';
  await runTransaction(db, async (txn) => {
    const wRef = walletPath(familyId, kidId);
    const wSnap = await txn.get(wRef);
    if (!wSnap.exists()) throw new Error('Wallet not initialised for this kid.');
    const wallet = wSnap.data() as Wallet;
    // Spend draws from the Honey Pot first, then Cash for any remainder.
    const split = splitSpendDebit(wallet, amountCents);
    if (!split) throw new Error('Not enough in your Honey Pot or Cash to cover the spend.');
    const now = serverTimestamp();
    txn.set(wRef, {
      ...wallet,
      treasuryCents: (wallet.treasuryCents || 0) - split.fromPot,
      cashCents: wallet.cashCents - split.fromCash,
      totalLifetimeSpentCents: wallet.totalLifetimeSpentCents + amountCents,
      updatedAt: now,
    });
    // One ledger row per pocket touched (Pot first), so history shows exactly
    // where the money came from. The Pot row is the primary returned id.
    if (split.fromPot > 0) {
      const potRef = doc(txCol(familyId, kidId));
      createdTxId = potRef.id;
      txn.set(potRef, {
        layer: 'treasury', direction: 'out', amount: split.fromPot,
        category, description: description.trim(),
        status: 'completed', createdBy, approvedBy: 'auto',
        createdAt: now, completedAt: now,
      });
    }
    if (split.fromCash > 0) {
      const cashRef = doc(txCol(familyId, kidId));
      if (!createdTxId) createdTxId = cashRef.id;
      txn.set(cashRef, {
        layer: 'cash', direction: 'out', amount: split.fromCash,
        category, description: description.trim(),
        status: 'completed', createdBy, approvedBy: 'auto',
        createdAt: now, completedAt: now,
      });
    }
  });
  return { kind: 'auto', txId: createdTxId };
}

/** Kid cancels their own still-pending request. */
export async function cancelOwnRequest(
  familyId: string,
  requestId: string,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(requestCol(familyId), requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = reqSnap.data() as ApprovalRequest;
    if (req.status !== 'pending') throw new Error('Request is no longer pending.');
    if (req.createdBy !== uid) throw new Error('Only the requester can cancel.');
    tx.update(reqRef, {
      status: 'rejected' as ApprovalStatus,
      rejectionReason: 'Cancelled by requester',
      resolvedAt: serverTimestamp(),
      resolvedBy: uid,
    });
  });
}

// ── Approval resolution (parent-side) ─────────────────────────────

/**
 * Atomically approve or reject a request. On approval the wallet doc + the
 * matching `hiveTransactions` entries + (for HP-touching requests) the
 * legacy `children/{id}.totalPoints` are all updated in one transaction.
 *
 * `approverUid` must belong to a parent in `familyId` — the rules also
 * enforce this server-side, but we fail fast here for a better error.
 */
export async function resolveApprovalRequest(
  familyId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  approverUid: string,
  rejectionReason?: string,
): Promise<void> {
  if (isGuestActive()) return;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(requestCol(familyId), requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = { id: reqSnap.id, ...reqSnap.data() } as ApprovalRequest;
    if (req.status !== 'pending') throw new Error('Request already resolved.');

    if (decision === 'rejected') {
      tx.update(reqRef, {
        status: 'rejected' as ApprovalStatus,
        rejectionReason: rejectionReason || '',
        resolvedAt: serverTimestamp(),
        resolvedBy: approverUid,
      });
      return;
    }

    // ── Approval branches per request type ────────────────────────
    const wRef = walletPath(familyId, req.kidId);
    const wSnap = await tx.get(wRef);
    if (!wSnap.exists()) throw new Error('Wallet not initialised for this kid.');
    const wallet = wSnap.data() as Wallet;

    if (req.type === 'hp_to_honey') {
      const hp = req.hpAmount ?? 0;
      const honey = req.honeyAmount ?? 0;
      const cRef = childRef(familyId, req.kidId);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists()) throw new Error('Child not found.');
      const child = cSnap.data() as { totalPoints?: number };
      if ((child.totalPoints ?? 0) < hp) throw new Error('Not enough House Points.');

      // Two paired ledger entries — same linkedTxId so we can pivot on a
      // conversion in the activity feed.
      const link = doc(txCol(familyId, req.kidId)).id;
      const outRef = doc(txCol(familyId, req.kidId), `${link}-out`);
      const inRef = doc(txCol(familyId, req.kidId), `${link}-in`);
      const now = serverTimestamp();

      tx.update(cRef, { totalPoints: (child.totalPoints ?? 0) - hp });
      tx.set(wRef, {
        ...wallet,
        housePoints: Math.max(0, wallet.housePoints - hp),
        honeyCoins: wallet.honeyCoins + honey,
        updatedAt: now,
      });
      tx.set(outRef, {
        layer: 'house_points', direction: 'out', amount: hp, category: 'convert',
        description: `Saved ${hp} HP → ${honey} 🍯`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.set(inRef, {
        layer: 'honey', direction: 'in', amount: honey, category: 'convert',
        description: `From ${hp} HP`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds: [`${link}-out`, `${link}-in`],
      });
    } else if (req.type === 'cash_out') {
      const honey = req.honeyAmount ?? 0;
      const cents = req.amountCents ?? 0;
      if (wallet.honeyCoins < honey) throw new Error('Not enough Honey Coins.');

      const link = doc(txCol(familyId, req.kidId)).id;
      const outRef = doc(txCol(familyId, req.kidId), `${link}-out`);
      const inRef = doc(txCol(familyId, req.kidId), `${link}-in`);
      const now = serverTimestamp();

      tx.set(wRef, {
        ...wallet,
        honeyCoins: wallet.honeyCoins - honey,
        cashCents: wallet.cashCents + cents,
        totalLifetimeEarnedCents: wallet.totalLifetimeEarnedCents + cents,
        updatedAt: now,
      });
      tx.set(outRef, {
        layer: 'honey', direction: 'out', amount: honey, category: 'convert',
        description: `Cashed out ${honey} 🍯`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.set(inRef, {
        layer: 'cash', direction: 'in', amount: cents, category: 'convert',
        description: `From ${honey} 🍯`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds: [`${link}-out`, `${link}-in`],
      });
    } else if (req.type === 'treasury_to_cash') {
      const cents = req.amountCents ?? 0;
      if ((wallet.treasuryCents || 0) < cents) throw new Error('Not enough in the Honey Pot.');
      const required = req.requiredApprovals && req.requiredApprovals >= 2 ? 2 : 1;
      const already = Array.isArray(req.approvals) ? req.approvals : [];
      if (already.includes(approverUid)) throw new Error('You already approved this — it needs the other parent.');
      const nextApprovals = [...already, approverUid];
      if (nextApprovals.length < required) {
        // First of two parents — record the approval, keep it pending for the second.
        tx.update(reqRef, { approvals: nextApprovals });
        return;
      }
      // Threshold met — move Honey Pot → Cash. (Already counted as earned when it
      // entered the Pot, so we don't re-add to lifetime earnings here.)
      const link = doc(txCol(familyId, req.kidId)).id;
      const outRef = doc(txCol(familyId, req.kidId), `${link}-out`);
      const inRef = doc(txCol(familyId, req.kidId), `${link}-in`);
      const now = serverTimestamp();
      tx.set(wRef, {
        ...wallet,
        treasuryCents: (wallet.treasuryCents || 0) - cents,
        cashCents: wallet.cashCents + cents,
        updatedAt: now,
      });
      tx.set(outRef, {
        layer: 'treasury', direction: 'out', amount: cents, category: 'convert',
        description: 'Honey Pot → Cash',
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.set(inRef, {
        layer: 'cash', direction: 'in', amount: cents, category: 'convert',
        description: 'From your Honey Pot',
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        approvals: nextApprovals,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds: [`${link}-out`, `${link}-in`],
      });
    } else if (req.type === 'spend') {
      const cents = req.amountCents ?? 0;
      // Spend draws from the Honey Pot first, then Cash for any remainder.
      const split = splitSpendDebit(wallet, cents);
      if (!split) throw new Error('Not enough in the Honey Pot or Cash to cover the spend.');

      const now = serverTimestamp();
      const resultingTxIds: string[] = [];

      tx.set(wRef, {
        ...wallet,
        treasuryCents: (wallet.treasuryCents || 0) - split.fromPot,
        cashCents: wallet.cashCents - split.fromCash,
        totalLifetimeSpentCents: wallet.totalLifetimeSpentCents + cents,
        updatedAt: now,
      });
      // One ledger row per pocket touched (Pot first), so the kid's history
      // shows exactly where the money came from.
      if (split.fromPot > 0) {
        const potRef = doc(txCol(familyId, req.kidId));
        resultingTxIds.push(potRef.id);
        tx.set(potRef, {
          layer: 'treasury', direction: 'out', amount: split.fromPot,
          category: req.category || 'spend',
          description: req.description,
          status: 'completed', requestId,
          createdBy: req.createdBy, approvedBy: approverUid,
          createdAt: now, completedAt: now,
        });
      }
      if (split.fromCash > 0) {
        const cashRef = doc(txCol(familyId, req.kidId));
        resultingTxIds.push(cashRef.id);
        tx.set(cashRef, {
          layer: 'cash', direction: 'out', amount: split.fromCash,
          category: req.category || 'spend',
          description: req.description,
          status: 'completed', requestId,
          createdBy: req.createdBy, approvedBy: approverUid,
          createdAt: now, completedAt: now,
        });
      }
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds,
      });
    } else if (req.type === 'create_group_chat') {
      // No money flow — write a new thread doc and mark the request approved.
      // (The wallet load above is wasted work but harmless; keeping the
      // resolver shape single-transaction so unknown types still throw cleanly.)
      const title = (req.proposedTitle || '').trim().slice(0, 60);
      const members = Array.isArray(req.proposedMembers) ? req.proposedMembers : [];
      if (!title) throw new Error('Group name missing on this request.');
      if (members.length < 2) throw new Error('This request has too few members.');
      const newThreadRef = doc(collection(db, 'families', familyId, 'threads'));
      const now = serverTimestamp();
      // Dedupe by uid; strip stray undefined avatar fields.
      const seen = new Set<string>();
      const cleanMembers = members
        .filter((m) => m?.uid && !seen.has(m.uid) && (seen.add(m.uid), true))
        .map((m) => ({ uid: m.uid, name: m.name || 'Member', role: m.role, ...(m.avatar ? { avatar: m.avatar } : {}) }));
      tx.set(newThreadRef, {
        kind: 'group',
        title,
        memberUids: cleanMembers.map((m) => m.uid),
        members: cleanMembers,
        createdByUid: req.createdBy,
        createdByRole: 'kid',
        createdAt: now,
        updatedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
      });
    } else {
      throw new Error(`Unknown approval type: ${(req as any).type}`);
    }
  });
}

// ── Direct cash deposit (parent-only) ─────────────────────────────

/** Allowance / gift / business income deposit, no approval needed because
 *  the parent IS the approver. Rules block kids from calling this. */
export async function depositCash(
  familyId: string,
  kidId: string,
  amountCents: number,
  category: 'allowance' | 'gift' | 'business' | 'other',
  description: string,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Amount must be positive cents.');
  await runTransaction(db, async (txn) => {
    const wRef = walletPath(familyId, kidId);
    const wSnap = await txn.get(wRef);
    const wallet = (wSnap.exists() ? wSnap.data() : EMPTY_WALLET) as Wallet;
    const txRef = doc(txCol(familyId, kidId));
    const now = serverTimestamp();
    txn.set(wRef, {
      ...wallet,
      cashCents: wallet.cashCents + amountCents,
      totalLifetimeEarnedCents: wallet.totalLifetimeEarnedCents + amountCents,
      updatedAt: now,
    });
    txn.set(txRef, {
      layer: 'cash', direction: 'in', amount: amountCents, category,
      description: description.trim() || category, status: 'completed',
      createdBy: uid, approvedBy: uid,
      createdAt: now, completedAt: now,
    });
  });
}

/** Pay money into the kid's Treasury Reserve (the "Honey Pot") — this is where
 *  business sales (Hive Transfer) land. Same shape as {@link depositCash} but
 *  it credits `treasuryCents`, not real Cash (a parent later turns the Pot into
 *  Cash). Stored in family-currency cents. */
export async function depositToTreasury(
  familyId: string,
  kidId: string,
  amountCents: number,
  category: 'business' | 'other',
  description: string,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Amount must be positive cents.');
  await runTransaction(db, async (txn) => {
    const wRef = walletPath(familyId, kidId);
    const wSnap = await txn.get(wRef);
    const wallet = (wSnap.exists() ? wSnap.data() : EMPTY_WALLET) as Wallet;
    const txRef = doc(txCol(familyId, kidId));
    const now = serverTimestamp();
    txn.set(wRef, {
      ...wallet,
      treasuryCents: (wallet.treasuryCents || 0) + amountCents,
      totalLifetimeEarnedCents: wallet.totalLifetimeEarnedCents + amountCents,
      updatedAt: now,
    });
    txn.set(txRef, {
      layer: 'treasury', direction: 'in', amount: amountCents, category,
      description: description.trim() || category, status: 'completed',
      createdBy: uid, approvedBy: uid,
      createdAt: now, completedAt: now,
    });
  });
}

// ── Goals ─────────────────────────────────────────────────────────

export async function addGoal(
  familyId: string,
  kidId: string,
  goal: Omit<Goal, 'id' | 'createdAt' | 'currentAmount' | 'status'>,
): Promise<string> {
  if (isGuestActive()) return 'guest-goal';
  const ref = await addDoc(goalCol(familyId, kidId), {
    ...goal,
    currentAmount: 0,
    status: 'active' as Goal['status'],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// ── Family-level config writes (parent-only) ──────────────────────

export async function setHiveConfig(
  familyId: string,
  patch: Partial<HiveConfig>,
): Promise<void> {
  if (isGuestActive()) return;
  // The Family doc may not have hiveConfig yet; merge into a sub-field.
  await setDoc(
    doc(db, 'families', familyId),
    { hiveConfig: patch } as any,
    { merge: true },
  );
}
