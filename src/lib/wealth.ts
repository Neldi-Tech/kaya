// Kaya Wealth · Asset Register data layer (Phase 1 · 2026-06-01).
//
// One collection: families/{f}/wealth_assets/{assetId} — every holding the
// family vault tracks, grouped by class + liquidity. Each asset carries an
// append-only edit log subcollection (…/editLog/{entryId}) so every change
// is attributable and permanent (Non-Negotiable #9 — the log is read-only,
// enforced in firestore.rules).
//
// Visibility tiers (Non-Negotiables §B/§D):
//   'shared'   → both parents see it (the family net-worth picture)
//   'personal' → only the owning parent; hidden from the co-parent + admin
//   'junior'   → a child's parent-guided wealth (parents see + advise)
//
// Money convention: every amount is CENTS of the asset's own `currency`
// (ISO 4217), matching formatCents() and the rest of Kaya. The roll-up
// converts each asset into the household currency for the net-worth total
// using a caller-supplied FX resolver (see lib/fx.ts), never retroactively.
//
// Source of truth for the taxonomy: Kaya-Wealth_Concept-Note_Detailed §4.
// The `wealth_assets` collection name is the seam the Household →
// Subscriptions module already references (lib/subscriptions.ts:
// linkedWealthAssetId → /families/{f}/wealth_assets/{id}).

import {
  collection, doc, getDoc, getDocs, onSnapshot, query, orderBy, where,
  serverTimestamp, writeBatch, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

// ── Visibility + liquidity ───────────────────────────────────────────

export type WealthVisibility = 'shared' | 'personal' | 'junior';

export type Liquidity = 'high' | 'medium' | 'low' | 'locked' | 'varies' | 'none';

export const LIQUIDITY_LABEL: Record<Liquidity, string> = {
  high:   'High liquidity',
  medium: 'Medium liquidity',
  low:    'Low liquidity',
  locked: 'Locked until retirement',
  varies: 'Varies',
  none:   '—',
};

// ── Asset classes — the 11-class taxonomy (Concept Note §4) ───────────
// Order here IS the canonical display order (matches the mockup legend).

export type AssetClassId =
  | 'cash'           // Cash & Equivalents
  | 'public_markets' // Public Markets
  | 'private_alt'    // Private & Alternative
  | 'investments'    // Investments — ownership stakes, angel, funds, brokerage
  | 'real_estate'    // Real Estate & Land
  | 'retirement'     // Retirement & Pension
  | 'vehicles'       // Vehicles & Equipment
  | 'valuables'      // Valuables & Collectibles
  | 'receivables'    // Receivables / Loans given
  | 'insurance'      // Insurance & Endowment
  | 'digital'        // Digital Assets
  | 'liabilities';   // Liabilities (offset — reduce net worth)

export interface AssetClassDef {
  id: AssetClassId;
  label: string;
  emoji: string;
  liquidity: Liquidity;
  examples: string;
  /** Liabilities offset net worth — their value is subtracted, not added. */
  isLiability?: boolean;
}

export const ASSET_CLASSES: AssetClassDef[] = [
  { id: 'cash',           label: 'Cash & Equivalents',     emoji: '💵', liquidity: 'high',   examples: 'Bank balances, mobile money, FX cash' },
  { id: 'public_markets', label: 'Public Markets',         emoji: '📈', liquidity: 'high',   examples: 'Listed stocks, ETFs, bonds, T-bills, unit trusts' },
  { id: 'private_alt',    label: 'Private & Alternative',  emoji: '🏢', liquidity: 'low',    examples: 'Startup equity, private business stakes' },
  { id: 'investments',    label: 'Investments',            emoji: '📊', liquidity: 'varies', examples: 'Controlling / minority stakes, angel, funds, brokerage (IBKR)' },
  { id: 'real_estate',    label: 'Real Estate & Land',     emoji: '🏠', liquidity: 'medium', examples: 'Houses, plots, developments' },
  { id: 'retirement',     label: 'Retirement & Pension',   emoji: '🌅', liquidity: 'locked', examples: 'NSSF / PSSSF, private pension top-ups' },
  { id: 'vehicles',       label: 'Vehicles & Equipment',   emoji: '🚗', liquidity: 'medium', examples: 'Cars, machinery — depreciating assets' },
  { id: 'valuables',      label: 'Valuables & Collectibles', emoji: '💎', liquidity: 'low',  examples: 'Gold, jewelry, art, livestock' },
  { id: 'receivables',    label: 'Receivables / Loans given', emoji: '🤝', liquidity: 'varies', examples: 'Money owed to the family' },
  { id: 'insurance',      label: 'Insurance & Endowment',  emoji: '🛡️', liquidity: 'low',    examples: 'Policies with cash value' },
  { id: 'digital',        label: 'Digital Assets',         emoji: '🪙', liquidity: 'varies', examples: 'Crypto, domains, IP / royalties' },
  { id: 'liabilities',    label: 'Liabilities (offset)',   emoji: '⚖️', liquidity: 'none',   examples: 'Mortgages, loans — reduce net worth', isLiability: true },
];

export interface SubTypeDef { id: string; label: string; emoji: string }

/** Investment ownership levels (class === 'investments'). */
export const INVESTMENT_SUBTYPES: SubTypeDef[] = [
  { id: 'controlling', label: 'Controlling Interest (>50%)', emoji: '👑' },
  { id: 'minority',    label: 'Minority (<50%)',             emoji: '🤝' },
  { id: 'angel',       label: 'Angel / Early-stage',         emoji: '🚀' },
  { id: 'general',     label: 'General Investment',          emoji: '📈' },
  { id: 'funds',       label: 'Funds / ETFs',                emoji: '🧺' },
  { id: 'broker',      label: 'Brokerage account',           emoji: '🏦' },
];

/** Cash kinds (class === 'cash') — Stablecoins join the liquid pool. */
export const CASH_SUBTYPES: SubTypeDef[] = [
  { id: 'bank',       label: 'Bank balance',             emoji: '🏦' },
  { id: 'mobile',     label: 'Mobile money',             emoji: '📱' },
  { id: 'fx',         label: 'FX cash',                  emoji: '💱' },
  { id: 'stablecoin', label: 'Stablecoin (USDT / USDC)', emoji: '🪙' },
];

export function subTypesFor(klass: AssetClassId): SubTypeDef[] {
  return klass === 'investments' ? INVESTMENT_SUBTYPES : klass === 'cash' ? CASH_SUBTYPES : [];
}
export function subTypeLabel(klass: AssetClassId, id?: string | null): string | null {
  if (!id) return null;
  return subTypesFor(klass).find((s) => s.id === id)?.label ?? null;
}

const CLASS_BY_ID: Record<AssetClassId, AssetClassDef> =
  Object.fromEntries(ASSET_CLASSES.map((c) => [c.id, c])) as Record<AssetClassId, AssetClassDef>;

export function assetClassDef(id: AssetClassId): AssetClassDef {
  return CLASS_BY_ID[id] ?? ASSET_CLASSES[0];
}

// ── Asset shape ──────────────────────────────────────────────────────

/** Insurance attached to an asset (Property primarily). When `insured` is
 *  true, the premium + renewal mirror DOWN to Household → Subscriptions as
 *  a read-only entry (sourceModule='wealth', linkedWealthAssetId=asset.id).
 *  See `buildInsuranceMirror` below — the funnel only ever flows down. */
export interface WealthInsurance {
  insured: boolean;
  amountCents?: number;       // sum insured, in `currency`
  provider?: string;
  premiumCents?: number;      // per year, in `premiumCurrency`
  premiumCurrency?: string;
  renewalIso?: string;        // 'YYYY-MM-DD'
}

export type WealthMediaKind = 'doc' | 'photo' | 'scan' | 'video' | 'pdf';

export interface WealthMedia {
  id: string;
  kind: WealthMediaKind;
  label: string;
  storagePath: string;        // Firebase Storage path
  url: string;                // download URL (for gallery display)
  enhanced?: boolean;         // ran through scan + auto-enhance
  uploadedAt: Timestamp;
}

/** Lightweight presentational extras lifted from the approved mockup — a
 *  one-line subtitle, a period change %, a maturity note, an inline tag. */
export interface WealthAssetMeta {
  subtitle?: string;          // "Plot 412 · Title CT-88291"
  changePct?: number;         // +6.2 → "▲ 6.2%"
  maturityNote?: string;      // "Matures 28 Jun" / "Land rent due 12 Aug"
  tag?: string;               // "Shared", "Guided"
}

export interface WealthHolding {
  id: string;
  symbol: string;        // 'AAPL', 'VWRA ETF', 'Cash'…
  units: number | null;  // shares/units; null for a cash line
  valueCents: number;    // value in the asset's own currency
}

/** A tenant paying rent on a property. Rent isn't auto-collected, so `status`
 *  doubles as a paid/due reminder the parent flips each period. */
export interface Tenant {
  id: string;
  name: string;            // tenant name / unit ("Unit A · J. Mushi")
  rentCents: number;       // rent per period, in `currency`
  currency: string;        // ISO 4217
  frequency: 'month' | 'day';
  status: 'paid' | 'due';
  nextDueIso?: string;     // 'YYYY-MM-DD' — optional next-due date
}

export interface WealthRental {
  tenants: Tenant[];
}

/** A tenant's rent normalised to a MONTHLY amount in its own currency. */
export function tenantMonthlyCents(t: Tenant): number {
  return t.frequency === 'day' ? Math.round(t.rentCents * 30) : t.rentCents;
}

export interface WealthAsset {
  id: string;
  class: AssetClassId;
  /** Optional sub-type within the class — investment ownership level
   *  ('controlling'|'minority'|'angel'|'general'|'funds'|'broker') or a cash
   *  kind ('bank'|'mobile'|'fx'|'stablecoin'). UI-driven, free-form. */
  subType?: string | null;
  name: string;

  // money — CENTS of `currency`
  valueCents: number;
  currency: string;           // ISO 4217 ('TZS', 'USD'…)
  /** Brokerage / fund holdings that sum to valueCents (optional breakdown). */
  holdings?: WealthHolding[] | null;

  visibility: WealthVisibility;
  ownerId: string;            // uid — load-bearing for `personal` privacy
  /** Personal asset only: the owner toggled it visible to the co-parent(s) —
   *  they can then read it and it counts in the shared net worth. Default false. */
  sharedWithPartner?: boolean | null;
  juniorId: string | null;    // childId when visibility === 'junior'

  meta: WealthAssetMeta;
  media: WealthMedia[];
  insurance: WealthInsurance | null;
  /** Rental — tenants paying rent on this property; the total monthly rent is
   *  the property's passive income. Real estate only. */
  rental?: WealthRental | null;
  /** The mirrored Household → Subscriptions doc id, once insurance flows
   *  down. null until mirrored. */
  mirroredSubscriptionId: string | null;

  createdBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  archivedAt: Timestamp | null;
}

// ── Edit log (append-only audit trail) ───────────────────────────────

export type WealthEditAction =
  | 'created' | 'value_updated' | 'insurance_changed'
  | 'document_added' | 'edited' | 'archived';

export interface WealthEditLogEntry {
  id: string;
  ts: Timestamp;
  authorId: string;
  authorName: string;         // denormalised for display ("Elia", "System")
  action: WealthEditAction;
  summary: string;            // "Value updated TZS 920M → 980M"
  before?: unknown;
  after?: unknown;
}

// ── Collection refs ──────────────────────────────────────────────────

const assetsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'wealth_assets');

const logCol = (familyId: string, assetId: string) =>
  collection(db, 'families', familyId, 'wealth_assets', assetId, 'editLog');

// ── Reads ────────────────────────────────────────────────────────────

/** Live subscription to a family's assets. Sort is client-side (value
 *  DESC within the roll-up) so no composite index is needed — the list
 *  is small per family. Mirrors lib/subscriptions.ts. Archived assets are
 *  filtered out here; pass `includeArchived` to keep them. */
export function subscribeToWealthAssets(
  familyId: string,
  uid: string,
  cb: (assets: WealthAsset[]) => void,
  opts: { includeArchived?: boolean } = {},
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const col = assetsCol(familyId);
  // The read rule is row-conditional — a parent may read non-personal rows OR
  // their own personal rows, but NOT a co-parent's personal rows. Firestore
  // rejects an UNCONSTRAINED collection query against such a rule ("rules are
  // not filters"), so a plain onSnapshot(col) returns permission-denied and
  // the vault looks empty. We instead run two rule-satisfying queries and
  // merge them: every row I own (any visibility) + every non-personal row.
  // A co-parent's personal rows match neither query, so they never leak.
  // Three rule-satisfying queries, merged: my own rows + every non-personal
  // row + every personal row toggled "visible to partner" (so a co-parent
  // sees what was shared, and it counts in the shared net worth).
  const mine = new Map<string, WealthAsset>();
  const open = new Map<string, WealthAsset>();
  const sharedP = new Map<string, WealthAsset>();
  const seen = { mine: false, open: false, sharedP: false };
  const emit = () => {
    if (!seen.mine || !seen.open || !seen.sharedP) return; // wait for all three
    const m = new Map<string, WealthAsset>(open);
    for (const [k, v] of sharedP) m.set(k, v);
    for (const [k, v] of mine) m.set(k, v); // own rows win on overlap
    let list = Array.from(m.values());
    if (!opts.includeArchived) list = list.filter((a) => !a.archivedAt);
    cb(list);
  };
  const u1 = onSnapshot(query(col, where('ownerId', '==', uid)),
    (snap) => { mine.clear(); snap.forEach((d) => mine.set(d.id, { id: d.id, ...d.data() } as WealthAsset)); seen.mine = true; emit(); },
    // eslint-disable-next-line no-console
    (err) => { seen.mine = true; console.error('[wealth] subscribe (own) failed:', err); emit(); });
  const u2 = onSnapshot(query(col, where('visibility', 'in', ['shared', 'junior'])),
    (snap) => { open.clear(); snap.forEach((d) => open.set(d.id, { id: d.id, ...d.data() } as WealthAsset)); seen.open = true; emit(); },
    // eslint-disable-next-line no-console
    (err) => { seen.open = true; console.error('[wealth] subscribe (shared) failed:', err); emit(); });
  const u3 = onSnapshot(query(col, where('sharedWithPartner', '==', true)),
    (snap) => { sharedP.clear(); snap.forEach((d) => sharedP.set(d.id, { id: d.id, ...d.data() } as WealthAsset)); seen.sharedP = true; emit(); },
    // eslint-disable-next-line no-console
    (err) => { seen.sharedP = true; console.error('[wealth] subscribe (sharedWithPartner) failed:', err); emit(); });
  return () => { u1(); u2(); u3(); };
}

export async function listWealthAssets(familyId: string): Promise<WealthAsset[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(assetsCol(familyId));
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as WealthAsset))
    .filter((a) => !a.archivedAt);
}

export async function getWealthAsset(
  familyId: string, assetId: string,
): Promise<WealthAsset | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(doc(db, 'families', familyId, 'wealth_assets', assetId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as WealthAsset) : null;
}

/** Live subscription to an asset's edit log, newest first. Single-field
 *  `ts` index is auto-created — no composite index required. */
export function subscribeToEditLog(
  familyId: string, assetId: string,
  cb: (entries: WealthEditLogEntry[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(
    query(logCol(familyId, assetId), orderBy('ts', 'desc')),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WealthEditLogEntry))),
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[wealth] editLog subscribe failed:', err);
      cb([]);
    },
  );
}

// ── Writes (asset + edit-log entry, atomic) ──────────────────────────

export interface WealthAuthor { uid: string; name: string }

export interface CreateWealthAssetInput {
  familyId: string;
  class: AssetClassId;
  subType?: string | null;
  name: string;
  valueCents: number;
  currency: string;
  holdings?: WealthHolding[] | null;
  visibility: WealthVisibility;
  /** For 'personal' this MUST be the author's uid (rules enforce it). */
  ownerId: string;
  sharedWithPartner?: boolean;
  juniorId?: string | null;
  meta?: WealthAssetMeta;
  insurance?: WealthInsurance | null;
  rental?: WealthRental | null;
  author: WealthAuthor;
}

/** Create an asset and seed its first 'created' log entry in one batch so
 *  the audit trail can never be missing its origin. */
export async function createWealthAsset(
  input: CreateWealthAssetInput,
): Promise<{ assetId: string }> {
  if (isGuestActive()) return { assetId: 'guest-asset' };
  const ref = doc(assetsCol(input.familyId));
  const logRef = doc(collection(ref, 'editLog'));
  const batch = writeBatch(db);
  batch.set(ref, {
    class: input.class,
    subType: input.subType ?? null,
    name: input.name,
    valueCents: input.valueCents,
    currency: input.currency,
    holdings: input.holdings ?? null,
    visibility: input.visibility,
    ownerId: input.ownerId,
    sharedWithPartner: input.sharedWithPartner ?? false,
    juniorId: input.juniorId ?? null,
    meta: input.meta ?? {},
    media: [],
    insurance: input.insurance ?? null,
    rental: input.rental ?? null,
    mirroredSubscriptionId: null,
    createdBy: input.author.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    archivedAt: null,
  });
  batch.set(logRef, {
    ts: serverTimestamp(),
    authorId: input.author.uid,
    authorName: input.author.name,
    action: 'created',
    summary: `Asset created — ${input.name}`,
    after: { valueCents: input.valueCents, currency: input.currency },
  });
  await batch.commit();
  return { assetId: ref.id };
}

/** Editable subset of an asset. createdBy/createdAt/ownerId/mirrored* are
 *  immutable from the UI; visibility changes are a deliberate, separate
 *  flow (moving an asset between Shared/Personal/Junior re-checks rules). */
export type WealthAssetPatch = Partial<Pick<WealthAsset,
  | 'class' | 'subType' | 'name' | 'valueCents' | 'currency' | 'holdings'
  | 'meta' | 'insurance' | 'juniorId' | 'sharedWithPartner' | 'rental'
>>;

/** Which assets belong in a given view for a given parent.
 *  - personal: the viewer's OWN personal assets.
 *  - shared:   family-shared assets + personal assets any parent toggled
 *              "visible to partner" (so the shared net worth is symmetric).
 *  A co-parent's private (non-shared) personal assets never appear. */
export function assetInView(a: WealthAsset, view: 'shared' | 'personal', uid: string): boolean {
  if (view === 'personal') return a.visibility === 'personal' && a.ownerId === uid;
  return a.visibility === 'shared' || (a.visibility === 'personal' && a.sharedWithPartner === true);
}

export interface WealthChange {
  action: WealthEditAction;
  summary: string;
  before?: unknown;
  after?: unknown;
}

/** Patch an asset and append a matching log entry in one batch. Every
 *  caller MUST describe the change (`change`) so the trail stays human. */
export async function updateWealthAsset(params: {
  familyId: string;
  assetId: string;
  patch: WealthAssetPatch;
  author: WealthAuthor;
  change: WealthChange;
}): Promise<void> {
  if (isGuestActive()) return;
  const { familyId, assetId, patch, author, change } = params;
  const ref = doc(db, 'families', familyId, 'wealth_assets', assetId);
  const logRef = doc(collection(ref, 'editLog'));
  const batch = writeBatch(db);
  batch.update(ref, { ...patch, updatedAt: serverTimestamp() });
  batch.set(logRef, {
    ts: serverTimestamp(),
    authorId: author.uid,
    authorName: author.name,
    action: change.action,
    summary: change.summary,
    ...(change.before !== undefined ? { before: change.before } : {}),
    ...(change.after !== undefined ? { after: change.after } : {}),
  });
  await batch.commit();
}

/** Append a standalone log entry (e.g. a document add, or a 'System'
 *  auto-sync) without otherwise patching the asset. */
export async function addEditLogEntry(
  familyId: string, assetId: string,
  entry: { author: WealthAuthor; action: WealthEditAction; summary: string; before?: unknown; after?: unknown },
): Promise<void> {
  if (isGuestActive()) return;
  const logRef = doc(logCol(familyId, assetId));
  const batch = writeBatch(db);
  batch.set(logRef, {
    ts: serverTimestamp(),
    authorId: entry.author.uid,
    authorName: entry.author.name,
    action: entry.action,
    summary: entry.summary,
    ...(entry.before !== undefined ? { before: entry.before } : {}),
    ...(entry.after !== undefined ? { after: entry.after } : {}),
  });
  await batch.commit();
}

/** Soft-delete: archive (preserve the trail) rather than hard delete. */
export async function archiveWealthAsset(
  familyId: string, assetId: string, author: WealthAuthor,
): Promise<void> {
  if (isGuestActive()) return;
  const ref = doc(db, 'families', familyId, 'wealth_assets', assetId);
  const logRef = doc(collection(ref, 'editLog'));
  const batch = writeBatch(db);
  batch.update(ref, { archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  batch.set(logRef, {
    ts: serverTimestamp(),
    authorId: author.uid,
    authorName: author.name,
    action: 'archived',
    summary: 'Asset archived',
  });
  await batch.commit();
}

// ── Net-worth roll-up (client-side) ──────────────────────────────────
//
// Convert every asset into the household currency via `rateFor(currency)`
// (a multiplier asset-currency → household; 1 when equal). Liabilities
// subtract. Callers pre-filter `assets` by the active view (shared /
// personal / a single junior) before rolling up.

/** Resolve a multiplier from an asset's currency to the household
 *  currency. Page wires this from lib/fx.ts (resolveFxRate), pre-resolving
 *  the small set of currencies present. Falls back to 1 (treat as already
 *  household) when a rate is unknown — never throws. */
export type FxResolver = (currency: string) => number;

export interface WealthClassGroup {
  def: AssetClassDef;
  /** Household-currency cents. Liabilities are negative here. */
  subtotalCents: number;
  assets: WealthAsset[];
}

export interface WealthSummary {
  householdCurrency: string;
  netWorthCents: number;          // assets − liabilities, household currency
  totalAssetsCents: number;
  totalLiabilitiesCents: number;  // positive magnitude
  byLiquidity: { liquidity: Liquidity; label: string; cents: number }[];
  groups: WealthClassGroup[];     // in canonical class order, non-empty only
}

function toHousehold(asset: WealthAsset, rateFor: FxResolver): number {
  const r = rateFor(asset.currency);
  return Math.round(asset.valueCents * (Number.isFinite(r) && r > 0 ? r : 1));
}

export function computeWealthSummary(
  assets: WealthAsset[],
  householdCurrency: string,
  rateFor: FxResolver,
): WealthSummary {
  const groupMap = new Map<AssetClassId, WealthAsset[]>();
  const liqMap = new Map<Liquidity, number>();
  let totalAssets = 0;
  let totalLiabilities = 0;

  for (const a of assets) {
    const def = assetClassDef(a.class);
    const hc = toHousehold(a, rateFor);
    if (def.isLiability) {
      totalLiabilities += hc;
    } else {
      totalAssets += hc;
      liqMap.set(def.liquidity, (liqMap.get(def.liquidity) ?? 0) + hc);
    }
    const arr = groupMap.get(a.class) ?? [];
    arr.push(a);
    groupMap.set(a.class, arr);
  }

  const groups: WealthClassGroup[] = ASSET_CLASSES
    .filter((def) => groupMap.has(def.id))
    .map((def) => {
      const list = (groupMap.get(def.id) ?? [])
        .slice()
        .sort((x, y) => toHousehold(y, rateFor) - toHousehold(x, rateFor));
      const subtotal = list.reduce((s, a) => s + toHousehold(a, rateFor), 0);
      return { def, assets: list, subtotalCents: def.isLiability ? -subtotal : subtotal };
    });

  const byLiquidity = (['high', 'medium', 'low', 'locked', 'varies'] as Liquidity[])
    .filter((l) => liqMap.has(l))
    .map((l) => ({ liquidity: l, label: LIQUIDITY_LABEL[l], cents: liqMap.get(l) ?? 0 }));

  return {
    householdCurrency,
    netWorthCents: totalAssets - totalLiabilities,
    totalAssetsCents: totalAssets,
    totalLiabilitiesCents: totalLiabilities,
    byLiquidity,
    groups,
  };
}

// ── Insurance mirror seam (funnel: Wealth → Household, down only) ─────
//
// When a property/asset is insured, its premium + renewal mirror DOWN to
// Household → Subscriptions as a read-only entry the family sees alongside
// their other recurring costs. Wealth stays the single source of truth;
// Household never writes back up (Non-Negotiable #8 / Concept Note §7).
//
// The Subscriptions schema already reserves the seam:
//   sourceModule: 'wealth'  +  linkedWealthAssetId: <assetId>
// Wiring the actual write goes through a server route so the first billing
// cycle is seeded and amount integrity holds — `/api/subscriptions/create`
// gains a `sourceModule`/`linkedWealthAssetId` passthrough in the
// insurance-mirror PR. This builder produces that payload from an asset so
// the two sides stay in lock-step.

export interface InsuranceMirrorPayload {
  name: string;                 // "Mbezi Beach House — insurance (Jubilee)"
  category: 'property_land';
  subCategory: string;          // "Property insurance"
  amountOriginalCents: number;  // premium
  currencyOriginal: string;
  frequency: 'annual';
  nextBillingDateIso: string;   // renewal date
  sourceModule: 'wealth';
  linkedWealthAssetId: string;
}

/** Build the Subscriptions payload for an insured asset, or null when the
 *  asset isn't insured / lacks the premium fields. Pure — no I/O. */
export function buildInsuranceMirror(asset: WealthAsset): InsuranceMirrorPayload | null {
  const ins = asset.insurance;
  if (!ins?.insured || !ins.premiumCents || !ins.renewalIso) return null;
  return {
    name: `${asset.name} — insurance${ins.provider ? ` (${ins.provider})` : ''}`,
    category: 'property_land',
    subCategory: 'Property insurance',
    amountOriginalCents: ins.premiumCents,
    currencyOriginal: ins.premiumCurrency ?? asset.currency,
    frequency: 'annual',
    nextBillingDateIso: ins.renewalIso,
    sourceModule: 'wealth',
    linkedWealthAssetId: asset.id,
  };
}
