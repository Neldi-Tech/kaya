'use client';

// PantryContext — real-time staples, suppliers, utilities and active
// grocery lists for the family. Sibling of FamilyContext / HiveContext;
// provides everything the Pantry surfaces need without each page having
// to wire its own listeners.

import {
  createContext, useContext, useEffect, useMemo, useState, ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  Staple, Supplier, GroceryList, Utility,
  subscribeToStaples, subscribeToSuppliers, subscribeToActiveLists,
  subscribeToUtilities,
} from '@/lib/pantry';

interface PantryContextType {
  /** Master list of recurring household items. */
  staples: Staple[];
  /** Every supplier in the family directory (all categories). */
  suppliers: Supplier[];
  /** Suppliers tagged `'soko'` — Pantry's filtered grocery view onto
   *  the shared `families/{f}/suppliers` collection. */
  sokoSuppliers: Supplier[];
  /** Recurring household bills + helper salaries. */
  utilities: Utility[];
  /** All open lists, newest first. The Home + List surfaces use the
   *  most recent one as "this week". */
  activeLists: GroceryList[];
  /** Convenience accessor — returns the most recent open list, or null
   *  when the family hasn't started one yet. */
  currentList: GroceryList | null;
  loading: boolean;
}

const PantryContext = createContext<PantryContextType | null>(null);

export function PantryProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [staples, setStaples] = useState<Staple[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [utilities, setUtilities] = useState<Utility[]>([]);
  const [activeLists, setActiveLists] = useState<GroceryList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId) {
      setStaples([]);
      setSuppliers([]);
      setUtilities([]);
      setActiveLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Each listener owns its own "first emission has fired" flag — we
    // only show "Loading…" until the FIRST listener fires (that's enough
    // to render the page; the others will populate as they arrive).
    // Hard timeout fallback (1.5s) so a misconfigured rule or composite
    // index never sticks the user on a loading screen.
    let cancelled = false;
    const flip = () => { if (!cancelled) setLoading(false); };
    const timeout = setTimeout(flip, 1500);
    const unsubs = [
      subscribeToStaples(familyId, (s) => { setStaples(s); flip(); }),
      // Pull every supplier once; the Soko view is derived below. This
      // keeps a single listener on the collection while still letting
      // the Utilities surface pick from utility / security vendors.
      subscribeToSuppliers(familyId, 'all', (s) => { setSuppliers(s); flip(); }),
      subscribeToUtilities(familyId, (u) => { setUtilities(u); flip(); }),
      subscribeToActiveLists(familyId, (l) => { setActiveLists(l); flip(); }),
    ];
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      unsubs.forEach((u) => u());
    };
  }, [familyId]);

  const sokoSuppliers = useMemo(
    () => suppliers.filter((s) => s.categories?.includes('soko')),
    [suppliers],
  );

  const currentList = useMemo(
    () => (activeLists.length > 0 ? activeLists[0] : null),
    [activeLists],
  );

  return (
    <PantryContext.Provider value={{
      staples, suppliers, sokoSuppliers, utilities, activeLists, currentList, loading,
    }}>
      {children}
    </PantryContext.Provider>
  );
}

export function usePantry() {
  const ctx = useContext(PantryContext);
  if (!ctx) throw new Error('usePantry must be used within PantryProvider');
  return ctx;
}
