// Household · Subscriptions + Contributions catalogue data layer.
//
// Two collections, parallel shape:
//   families/{f}/catalogue_subs/{itemId}      — apps, memberships, media…
//   families/{f}/catalogue_contribs/{itemId}  — churches, charities…
//
// Family-scoped, parent-managed (Firestore rules from P1). Add forms
// search this as the user types; on submit, new entries (no existing
// match) get added — the catalogue grows naturally with usage.
//
// File name is `householdCatalogue` not `catalogue` to avoid collision
// with src/lib/catalogue.ts which already owns the Pantry master grocery
// catalogue (different domain entirely).

import {
  collection, addDoc, doc, updateDoc, getDoc, getDocs, Timestamp, onSnapshot,
  query, orderBy,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export interface CatalogueSubItem {
  id: string;
  name: string;
  category: string;
  subCategory: string;
  defaultPlatform: string | null;
  defaultCurrency: string;
  iconKey: string;
  hideFromSuggestions: boolean;
  usageCount: number;
  createdAt: Timestamp;
}

export interface CatalogueContribItem {
  id: string;
  recipientName: string;
  recipientType: string;
  pageId: string | null;
  category: string;
  subCategory: string;
  hideFromSuggestions: boolean;
  usageCount: number;
  createdAt: Timestamp;
}

const subsCatCol     = (familyId: string) => collection(db, 'families', familyId, 'catalogue_subs');
const contribsCatCol = (familyId: string) => collection(db, 'families', familyId, 'catalogue_contribs');

/** Subscribe to the subs catalogue. Sort by usageCount DESC client-side
 *  so the picker surfaces the family's most-used items first. */
export function subscribeToCatalogueSubs(
  familyId: string,
  cb: (items: CatalogueSubItem[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    subsCatCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CatalogueSubItem));
      list.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
      cb(list.filter((it) => !it.hideFromSuggestions));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[catalogue_subs] subscribe failed:', err);
      cb([]);
    },
  );
}

export async function listCatalogueSubs(familyId: string): Promise<CatalogueSubItem[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(query(subsCatCol(familyId), orderBy('name')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as CatalogueSubItem));
}

/** Best-effort write on Add: when the user types a name that isn't in
 *  the catalogue, persist a fresh entry; when they pick an existing one,
 *  bump its usageCount. Never blocks the parent write — if the catalogue
 *  write fails the subscription still saves. */
export async function recordSubCatalogueUse(
  familyId: string,
  data: Pick<CatalogueSubItem, 'name' | 'category' | 'subCategory' | 'defaultCurrency'>,
  existingId?: string | null,
): Promise<string | null> {
  if (isGuestActive()) return existingId ?? 'guest-cat-sub';
  try {
    if (existingId) {
      const ref = doc(subsCatCol(familyId), existingId);
      const snap = await getDoc(ref);
      const current = snap.exists() ? (snap.data().usageCount ?? 0) : 0;
      await updateDoc(ref, { usageCount: current + 1 });
      return existingId;
    }
    const ref = await addDoc(subsCatCol(familyId), {
      name: data.name,
      category: data.category,
      subCategory: data.subCategory,
      defaultPlatform: null,
      defaultCurrency: data.defaultCurrency,
      iconKey: '',
      hideFromSuggestions: false,
      usageCount: 1,
      createdAt: Timestamp.now(),
    });
    return ref.id;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[catalogue_subs] recordSubCatalogueUse failed:', e);
    return null;
  }
}

export function subscribeToCatalogueContribs(
  familyId: string,
  cb: (items: CatalogueContribItem[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    contribsCatCol(familyId),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as CatalogueContribItem));
      list.sort((a, b) => (b.usageCount ?? 0) - (a.usageCount ?? 0));
      cb(list.filter((it) => !it.hideFromSuggestions));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[catalogue_contribs] subscribe failed:', err);
      cb([]);
    },
  );
}
