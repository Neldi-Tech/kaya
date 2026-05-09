'use client';

// PantryContext — real-time staples, suppliers (Soko-tagged), active
// grocery lists, current week's meal plan and current month's budget
// (with derived per-category spending). Sibling of FamilyContext /
// HiveContext; provides everything the Pantry surfaces need without
// each page having to wire its own listeners.

import {
  createContext, useContext, useEffect, useMemo, useState, ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import {
  Staple, Supplier, GroceryList, MealPlan, PantryBudget, StapleCategory,
  subscribeToStaples, subscribeToSuppliers, subscribeToActiveLists,
  subscribeToMealPlan, subscribeToPantryBudget, subscribeToListsInMonth,
  spentByCategoryInMonth, thisWeekKey, currentMonthKey,
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
  /** This week's meal plan (Monday-keyed). Null when the family hasn't
   *  set anything for the week. */
  mealPlan: MealPlan | null;
  /** Active week + month keys, refreshed on a 60s interval so the page
   *  rolls over without a reload near midnight. */
  weekKey: string;
  monthKey: string;
  /** This calendar month's pantry budget. */
  budget: PantryBudget | null;
  /** Per-category spending derived from this month's lists (any status,
   *  filtered by weekOf prefix). */
  monthSpentByCategory: Partial<Record<StapleCategory, number>>;
  /** Sum of `monthSpentByCategory` — handy for the Home strip. */
  monthSpentTotalCents: number;
  loading: boolean;
}

const PantryContext = createContext<PantryContextType | null>(null);

export function PantryProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const familyId = profile?.familyId;

  const [staples, setStaples] = useState<Staple[]>([]);
  const [sokoSuppliers, setSokoSuppliers] = useState<Supplier[]>([]);
  const [activeLists, setActiveLists] = useState<GroceryList[]>([]);
  const [mealPlan, setMealPlan] = useState<MealPlan | null>(null);
  const [budget, setBudget] = useState<PantryBudget | null>(null);
  const [monthLists, setMonthLists] = useState<GroceryList[]>([]);
  const [loading, setLoading] = useState(true);

  // Re-derive week + month keys every minute so the page rolls over
  // without a reload at midnight on the boundary.
  const [weekKey, setWeekKey] = useState(thisWeekKey());
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  useEffect(() => {
    const id = setInterval(() => {
      setWeekKey(thisWeekKey());
      setMonthKey(currentMonthKey());
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!familyId) {
      setStaples([]);
      setSokoSuppliers([]);
      setActiveLists([]);
      setMealPlan(null);
      setBudget(null);
      setMonthLists([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const flip = () => { if (!cancelled) setLoading(false); };
    const timeout = setTimeout(flip, 1500);
    const unsubs = [
      subscribeToStaples(familyId, (s) => { setStaples(s); flip(); }),
      subscribeToSuppliers(familyId, 'soko', (s) => { setSokoSuppliers(s); flip(); }),
      subscribeToActiveLists(familyId, (l) => { setActiveLists(l); flip(); }),
      subscribeToMealPlan(familyId, weekKey, (m) => { setMealPlan(m); flip(); }),
      subscribeToPantryBudget(familyId, monthKey, (b) => { setBudget(b); flip(); }),
      subscribeToListsInMonth(familyId, monthKey, (l) => { setMonthLists(l); flip(); }),
    ];
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      unsubs.forEach((u) => u());
    };
  }, [familyId, weekKey, monthKey]);

  const monthSpentByCategory = useMemo(
    () => spentByCategoryInMonth(monthLists, monthKey),
    [monthLists, monthKey],
  );
  const monthSpentTotalCents = useMemo(
    () => Object.values(monthSpentByCategory).reduce<number>((sum, v) => sum + (v || 0), 0),
    [monthSpentByCategory],
  );

  const currentList = useMemo(
    () => (activeLists.length > 0 ? activeLists[0] : null),
    [activeLists],
  );

  return (
    <PantryContext.Provider value={{
      staples, sokoSuppliers, activeLists, currentList,
      mealPlan, weekKey, monthKey, budget,
      monthSpentByCategory, monthSpentTotalCents,
      loading,
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
