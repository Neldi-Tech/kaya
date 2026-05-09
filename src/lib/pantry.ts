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
  onSnapshot,
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

// ── Meal plan (Phase 1B) ─────────────────────────────────────────

export type MealDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type MealSlot = 'breakfast' | 'lunch' | 'dinner';

export const MEAL_DAYS: { id: MealDay; short: string; full: string }[] = [
  { id: 'mon', short: 'Mon', full: 'Monday' },
  { id: 'tue', short: 'Tue', full: 'Tuesday' },
  { id: 'wed', short: 'Wed', full: 'Wednesday' },
  { id: 'thu', short: 'Thu', full: 'Thursday' },
  { id: 'fri', short: 'Fri', full: 'Friday' },
  { id: 'sat', short: 'Sat', full: 'Saturday' },
  { id: 'sun', short: 'Sun', full: 'Sunday' },
];

export const MEAL_SLOTS: { id: MealSlot; label: string; emoji: string }[] = [
  { id: 'breakfast', label: 'Breakfast', emoji: '🥣' },
  { id: 'lunch',     label: 'Lunch',     emoji: '🍱' },
  { id: 'dinner',    label: 'Dinner',    emoji: '🍝' },
];

export interface MealEntry {
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  /** When true, the family is eating out that day; `eatingOutNote` can
   *  carry "Pizza place" / "with grandma" / etc. The `dinner` slot is
   *  treated as the eating-out meal by convention so we don't need a
   *  fourth slot in the data. */
  eatingOut?: boolean;
  eatingOutNote?: string;
}

export interface MealPlan {
  weekKey: string;            // YYYY-MM-DD (Monday)
  days: Partial<Record<MealDay, MealEntry>>;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  createdBy: string;
}

// ── Pantry budget (Phase 1B) ─────────────────────────────────────

export interface PantryBudget {
  monthKey: string;           // YYYY-MM
  /** Map of staple-category → cents budgeted for the month. */
  categoryBudgets: Partial<Record<StapleCategory, number>>;
  /** Cached sum of categoryBudgets for fast Home renders. */
  totalBudgetCents: number;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
  createdBy: string;
}

// ── Path helpers ──────────────────────────────────────────────────

const stapleCol = (familyId: string) =>
  collection(db, 'families', familyId, 'staples');

const supplierCol = (familyId: string) =>
  collection(db, 'families', familyId, 'suppliers');

const listCol = (familyId: string) =>
  collection(db, 'families', familyId, 'groceryLists');

const mealPlanRef = (familyId: string, weekKey: string) =>
  doc(db, 'families', familyId, 'mealPlans', weekKey);

const budgetRef = (familyId: string, monthKey: string) =>
  doc(db, 'families', familyId, 'pantryBudgets', monthKey);

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
  data: { name: string; weekOf: string },
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-list';
  const ref = await addDoc(listCol(familyId), {
    name: data.name,
    weekOf: data.weekOf,
    status: 'active' as const,
    items: [],
    estimatedTotalCents: 0,
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

// ── Meal plans ───────────────────────────────────────────────────

export function subscribeToMealPlan(
  familyId: string,
  weekKey: string,
  cb: (plan: MealPlan | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(
    mealPlanRef(familyId, weekKey),
    (snap) => cb(snap.exists() ? ({ ...(snap.data() as MealPlan), weekKey }) : null),
    () => cb(null),
  );
}

/** Set or clear a single meal slot. Idempotent — first call to a missing
 *  doc creates it via setDoc-merge. */
export async function setMealSlot(
  familyId: string,
  weekKey: string,
  day: MealDay,
  slot: MealSlot,
  value: string | undefined,
  createdBy: string,
): Promise<void> {
  if (isGuestActive()) return;
  const patch: Record<string, unknown> = {
    weekKey,
    [`days.${day}.${slot}`]: value || null,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(), // setDoc-merge preserves an earlier value
    createdBy,
  };
  await setDoc(mealPlanRef(familyId, weekKey), patch, { merge: true });
}

/** Toggle the eating-out flag (and optionally set a note). */
export async function setEatingOut(
  familyId: string,
  weekKey: string,
  day: MealDay,
  on: boolean,
  note: string | undefined,
  createdBy: string,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(
    mealPlanRef(familyId, weekKey),
    {
      weekKey,
      [`days.${day}.eatingOut`]: on,
      [`days.${day}.eatingOutNote`]: on ? (note || null) : null,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy,
    },
    { merge: true },
  );
}

// ── Pantry budget ────────────────────────────────────────────────

export function subscribeToPantryBudget(
  familyId: string,
  monthKey: string,
  cb: (b: PantryBudget | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(
    budgetRef(familyId, monthKey),
    (snap) => cb(snap.exists() ? ({ ...(snap.data() as PantryBudget), monthKey }) : null),
    () => cb(null),
  );
}

/** Save the whole budget map. We recompute the cached total here so the
 *  Home + Budget surfaces have a single number to display without
 *  summing the map. */
export async function savePantryBudget(
  familyId: string,
  monthKey: string,
  categoryBudgets: Partial<Record<StapleCategory, number>>,
  createdBy: string,
): Promise<void> {
  if (isGuestActive()) return;
  const cleaned: Partial<Record<StapleCategory, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(categoryBudgets)) {
    if (typeof v === 'number' && v > 0) {
      cleaned[k as StapleCategory] = Math.round(v);
      total += Math.round(v);
    }
  }
  await setDoc(
    budgetRef(familyId, monthKey),
    {
      monthKey,
      categoryBudgets: cleaned,
      totalBudgetCents: total,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      createdBy,
    },
    { merge: true },
  );
}

/** Pure derivation: "how much did the family commit to this category
 *  this month?" Sums item.estimatedCents on every list whose `weekOf`
 *  falls in the given calendar month. We use estimatedCents rather than
 *  a separate "actual spent" field because Phase 1A doesn't capture
 *  receipts — Phase 2 may add `actualCents` per row. */
export function spentByCategoryInMonth(
  lists: GroceryList[],
  monthKey: string,
): Partial<Record<StapleCategory, number>> {
  const out: Partial<Record<StapleCategory, number>> = {};
  for (const list of lists) {
    if (!list.weekOf || !list.weekOf.startsWith(monthKey)) continue;
    for (const it of list.items) {
      if (!it.estimatedCents || it.estimatedCents <= 0) continue;
      const cat = (it.category || 'other') as StapleCategory;
      out[cat] = (out[cat] || 0) + it.estimatedCents;
    }
  }
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

/** "2026-05" for May 2026 — used as the doc id of the active monthly
 *  budget AND as the prefix-match for `weekOf` strings. */
export function currentMonthKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Friendly "May 2026" for headers. */
export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split('-').map((n) => parseInt(n, 10));
  if (!y || !m) return monthKey;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

/** True when today is Sunday (or later in the week than the current
 *  active list's `weekOf`). Drives the "Sunday auto-fill" copy on the
 *  Pantry Home empty state. */
export function isSundayOrNewWeek(d = new Date()): boolean {
  return d.getDay() === 0;
}

// ── Lists by month (for budget tracking) ─────────────────────────

/** Subscribe to every list whose `weekOf` falls in the given month.
 *  Used by the Budget surface to sum estimated spend. We pull the
 *  family's whole groceryLists collection and filter in-memory — the
 *  doc count stays small (~52 a year). */
export function subscribeToListsInMonth(
  familyId: string,
  monthKey: string,
  cb: (lists: GroceryList[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  return onSnapshot(
    listCol(familyId),
    (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GroceryList));
      cb(all.filter((l) => l.weekOf?.startsWith(monthKey)));
    },
    () => cb([]),
  );
}
