'use client';

// PantryContext — real-time staples, suppliers (Soko-tagged) and active
// grocery lists for the family. Sibling of FamilyContext / HiveContext;
// provides everything the Pantry surfaces need without each page having
// to wire its own listeners.

import {
  createContext, useContext, useEffect, useMemo, useState, ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  Staple, Supplier, GroceryList,
  subscribeToStaples, subscribeToSuppliers, subscribeToActiveLists,
} from '@/lib/pantry';

interface PantryContextType {
  /** Master list of recurring household items. */
  staples: Staple[];
  /** Suppliers tagged with `'soko'` — Pantry's filtered view onto the
   *  shared `families/{f}/suppliers` collection. */
  sokoSuppliers: Supplier[];
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
  const [sokoSuppliers, setSokoSuppliers] = useState<Supplier[]>([]);
  const [activeLists, setActiveLists] = useState<GroceryList[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId) {
      setStaples([]);
      setSokoSuppliers([]);
      setActiveLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let mountedListeners = 0;
    const onAnyLoaded = () => {
      mountedListeners++;
      if (mountedListeners >= 3) setLoading(false);
    };
    const unsubs = [
      subscribeToStaples(familyId, (s) => { setStaples(s); onAnyLoaded(); }),
      subscribeToSuppliers(familyId, 'soko', (s) => { setSokoSuppliers(s); onAnyLoaded(); }),
      subscribeToActiveLists(familyId, (l) => { setActiveLists(l); onAnyLoaded(); }),
    ];
    return () => { unsubs.forEach((u) => u()); };
  }, [familyId]);

  const currentList = useMemo(
    () => (activeLists.length > 0 ? activeLists[0] : null),
    [activeLists],
  );

  return (
    <PantryContext.Provider value={{ staples, sokoSuppliers, activeLists, currentList, loading }}>
      {children}
    </PantryContext.Provider>
  );
}

export function usePantry() {
  const ctx = useContext(PantryContext);
  if (!ctx) throw new Error('usePantry must be used within PantryProvider');
  return ctx;
}
