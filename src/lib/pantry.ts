// The Pantry · Phase 1A data layer.
//
// Three top-level family collections:
//   families/{f}/staples       — recurring items (master list)
//   families/{f}/groceryLists  — active runs (one doc per week)
//   families/{f}/suppliers     — household vendors (Soko subset → Pantry,
//                                full set → The Roster directory later)
//
// `Supplier.categories` is an array — a single supplier record can be
// tagged 'soko', 'transport', 'security' etc. The Pantry queries with
// `array-contains 'soko'`; the future Roster queries everything.
// One source of truth, two views.
//
// All Phase 1A writes are client-side `setDoc`/`addDoc`/`updateDoc` —
// no Cloud Functions, no transactions (lists are owned by the family,
// low contention). `firestore.rules` enforces parent/helper write +
// kid read.

import {
  collection, doc, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, Timestamp, serverTimestamp,
  onSnapshot, writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

// ── Categories ───────────────────────────────────────────────────

/** Buckets the staples + budget surfaces use. Kept short on purpose. */
export type StapleCategory =
  | 'produce' | 'dairy' | 'pantry' | 'cleaning' | 'personal' | 'other';

export const STAPLE_CATEGORIES: { id: StapleCategory; emoji: string; label: string }[] = [
  { id: 'produce',  emoji: '🥬', label: 'Produce' },
  { id: 'dairy',    emoji: '🥛', label: 'Dairy' },
  { id: 'pantry',   emoji: '🍚', label: 'Pantry' },
  { id: 'cleaning', emoji: '🧴', label: 'Cleaning' },
  { id: 'personal', emoji: '🧴', label: 'Personal' },
  { id: 'other',    emoji: '✨', label: 'Other' },
];

// ── Units ─────────────────────────────────────────────────────────

/** Common units. We keep this short on purpose — covers ~95% of
 *  household items. The form has an "Other" escape hatch that opens a
 *  free-text input for anything not in the list. */
export const STAPLE_UNITS = [
  { id: 'kg',     label: 'kg' },
  { id: 'g',      label: 'g' },
  { id: 'L',      label: 'L' },
  { id: 'ml',     label: 'ml' },
  { id: 'x',      label: 'x (count)' },
  { id: 'pack',   label: 'pack' },
  { id: 'pkt',    label: 'packet' },
  { id: 'dozen',  label: 'dozen' },
  { id: 'bunch',  label: 'bunch' },
  { id: 'bag',    label: 'bag' },
  { id: 'bottle', label: 'bottle' },
  { id: 'can',    label: 'can' },
  { id: 'jar',    label: 'jar' },
  { id: 'tin',    label: 'tin' },
  { id: 'bar',    label: 'bar' },
  { id: 'roll',   label: 'roll' },
  { id: 'box',    label: 'box' },
] as const;

// ── Recurrence cadence ───────────────────────────────────────────

/** Recurrence cadence — used to decide which staples auto-flow into
 *  next week's list (Phase 1B will run the auto-populate; Phase 1A
 *  treats every staple as "available to add to this week".) */
export type Cadence = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'as-needed';

// ── Supplier (shared with future Roster) ──────────────────────────

/** Tag space for a supplier. Add to this list as new vertical
 *  directories ship (transport, security, maids, events, utility…). */
export type SupplierCategory =
  | 'soko'        // food & household groceries — Pantry's view
  | 'transport'
  | 'security'
  | 'maids'
  | 'utility'
  | 'events'
  | 'other';

export interface Supplier {
  id: string;
  /** Business name — what shows on cards. */
  name: string;
  /** Optional contact person. */
  contactName?: string;
  /** Phone number used for WhatsApp deep links AND tel: links. */
  phone?: string;
  /** When `phone` is set, whether the supplier is reachable on WhatsApp. */
  whatsappEnabled?: boolean;
  /** Free-text notes the parent jots down. */
  notes?: string;
  /** Categories — drives which directory views show this supplier.
   *  Pantry queries `array-contains 'soko'`. */
  categories: SupplierCategory[];
  /** Fine-grained service type for the Directory — one of the
   *  DirectoryCategory ids in `lib/directory.ts` (e.g. 'plumber',
   *  'pharmacy', 'mama wa kazi'). Optional: legacy Soko suppliers
   *  won't have it; the Directory buckets those under "Uncategorised"
   *  until a parent tags them. */
  directoryCategory?: string;
  /** Optional email — captured by the contact importer when present. */
  email?: string;
  /** Last time we sent them an order (or chatted). Updated on send. */
  lastContactedAt?: Timestamp;
  createdAt: Timestamp;
  createdBy: string;
}

// ── Staple (master list item) ────────────────────────────────────

export interface Staple {
  id: string;
  name: string;
  category: StapleCategory;
  /** Default quantity per cycle (e.g. 2). */
  defaultQty: number;
  /** Unit string (e.g. 'kg', 'L', 'x') — kept simple in Phase 1A. */
  unit: string;
  cadence: Cadence;
  /** Last bought price in cents of the family's display currency. */
  lastBoughtCents?: number;
  /** Timestamp of the last reconciled Purchase that included this staple.
   *  Powers the Pantry "Last bought Nd ago" stamp + the Wink chip
   *  ((now − lastBoughtAt) > cadenceDays(cadence)). */
  lastBoughtAt?: Timestamp;
  /** Catalogue lifecycle:
   *    active           — normal, reusable item (default for existing rows)
   *    pending_promote  — quick-added by a helper at the shop; greyed
   *                       everywhere until a parent promotes it in
   *                       Settings → Catalogue. */
  status?: 'active' | 'pending_promote';
  /** Which Household module this staple belongs to. Default 'pantry'
   *  for any staple that doesn't set it (so existing data behaves as
   *  before). Module-tagged staples surface in their module's picker
   *  (Outdoor for garden/pool/kuku/pets, Drivers for fuel/parts/etc.)
   *  and are hidden from the others. Utility + Payroll don't usually
   *  use Staple-shaped catalogue data — they read from their own
   *  collections — but the field accepts those values for forward
   *  compatibility. */
  module?: 'pantry' | 'outdoor' | 'drivers' | 'utility' | 'payroll';
  /** Optional supplier this staple usually comes from — drives the
   *  "group by supplier" UX on the active list. */
  preferredSupplierId?: string;
  /** Up to 3 preferred brands in order of preference (1st = most
   *  preferred). Surfaces on the active list rows AND in the WhatsApp
   *  message we send to the supplier so they know what to grab. */
  preferredBrands?: string[];
  notes?: string;
  /** False to keep the staple in the master list but skip it in the
   *  Phase 1B auto-populate. Phase 1A treats it as advisory only. */
  active: boolean;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/** Maximum brand-preference slots we render on the staple form. */
export const MAX_PREFERRED_BRANDS = 3;

// ── Utilities (recurring bills + helper salaries) ────────────────

/** Buckets the Utilities surface uses — recurring household billings
 *  plus helper salaries. Kept short, mirrors STAPLE_CATEGORIES. */
export type UtilityCategory =
  | 'power' | 'water' | 'internet' | 'tv' | 'security'
  | 'gas' | 'rent' | 'salary' | 'other';

export const UTILITY_CATEGORIES: { id: UtilityCategory; emoji: string; label: string }[] = [
  { id: 'power',    emoji: '⚡',  label: 'Power' },
  { id: 'water',    emoji: '💧',  label: 'Water' },
  { id: 'internet', emoji: '🌐',  label: 'Internet' },
  { id: 'tv',       emoji: '📺',  label: 'TV' },
  { id: 'security', emoji: '🛡️',  label: 'Security' },
  { id: 'gas',      emoji: '🔥',  label: 'Gas' },
  { id: 'rent',     emoji: '🏠',  label: 'Rent' },
  { id: 'salary',   emoji: '👤',  label: 'Salary' },
  { id: 'other',    emoji: '✨',  label: 'Other' },
];

// ── Utility starter packs (one-tap seed, no amounts) ────────────
// Mirrors the Directory's STARTER_PACKS — a one-tap seed of typical
// household bills, scaled to household size. Amounts are left at 0 so
// the parent fills in real figures after the seed; what we contribute
// is the rows + categories + sensible cadences so the page isn't
// empty on day one. The seed-wizard packs below cover the "I want to
// estimate amounts too" path.
//
// ⚠ STABILITY CONTRACT — do not remove or rename a pack id without
// updating both `UtilityStarterPackId` and `REQUIRED_STARTER_PACK_IDS`
// below. The satisfies-block locks the three packs in place so the
// build fails the moment one goes missing — the Utilities page would
// otherwise quietly drop a household-size option and look "empty"
// again. New packs are welcome: add a literal to `UtilityStarterPackId`
// and the array, the type-check threads it through.

export interface UtilityStarterItem {
  /** Display name shown on the row, e.g. "Power · TANESCO". */
  name: string;
  category: UtilityCategory;
  cadence: Cadence;
}

/** The three pack ids the empty-state UI relies on. Adding a new size
 *  here is fine; removing one will fail the build via the
 *  satisfies-block below. */
export type UtilityStarterPackId = 'solo' | 'family' | 'big';

export interface UtilityStarterPack {
  id: UtilityStarterPackId;
  emoji: string;
  label: string;
  sizeRange: string;
  description: string;
  /** Must be non-empty — asserted at module load (see the guard
   *  block at the bottom of this section). An empty pack would
   *  render an unclickable card, so we'd rather fail loudly. */
  items: UtilityStarterItem[];
}

// East-Africa-leaning provider hints (TANESCO / DAWASCO / DStv) since
// the default audience runs on TZS. Generic enough to edit in seconds
// for other markets — every row's name is editable post-seed.
//
// The `as const` is narrowed to just `id` (not the whole array) so
// the guard at the bottom can detect a missing pack via literal-id
// inference, while `items.length` etc. stay typed as `number` for
// downstream consumers. `satisfies` type-checks each entry against
// `UtilityStarterPack` without widening the inferred id union.
export const UTILITY_STARTER_PACKS = [
  {
    id: 'solo' as const,
    emoji: '👤',
    label: 'Small household',
    sizeRange: '1–2 people',
    description: 'Single, couple, or small flat. Just the essentials — power, water, internet.',
    items: [
      { name: 'Power · TANESCO',     category: 'power',    cadence: 'monthly' },
      { name: 'Water · DAWASCO',     category: 'water',    cadence: 'monthly' },
      { name: 'Internet · home Wi-Fi', category: 'internet', cadence: 'monthly' },
    ] as UtilityStarterItem[],
  },
  {
    id: 'family' as const,
    emoji: '👨‍👩‍👧',
    label: 'Family',
    sizeRange: '3–4 people',
    description: 'Two adults plus 1–2 kids. Adds TV, gas refill and one helper salary.',
    items: [
      { name: 'Power · TANESCO',     category: 'power',    cadence: 'monthly' },
      { name: 'Water · DAWASCO',     category: 'water',    cadence: 'monthly' },
      { name: 'Internet · home Wi-Fi', category: 'internet', cadence: 'monthly' },
      { name: 'TV · DStv / Azam',    category: 'tv',       cadence: 'monthly' },
      { name: 'Gas refill · LPG',    category: 'gas',      cadence: 'as-needed' },
      { name: 'House helper · salary', category: 'salary', cadence: 'monthly' },
    ] as UtilityStarterItem[],
  },
  {
    id: 'big' as const,
    emoji: '👨‍👩‍👧‍👦',
    label: 'Big household',
    sizeRange: '5+ people',
    description: 'Larger family or extended household. Adds security, rent, and extra helper salaries.',
    items: [
      { name: 'Power · TANESCO',     category: 'power',    cadence: 'monthly' },
      { name: 'Water · DAWASCO',     category: 'water',    cadence: 'monthly' },
      { name: 'Internet · home Wi-Fi', category: 'internet', cadence: 'monthly' },
      { name: 'TV · DStv / Azam',    category: 'tv',       cadence: 'monthly' },
      { name: 'Security · estate guard', category: 'security', cadence: 'monthly' },
      { name: 'Gas refill · LPG',    category: 'gas',      cadence: 'as-needed' },
      { name: 'Rent',                category: 'rent',     cadence: 'monthly' },
      { name: 'House helper · salary', category: 'salary', cadence: 'monthly' },
      { name: 'Driver · salary',     category: 'salary',   cadence: 'monthly' },
      { name: 'Gardener · salary',   category: 'salary',   cadence: 'monthly' },
    ] as UtilityStarterItem[],
  },
] satisfies readonly UtilityStarterPack[];

// ── Build-time + load-time guard: lock the starter pack contract ──
// Two layers protect "which household sizes the empty state promises":
//   1. Compile-time: every id in `REQUIRED_STARTER_PACK_IDS` must
//      appear in `UTILITY_STARTER_PACKS`. The literal-id inference
//      from the `as const` on each pack's `id` keeps the union
//      narrow; remove a pack and `_MissingStarterIds` becomes a
//      non-`never` literal, which fails the `extends never` ternary
//      and breaks `npm run build` right here.
//   2. Load-time: each pack must seed at least one bill. Empty
//      `items: []` would render an unclickable card. We throw early
//      so a regression surfaces on the very first render, not as a
//      silent visual bug.
const REQUIRED_STARTER_PACK_IDS = ['solo', 'family', 'big'] as const;
type _PresentStarterIds = (typeof UTILITY_STARTER_PACKS)[number]['id'];
type _MissingStarterIds = Exclude<(typeof REQUIRED_STARTER_PACK_IDS)[number], _PresentStarterIds>;
const _NO_STARTER_PACKS_MISSING: _MissingStarterIds extends never ? true : never = true;
void _NO_STARTER_PACKS_MISSING;

for (const pack of UTILITY_STARTER_PACKS) {
  if (pack.items.length === 0) {
    throw new Error(
      `UTILITY_STARTER_PACKS[${pack.id}] has no items — packs must seed at least one bill.`,
    );
  }
}

// ── Utility seed-wizard packs (USD-based, customize amounts) ────
// Surfaced by the "Set up Utilities" wizard. Each item carries a
// baseline USD amount that gets converted to the family's display
// currency via live FX so the seeded figure lands in the right
// ballpark for any locale. Parent tweaks amounts on the final
// screen of the wizard before committing.
export type UtilityPackId = 'small' | 'family' | 'big';

export interface UtilityPackItem {
  name: string;
  category: UtilityCategory;
  /** Baseline monthly cost in USD. Multiplied by the family's live
   *  USD → family-currency FX rate so the seeded figure lands in the
   *  right ballpark for any locale. */
  usdBase: number;
}

export interface UtilityPack {
  id: UtilityPackId;
  emoji: string;
  label: string;
  sizeRange: string;
  description: string;
  items: UtilityPackItem[];
}

export const UTILITY_PACKS: UtilityPack[] = [
  {
    id: 'small',
    emoji: '👤',
    label: 'Small household',
    sizeRange: '1–2 people',
    description: 'Single, couple, or small flat. Essentials only — power, water, internet, gas.',
    items: [
      { name: 'Power',    category: 'power',    usdBase: 20 },
      { name: 'Water',    category: 'water',    usdBase: 8  },
      { name: 'Internet', category: 'internet', usdBase: 25 },
      { name: 'Gas',      category: 'gas',      usdBase: 15 },
    ],
  },
  {
    id: 'family',
    emoji: '👨‍👩‍👧',
    label: 'Family',
    sizeRange: '3–4 people',
    description: 'Two adults plus 1–2 kids. Adds TV and security to the standard bills.',
    items: [
      { name: 'Power',    category: 'power',    usdBase: 40 },
      { name: 'Water',    category: 'water',    usdBase: 16 },
      { name: 'Internet', category: 'internet', usdBase: 30 },
      { name: 'TV',       category: 'tv',       usdBase: 20 },
      { name: 'Security', category: 'security', usdBase: 15 },
      { name: 'Gas',      category: 'gas',      usdBase: 20 },
    ],
  },
  {
    id: 'big',
    emoji: '👨‍👩‍👧‍👦',
    label: 'Big household',
    sizeRange: '5+ people',
    description: 'Larger or extended family. Bigger totals and adds rent as a recurring line.',
    items: [
      { name: 'Power',    category: 'power',    usdBase: 80 },
      { name: 'Water',    category: 'water',    usdBase: 32 },
      { name: 'Internet', category: 'internet', usdBase: 40 },
      { name: 'TV',       category: 'tv',       usdBase: 25 },
      { name: 'Security', category: 'security', usdBase: 25 },
      { name: 'Gas',      category: 'gas',      usdBase: 30 },
      { name: 'Rent',     category: 'rent',     usdBase: 400 },
    ],
  },
];

/** Baseline default helper salary in USD. Drives the pre-fill for each
 *  new helper salary input in the seed wizard. */
export const DEFAULT_HELPER_SALARY_USD = 100;

/** A recurring household bill or a helper's salary. Lives in
 *  families/{f}/utilities. Designed to roll up — alongside staples —
 *  into the unified Budget surface. Empty optional fields are stored
 *  as 0 / '' rather than undefined so client writes never trip the
 *  Firestore "unsupported value: undefined" guard. */
export interface Utility {
  id: string;
  /** Label — "Power (TANESCO)", "Mama Asha — house help". */
  name: string;
  category: UtilityCategory;
  /** Recurring amount in cents of the family's display currency.
   *  0 when the parent hasn't filled in a figure yet. */
  amountCents: number;
  /** Billing cadence — shared with staples so the Budget roll-up
   *  speaks one language. Most utilities are 'monthly'. */
  cadence: Cadence;
  /** Day of the month the bill is usually due (1–31). 0 = not set. */
  dueDay: number;
  /** Account / meter / reference number printed on the bill. */
  accountRef: string;
  /** Supplier this bill is paid to — links to the shared suppliers
   *  collection. '' when none (e.g. a salary row). */
  preferredSupplierId: string;
  notes: string;
  /** False keeps the row but drops it from the Budget roll-up. */
  active: boolean;
  // ── Denormalised payment status ────────────────────────────────
  // Mirrors the most recent payment so each utility row can render
  // its status pill ("Paid · May" / "Overdue 3d") from a single doc
  // read. The full ledger lives in the `payments` sub-collection.
  /** Doc id of the payment row reflected in the fields below. Lets
   *  "mark paid" twice in the same period update one record rather
   *  than stacking duplicates. */
  lastPaymentId?: string;
  /** YYYY-MM bucket the most recent payment satisfied. */
  lastPaymentPeriodKey?: string;
  /** Amount of the most recent payment, in cents. */
  lastPaymentCents?: number;
  /** When the most recent payment was made. */
  lastPaymentAt?: Timestamp;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

/** A single payment against a utility — captures what the family
 *  actually paid (which may differ from the recurring `amountCents`)
 *  and when. Stored as a sub-collection so the ledger keeps full
 *  history; the parent doc carries a denormalised pointer to the
 *  most recent entry for fast row rendering. */
export interface Payment {
  id: string;
  /** Cents in the family's display currency. */
  amountCents: number;
  /** When the payment was made (parent-picked; defaults to today). */
  paidAt: Timestamp;
  /** uid of the parent / helper who marked it paid. */
  paidBy: string;
  /** YYYY-MM bucket this payment satisfies. Derived from `paidAt` at
   *  write time; lets the row look up "paid this month?" cheaply. */
  periodKey: string;
  /** Receipt / transaction reference — '' when none. */
  reference: string;
  notes: string;
  createdAt: Timestamp;
}

// ── Grocery list (a "run") ───────────────────────────────────────

export interface GroceryListItem {
  /** Stable id within the list. We assign with `crypto.randomUUID()`
   *  on the client so the same item id can move across lists later. */
  id: string;
  name: string;
  category?: StapleCategory;
  qty: number;
  unit: string;
  /** Estimated cost in cents at *plan* time — copied from the staple's
   *  last-bought price when the list is generated; the parent can edit
   *  inline. The eventual "spent" field comes when the list closes. */
  estimatedCents?: number;
  supplierId?: string;
  /** Snapshot of the staple's preferred brands at list-creation time.
   *  Display + WhatsApp formatter use this directly so the parent's
   *  current Staple doc isn't read on every render. */
  preferredBrands?: string[];
  /** Has someone already picked it up? Drives the line-through. */
  done: boolean;
  /** Source staple id when the row originated from the master list.
   *  Lets us update the staple's lastBoughtCents when the list closes. */
  stapleId?: string;
}

export interface GroceryList {
  id: string;
  /** Human-readable label, e.g. "Week of May 12". */
  name: string;
  /** ISO date the list is for (Monday of the week, by convention). */
  weekOf: string;
  /** Open list (in progress) vs closed (history). Phase 1A only writes 'active'. */
  status: 'active' | 'closed' | 'archived';
  items: GroceryListItem[];
  /** Cents estimated total at plan time — derived but stored so the
   *  Home dashboard can show it without summing the array. */
  estimatedTotalCents: number;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  createdBy: string;
  closedAt?: Timestamp;
}

// ── Path helpers ──────────────────────────────────────────────────

const stapleCol = (familyId: string) =>
  collection(db, 'families', familyId, 'staples');

const supplierCol = (familyId: string) =>
  collection(db, 'families', familyId, 'suppliers');

const listCol = (familyId: string) =>
  collection(db, 'families', familyId, 'groceryLists');

const utilityCol = (familyId: string) =>
  collection(db, 'families', familyId, 'utilities');

const paymentCol = (familyId: string, utilityId: string) =>
  collection(db, 'families', familyId, 'utilities', utilityId, 'payments');

// ── Staples ──────────────────────────────────────────────────────

export function subscribeToStaples(
  familyId: string,
  cb: (staples: Staple[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(stapleCol(familyId), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Staple)));
  });
}

export async function addStaple(
  familyId: string,
  data: Omit<Staple, 'id' | 'createdAt' | 'active'> & { active?: boolean },
): Promise<string> {
  if (isGuestActive()) return 'guest-staple';
  const ref = await addDoc(stapleCol(familyId), {
    ...data,
    active: data.active ?? true,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateStaple(
  familyId: string,
  stapleId: string,
  patch: Partial<Staple>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(stapleCol(familyId), stapleId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteStaple(familyId: string, stapleId: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(stapleCol(familyId), stapleId));
}

// ── Utilities ────────────────────────────────────────────────────

export function subscribeToUtilities(
  familyId: string,
  cb: (utilities: Utility[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    utilityCol(familyId),
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Utility)));
    },
    // Permission blip / missing index → render empty rather than hang.
    () => cb([]),
  );
}

export async function addUtility(
  familyId: string,
  data: Omit<Utility, 'id' | 'createdAt' | 'active'> & { active?: boolean },
): Promise<string> {
  if (isGuestActive()) return 'guest-utility';
  const ref = await addDoc(utilityCol(familyId), {
    ...data,
    active: data.active ?? true,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateUtility(
  familyId: string,
  utilityId: string,
  patch: Partial<Utility>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(utilityCol(familyId), utilityId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteUtility(familyId: string, utilityId: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(utilityCol(familyId), utilityId));
}

/** Normalise any cadence to a per-month figure so bills on different
 *  cycles can be summed into one Budget number. 'as-needed' rows are
 *  unpredictable, so they contribute 0. */
export function monthlyEquivalentCents(amountCents: number, cadence: Cadence): number {
  switch (cadence) {
    case 'daily':     return Math.round((amountCents * 365) / 12);
    case 'weekly':    return Math.round((amountCents * 52) / 12);
    case 'biweekly':  return Math.round((amountCents * 104) / 12); // 'biweekly' = 2×/week here
    case 'monthly':   return amountCents;
    case 'as-needed': return 0;
    default:          return amountCents;
  }
}

/** Total monthly spend across all active utilities. Feeds the Budget
 *  roll-up and the Pantry Home "Utilities" card. */
export function sumMonthlyUtilities(utilities: Utility[]): number {
  return utilities
    .filter((u) => u.active)
    .reduce((sum, u) => sum + monthlyEquivalentCents(u.amountCents || 0, u.cadence), 0);
}

/** Total of payments captured for the current month, plus the count
 *  of utilities marked paid. Read from the denormalised lastPayment*
 *  fields on the utility doc so we don't need to subscribe to every
 *  payment sub-collection just to render the roll-up. */
export function sumPaidThisPeriod(
  utilities: Utility[],
  now: Date = new Date(),
): { paidCents: number; paidCount: number } {
  const key = currentPeriodKey(now);
  let paidCents = 0;
  let paidCount = 0;
  for (const u of utilities) {
    if (u.active && u.lastPaymentPeriodKey === key) {
      paidCents += u.lastPaymentCents || 0;
      paidCount += 1;
    }
  }
  return { paidCents, paidCount };
}

// ── Seed wizard + payments ───────────────────────────────────────

/** Convert a USD baseline to cents in the family's display currency.
 *  Falls back to 1:1 when the FX rate hasn't loaded yet — better to
 *  seed *something* the parent can edit than to block the kick-start
 *  on a network round-trip. */
function usdBaseToFamilyCents(usdBase: number, fxUsdToFamily: number): number {
  const rate = Number.isFinite(fxUsdToFamily) && fxUsdToFamily > 0 ? fxUsdToFamily : 1;
  return Math.round(usdBase * rate * 100);
}

/** Batch-seed bills from a pack and helper salary rows in a single
 *  write. Each helper carries its own pre-filled amount captured by
 *  the seed wizard. Names already present in `existing` are skipped
 *  so a re-tap doesn't duplicate. */
export async function seedFromWizard(
  familyId: string,
  existing: Utility[],
  args: {
    pack: UtilityPack | null;
    fxUsdToFamily: number;
    helperSalariesCents: number[];
  },
): Promise<{ billsAdded: number; salariesAdded: number }> {
  if (isGuestActive()) return { billsAdded: 0, salariesAdded: 0 };
  const haveByName = new Set(existing.map((u) => u.name.trim().toLowerCase()));
  const batch = writeBatch(db);
  let billsAdded = 0;
  let salariesAdded = 0;
  const blank = {
    cadence: 'monthly' as Cadence,
    dueDay: 0,
    accountRef: '',
    preferredSupplierId: '',
    notes: '',
    active: true,
  };

  if (args.pack) {
    for (const item of args.pack.items) {
      if (haveByName.has(item.name.toLowerCase())) continue;
      const ref = doc(utilityCol(familyId));
      batch.set(ref, {
        ...blank,
        name: item.name,
        category: item.category,
        amountCents: usdBaseToFamilyCents(item.usdBase, args.fxUsdToFamily),
        createdAt: serverTimestamp(),
      });
      haveByName.add(item.name.toLowerCase());
      billsAdded++;
    }
  }

  const n = args.helperSalariesCents.length;
  for (let i = 0; i < n; i++) {
    const name = n === 1 ? 'Helper — salary' : `Helper ${i + 1} — salary`;
    if (haveByName.has(name.toLowerCase())) continue;
    const ref = doc(utilityCol(familyId));
    batch.set(ref, {
      ...blank,
      name,
      category: 'salary' as UtilityCategory,
      amountCents: Math.max(0, Math.round(args.helperSalariesCents[i] || 0)),
      createdAt: serverTimestamp(),
    });
    haveByName.add(name.toLowerCase());
    salariesAdded++;
  }

  if (billsAdded + salariesAdded > 0) await batch.commit();
  return { billsAdded, salariesAdded };
}

export function subscribeToPayments(
  familyId: string,
  utilityId: string,
  cb: (payments: Payment[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    paymentCol(familyId, utilityId),
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Payment)));
    },
    () => cb([]),
  );
}

/** Record (or overwrite) the payment for the period implied by
 *  `data.periodKey`. If a payment already exists for that period on
 *  this utility, update it in place rather than stacking — the
 *  caller passes the current utility doc so we can spot the case
 *  without an extra read. Both the payment doc and the denormalised
 *  last-payment fields on the parent utility are written in one
 *  batch so the row's status pill flips atomically. */
export async function recordPayment(
  familyId: string,
  utility: Utility,
  data: Omit<Payment, 'id' | 'createdAt'>,
): Promise<string> {
  if (isGuestActive()) return 'guest-payment';
  const batch = writeBatch(db);
  let paymentId: string;
  if (utility.lastPaymentId && utility.lastPaymentPeriodKey === data.periodKey) {
    paymentId = utility.lastPaymentId;
    batch.update(doc(paymentCol(familyId, utility.id), paymentId), {
      amountCents: data.amountCents,
      paidAt: data.paidAt,
      paidBy: data.paidBy,
      reference: data.reference,
      notes: data.notes,
    });
  } else {
    const ref = doc(paymentCol(familyId, utility.id));
    paymentId = ref.id;
    batch.set(ref, { ...data, createdAt: serverTimestamp() });
  }
  batch.update(doc(utilityCol(familyId), utility.id), {
    lastPaymentId: paymentId,
    lastPaymentPeriodKey: data.periodKey,
    lastPaymentCents: data.amountCents,
    lastPaymentAt: data.paidAt,
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  return paymentId;
}

// ── Period + status helpers ──────────────────────────────────────

/** YYYY-MM bucket for the supplied date. */
export function currentPeriodKey(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "May 2026" label for a YYYY-MM key. */
export function periodLabel(periodKey: string): string {
  const [y, m] = periodKey.split('-').map(Number);
  if (!y || !m) return periodKey;
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/** Status of a utility for THIS calendar month — drives the row's
 *  visual pill (paid / due-soon / overdue / unpaid). */
export type UtilityStatus =
  | { kind: 'paid'; periodKey: string; amountCents: number }
  | { kind: 'due-soon'; daysUntil: number; dueDay: number }
  | { kind: 'overdue'; daysOverdue: number; dueDay: number }
  | { kind: 'unpaid' };

export function paymentStatus(utility: Utility, now: Date = new Date()): UtilityStatus {
  const key = currentPeriodKey(now);
  if (utility.lastPaymentPeriodKey === key) {
    return { kind: 'paid', periodKey: key, amountCents: utility.lastPaymentCents || 0 };
  }
  // Without a due-day the only thing we know is "not paid yet this
  // month" — keep the pill quiet rather than guessing a date.
  if (utility.active && utility.dueDay && utility.dueDay > 0) {
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const effectiveDue = Math.min(utility.dueDay, lastDay);
    const diff = effectiveDue - now.getDate();
    if (diff < 0) return { kind: 'overdue', daysOverdue: -diff, dueDay: utility.dueDay };
    if (diff <= 5) return { kind: 'due-soon', daysUntil: diff, dueDay: utility.dueDay };
  }
  return { kind: 'unpaid' };
}

// ── Suppliers ────────────────────────────────────────────────────

/** Subscribe to suppliers, optionally filtered by category. The Pantry
 *  view passes 'soko' so non-grocery vendors don't pollute the list. */
export function subscribeToSuppliers(
  familyId: string,
  filter: SupplierCategory | 'all',
  cb: (suppliers: Supplier[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  // Firestore can't sort+filter on `array-contains` without a composite
  // index, so we filter in-memory for simplicity. The supplier list is
  // small per family — typically <30 entries.
  return onSnapshot(supplierCol(familyId), (snap) => {
    const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Supplier));
    cb(filter === 'all' ? all : all.filter((s) => s.categories?.includes(filter)));
  });
}

export async function addSupplier(
  familyId: string,
  data: Omit<Supplier, 'id' | 'createdAt'>,
): Promise<string> {
  if (isGuestActive()) return 'guest-supplier';
  const ref = await addDoc(supplierCol(familyId), {
    ...data,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateSupplier(
  familyId: string,
  supplierId: string,
  patch: Partial<Supplier>,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(supplierCol(familyId), supplierId), patch as any);
}

export async function deleteSupplier(familyId: string, supplierId: string): Promise<void> {
  if (isGuestActive()) return;
  await deleteDoc(doc(supplierCol(familyId), supplierId));
}

/** Stamp the supplier's `lastContactedAt` after a successful WhatsApp send. */
export async function markSupplierContacted(
  familyId: string,
  supplierId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(supplierCol(familyId), supplierId), {
    lastContactedAt: serverTimestamp(),
  });
}

// ── Grocery lists ────────────────────────────────────────────────

export function subscribeToActiveLists(
  familyId: string,
  cb: (lists: GroceryList[]) => void,
  max = 10,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  // We pull the whole collection and filter in-memory rather than using a
  // composite index. With one list per week, the doc count grows slowly
  // (~52 a year) so a tiny in-memory sort is far cheaper than asking the
  // family to deploy an index before the Pantry Home renders.
  return onSnapshot(
    listCol(familyId),
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GroceryList));
      const active = all
        .filter((l) => l.status === 'active')
        .sort((a, b) => (b.weekOf || '').localeCompare(a.weekOf || ''))
        .slice(0, max);
      cb(active);
    },
    () => {
      // Permission errors / network blips → render empty so the page
      // doesn't sit on "Loading…" forever.
      cb([]);
    },
  );
}

export function subscribeToList(
  familyId: string,
  listId: string,
  cb: (list: GroceryList | null) => void,
): () => void {
  if (isGuestActive()) {
    cb(null);
    return () => {};
  }
  return onSnapshot(doc(listCol(familyId), listId), (snap) => {
    cb(snap.exists() ? ({ id: snap.id, ...snap.data() } as GroceryList) : null);
  });
}

/** Empty list. Caller adds items via `setListItems`. */
export async function createList(
  familyId: string,
  data: { name: string; weekOf: string; items?: GroceryListItem[] },
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-list';
  const items = data.items || [];
  const estimatedTotalCents = items.reduce((sum, i) => sum + (i.estimatedCents || 0), 0);
  const ref = await addDoc(listCol(familyId), {
    name: data.name,
    weekOf: data.weekOf,
    status: 'active' as const,
    items,
    estimatedTotalCents,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Generate a fresh list seeded from the family's active staples. Each
 *  staple becomes one row using its default qty, last-bought price and
 *  preferred supplier. Phase 1B will use this on the Sunday cron. */
export async function createListFromStaples(
  familyId: string,
  staples: Staple[],
  createdBy: string,
  weekOf: string,
  name: string,
): Promise<string> {
  const items: GroceryListItem[] = staples
    .filter((s) => s.active)
    .map((s) => ({
      id: cryptoId(),
      name: s.name,
      category: s.category,
      qty: s.defaultQty,
      unit: s.unit,
      estimatedCents: s.lastBoughtCents,
      supplierId: s.preferredSupplierId,
      preferredBrands: s.preferredBrands && s.preferredBrands.length > 0 ? [...s.preferredBrands] : undefined,
      done: false,
      stapleId: s.id,
    }));
  if (isGuestActive()) return 'guest-list';
  const ref = await addDoc(listCol(familyId), {
    name,
    weekOf,
    status: 'active' as const,
    items,
    estimatedTotalCents: sumEstimated(items),
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Replace the items array on a list. Recomputes the cached total. */
export async function setListItems(
  familyId: string,
  listId: string,
  items: GroceryListItem[],
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(listCol(familyId), listId), {
    items,
    estimatedTotalCents: sumEstimated(items),
    updatedAt: serverTimestamp(),
  });
}

export async function closeList(familyId: string, listId: string): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(listCol(familyId), listId), {
    status: 'closed',
    closedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

// ── List item ops (helpers callers can compose) ──────────────────

export function upsertItem(
  items: GroceryListItem[],
  patch: Partial<GroceryListItem> & { id: string },
): GroceryListItem[] {
  const idx = items.findIndex((i) => i.id === patch.id);
  if (idx === -1) {
    // New row — fill in safe defaults if absent.
    return [
      ...items,
      {
        name: '', qty: 1, unit: '', done: false,
        ...patch,
      } as GroceryListItem,
    ];
  }
  return items.map((i) => (i.id === patch.id ? { ...i, ...patch } : i));
}

export function removeItem(
  items: GroceryListItem[],
  itemId: string,
): GroceryListItem[] {
  return items.filter((i) => i.id !== itemId);
}

export function toggleItemDone(
  items: GroceryListItem[],
  itemId: string,
): GroceryListItem[] {
  return items.map((i) => (i.id === itemId ? { ...i, done: !i.done } : i));
}

// ── Group items by supplier (for the Active list view) ───────────

export interface SupplierGroup {
  supplierId: string | null;   // null = "Unassigned"
  supplier?: Supplier;
  items: GroceryListItem[];
  estimatedCents: number;
}

export function groupBySupplier(
  items: GroceryListItem[],
  suppliers: Supplier[],
): SupplierGroup[] {
  const map = new Map<string | null, SupplierGroup>();
  for (const it of items) {
    const key = it.supplierId || null;
    let group = map.get(key);
    if (!group) {
      const supplier = key ? suppliers.find((s) => s.id === key) : undefined;
      group = { supplierId: key, supplier, items: [], estimatedCents: 0 };
      map.set(key, group);
    }
    group.items.push(it);
    group.estimatedCents += it.estimatedCents || 0;
  }
  // Sort: known suppliers first (alphabetical by name), Unassigned last.
  const out = Array.from(map.values());
  out.sort((a, b) => {
    if (a.supplierId === null) return 1;
    if (b.supplierId === null) return -1;
    return (a.supplier?.name || '').localeCompare(b.supplier?.name || '');
  });
  return out;
}

// ── WhatsApp / phone helpers ─────────────────────────────────────

/** Compose a friendly, scannable message for a supplier's list group.
 *  Brand preferences are appended in parens — "Rice (Pishori or Daawat)
 *  — 2kg" — so the supplier knows what to grab if they have options. */
export function formatListForWhatsApp(
  supplierName: string,
  items: GroceryListItem[],
  opts?: { greeting?: string; signoff?: string },
): string {
  const greeting = opts?.greeting ?? `Hi ${supplierName},`;
  const lines = items
    .filter((i) => !i.done)
    .map((i) => {
      const qty = i.qty > 1 || i.unit ? `${i.qty}${i.unit ? ' ' + i.unit : ''}` : '';
      const brands = i.preferredBrands && i.preferredBrands.length > 0
        ? ` (${i.preferredBrands.join(' or ')})`
        : '';
      return `• ${i.name}${brands}${qty ? ` — ${qty}` : ''}`;
    });
  const signoff = opts?.signoff ?? 'Asante! 🙏';
  return `${greeting}\n\nHere's our list:\n${lines.join('\n')}\n\n${signoff}`;
}

/** Build a `https://wa.me/<phone>?text=…` deep link. Strips non-digits
 *  from the phone, URL-encodes the message. Returns null when phone is
 *  missing — callers should hide the WhatsApp button. */
export function whatsappLink(phone: string | undefined, message: string): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.length < 6) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

// ── Internal ─────────────────────────────────────────────────────

function sumEstimated(items: GroceryListItem[]): number {
  return items.reduce((s, i) => s + (i.estimatedCents || 0), 0);
}

/** Safe random id. Uses `crypto.randomUUID` when available, falls back
 *  to a Math.random base-36 token. Only used to give list rows a stable
 *  client-side id since they live in an array. */
function cryptoId(): string {
  if (typeof crypto !== 'undefined' && (crypto as any).randomUUID) {
    return (crypto as any).randomUUID();
  }
  return `i_${Math.random().toString(36).slice(2, 12)}`;
}

export { cryptoId };

// ── Date helpers ─────────────────────────────────────────────────

/** "Week of Mon May 12" date string used to label a fresh list. */
export function thisWeekKey(d = new Date()): string {
  // Monday of the current ISO week, in local time.
  const day = d.getDay() === 0 ? 7 : d.getDay(); // Sun=7
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

export function thisWeekLabel(d = new Date()): string {
  const monday = thisWeekKey(d);
  const date = new Date(monday + 'T00:00:00');
  return `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}
