// Per-family editable product catalog.
//
// The built-in catalog (DIRECTORY_STAPLES in pantryDirectory.ts) ships
// in the bundle and is identical for everyone. This module layers a
// PER-FAMILY overlay on top of it, stored in Firestore at
// `families/{familyId}/catalogItems`, so a family can:
//   - edit the details of a built-in item (name, emoji, category,
//     region, qty, unit, cadence, price, note)
//   - add brand-new items of their own
// without touching the shared defaults or any other family.
//
// One `catalogItems` doc is either:
//   - an OVERRIDE  → `baseLabel` = the built-in label it reshapes
//   - a CUSTOM item → `baseLabel` = null
//
// `mergeCatalog()` folds the overlay onto the built-in list and hands
// the UI a single `CatalogEntry[]` to render. Identity is a stable
// `key` ("base:<label>" or "custom:<docId>") so editing an item's
// name never loses track of which row it is.

import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, type Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  DIRECTORY_STAPLES, type Region, type Surface,
} from './pantryDirectory';
import type { Cadence, StapleCategory } from './pantry';

// ── Types ────────────────────────────────────────────────────────

/** A Firestore `catalogItems` document. */
export interface CatalogItemDoc {
  id: string;
  /** Built-in label this overrides; `null` for a family-created item. */
  baseLabel: string | null;
  label: string;
  emoji: string;
  surface: Surface;
  category: StapleCategory;
  region: Region;
  defaultQty: number;
  unit: string;
  cadence: Cadence;
  /** Optional one-liner. `null` (not missing) so updates can clear it. */
  note: string | null;
  /** Explicit price in family-currency cents; `null` → use the estimator. */
  priceCents: number | null;
  createdBy: string;
  updatedAt: Timestamp;
}

/** The editable field set — what an editor form collects. */
export interface CatalogItemInput {
  label: string;
  emoji: string;
  surface: Surface;
  category: StapleCategory;
  region: Region;
  defaultQty: number;
  unit: string;
  cadence: Cadence;
  note?: string;
  priceCents?: number;
}

/** A built-in item with the family overlay applied, OR a custom item —
 *  the single shape the directory UI renders. */
export interface CatalogEntry {
  /** Stable identity — "base:<originalLabel>" or "custom:<docId>". */
  key: string;
  label: string;
  emoji: string;
  surface: Surface;
  category: StapleCategory;
  region: Region;
  defaultQty: number;
  unit: string;
  cadence: Cadence;
  note?: string;
  /** Explicit price override in cents; undefined → estimator decides. */
  priceCents?: number;
  /** Lowercase search tokens. */
  match: string[];
  /** Family-created item (not in the built-in catalog). */
  isCustom: boolean;
  /** Built-in item that has a family override. */
  isEdited: boolean;
  /** The `catalogItems` doc id — set for custom items + edited built-ins. */
  docId?: string;
  /** Original built-in label — set for all built-ins (edited or not). */
  baseLabel?: string;
}

// ── Firestore helpers ────────────────────────────────────────────

const catalogCol = (familyId: string) =>
  collection(db, 'families', familyId, 'catalogItems');

/** Firestore rejects `undefined` — normalise an input into a writable
 *  payload, storing `null` for the optional fields so an update can
 *  clear a previously-set note or price. */
function toPayload(input: CatalogItemInput) {
  return {
    label: input.label.trim(),
    emoji: input.emoji?.trim() || '📦',
    surface: input.surface,
    category: input.category,
    region: input.region,
    defaultQty: Math.max(1, Math.round(input.defaultQty)),
    unit: input.unit,
    cadence: input.cadence,
    note: input.note?.trim() || null,
    priceCents:
      typeof input.priceCents === 'number' && input.priceCents > 0
        ? Math.round(input.priceCents)
        : null,
  };
}

/** Live-subscribe to the family's catalog overlay. */
export function subscribeToCatalog(
  familyId: string,
  cb: (docs: CatalogItemDoc[]) => void,
): () => void {
  return onSnapshot(catalogCol(familyId), (snap) => {
    cb(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CatalogItemDoc, 'id'>) })));
  });
}

/** Create or update a family override of a built-in catalog staple.
 *  `existingDocId` is the override doc when one already exists. */
export async function saveCatalogOverride(
  familyId: string,
  baseLabel: string,
  input: CatalogItemInput,
  existingDocId: string | undefined,
  uid: string,
): Promise<void> {
  const payload = toPayload(input);
  if (existingDocId) {
    await updateDoc(doc(catalogCol(familyId), existingDocId), {
      ...payload,
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(catalogCol(familyId), {
      ...payload,
      baseLabel,
      createdBy: uid,
      updatedAt: serverTimestamp(),
    });
  }
}

/** Create a brand-new family catalog item (not in the built-in set). */
export async function addCustomItem(
  familyId: string,
  input: CatalogItemInput,
  uid: string,
): Promise<void> {
  await addDoc(catalogCol(familyId), {
    ...toPayload(input),
    baseLabel: null,
    createdBy: uid,
    updatedAt: serverTimestamp(),
  });
}

/** Update an existing custom item. */
export async function updateCustomItem(
  familyId: string,
  docId: string,
  input: CatalogItemInput,
): Promise<void> {
  await updateDoc(doc(catalogCol(familyId), docId), {
    ...toPayload(input),
    updatedAt: serverTimestamp(),
  });
}

/** Delete a catalog doc — resets a built-in back to its default, or
 *  removes a custom item entirely. */
export async function deleteCatalogItem(
  familyId: string,
  docId: string,
): Promise<void> {
  await deleteDoc(doc(catalogCol(familyId), docId));
}

// ── Merge ────────────────────────────────────────────────────────

/** Fold the family overlay onto the built-in catalog. Custom items
 *  come first so a family's own additions sit at the top of the grid. */
export function mergeCatalog(docs: CatalogItemDoc[]): CatalogEntry[] {
  const overrides = new Map<string, CatalogItemDoc>();
  const customs: CatalogItemDoc[] = [];
  for (const d of docs) {
    if (d.baseLabel) overrides.set(d.baseLabel, d);
    else customs.push(d);
  }

  const builtIns: CatalogEntry[] = DIRECTORY_STAPLES.map((s) => {
    const o = overrides.get(s.label);
    if (!o) {
      return {
        key: `base:${s.label}`,
        label: s.label,
        emoji: s.emoji,
        surface: s.surface,
        category: s.category,
        region: s.region,
        defaultQty: s.defaultQty,
        unit: s.unit,
        cadence: s.cadence,
        note: s.note,
        match: s.match,
        isCustom: false,
        isEdited: false,
        baseLabel: s.label,
      };
    }
    return {
      key: `base:${s.label}`,
      label: o.label,
      emoji: o.emoji,
      // Surface stays the built-in's — it's structural (which tab the
      // item lives under), so we don't let an override move it.
      surface: s.surface,
      category: o.category,
      region: o.region,
      defaultQty: o.defaultQty,
      unit: o.unit,
      cadence: o.cadence,
      note: o.note ?? undefined,
      priceCents: o.priceCents ?? undefined,
      // Search still matches the original tokens plus the new name.
      match: [...s.match, o.label.toLowerCase()],
      isCustom: false,
      isEdited: true,
      docId: o.id,
      baseLabel: s.label,
    };
  });

  const custom: CatalogEntry[] = customs.map((d) => ({
    key: `custom:${d.id}`,
    label: d.label,
    emoji: d.emoji,
    surface: d.surface,
    category: d.category,
    region: d.region,
    defaultQty: d.defaultQty,
    unit: d.unit,
    cadence: d.cadence,
    note: d.note ?? undefined,
    priceCents: d.priceCents ?? undefined,
    match: [d.label.toLowerCase()],
    isCustom: true,
    isEdited: false,
    docId: d.id,
  }));

  return [...custom, ...builtIns];
}

/** Convert a merged entry back into the editable input shape. */
export function entryToInput(e: CatalogEntry): CatalogItemInput {
  return {
    label: e.label,
    emoji: e.emoji,
    surface: e.surface,
    category: e.category,
    region: e.region,
    defaultQty: e.defaultQty,
    unit: e.unit,
    cadence: e.cadence,
    note: e.note,
    priceCents: e.priceCents,
  };
}
