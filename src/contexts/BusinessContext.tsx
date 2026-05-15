'use client';

// BusinessContext — real-time Kaya Business data for the active kid.
//
// Mirrors PantryContext in structure: one provider at the layout level, real-
// time onSnapshot listeners, a single `loading` flag, and derived values
// computed with useMemo so consumers don't redo the arithmetic.
//
// Provider position in layout.tsx:
//   HiveProvider → BusinessProvider (+ PantryProvider as siblings)
//
// BusinessContext consumes HiveContext for `activeKidId` so that the business
// screens always reflect whichever kid the parent is currently viewing — the
// same switcher that drives the Hive wallet pages.

import {
  createContext, useContext, useEffect, useMemo, useState, ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { useHive } from './HiveContext';
import {
  Business, Asset, Sale, Cost, PriceListItem,
  totalAssetValueCents as calcTotalAssetValue,
  weeklyNetCents,
  subscribeToBusiness,
  subscribeToAssets,
  subscribeToSales,
  subscribeToCosts,
  subscribeToPriceList,
} from '@/lib/business';

// ── Public shape ──────────────────────────────────────────────────

interface BusinessContextType {
  /** The kid's business singleton (null = not set up yet). */
  business: Business | null;
  /** Active (non-retired) assets, ordered by creation date asc. */
  assets: Asset[];
  /** Last 100 sales, newest first. */
  sales: Sale[];
  /** Last 100 costs, newest first. */
  costs: Cost[];
  /** Family-wide price list, ordered by name asc. */
  priceList: PriceListItem[];

  // ── Derived values (memoised) ──────────────────────────────────
  /** Sum of count × unitPrice for all non-retired assets. */
  totalAssetValueCents: number;
  /** Rolling 7-day revenue from approved sales. */
  weeklyRevenueCents: number;
  /** Rolling 7-day costs (approved only). */
  weeklyCostsCents: number;
  /** Rolling 7-day profit (revenue – costs). May be negative. */
  weeklyProfitCents: number;
  /** Sales + costs still waiting for parent approval. */
  pendingCount: number;
  /** Convenience accessor for the float balance (0 when no business). */
  floatBalanceCents: number;

  loading: boolean;
}

const BusinessContext = createContext<BusinessContextType | null>(null);

// ── Provider ──────────────────────────────────────────────────────

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { activeKidId } = useHive();

  const familyId = profile?.familyId ?? null;
  const kidId = activeKidId ?? null;

  const [business, setBusiness] = useState<Business | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [priceList, setPriceList] = useState<PriceListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // ── Per-kid listeners (reset whenever the active kid changes) ────
  useEffect(() => {
    if (!familyId || !kidId) {
      setBusiness(null);
      setAssets([]);
      setSales([]);
      setCosts([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const flip = () => { if (!cancelled) setLoading(false); };
    // Hard timeout — never leave the user on a loading skeleton.
    const timeout = setTimeout(flip, 1500);

    const unsubs = [
      subscribeToBusiness(familyId, kidId, (b) => { setBusiness(b); flip(); }),
      subscribeToAssets(familyId, kidId,    (a) => { setAssets(a);   flip(); }),
      subscribeToSales(familyId, kidId,     (s) => { setSales(s);    flip(); }),
      subscribeToCosts(familyId, kidId,     (c) => { setCosts(c);    flip(); }),
    ];
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      unsubs.forEach((u) => u());
    };
  }, [familyId, kidId]);

  // ── Family-wide price list (independent of active kid) ──────────
  useEffect(() => {
    if (!familyId) { setPriceList([]); return; }
    return subscribeToPriceList(familyId, (items) => setPriceList(items));
  }, [familyId]);

  // ── Derived values ─────────────────────────────────────────────
  const totalAssetValueCents = useMemo(
    () => calcTotalAssetValue(assets),
    [assets],
  );

  const { weeklyRevenueCents, weeklyCostsCents, weeklyProfitCents } = useMemo(() => {
    const since = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const { revenueCents, costsCents, profitCents } = weeklyNetCents(sales, costs, since);
    return {
      weeklyRevenueCents: revenueCents,
      weeklyCostsCents: costsCents,
      weeklyProfitCents: profitCents,
    };
  }, [sales, costs]);

  const pendingCount = useMemo(
    () =>
      sales.filter((s) => s.status === 'pending_approval').length +
      costs.filter((c) => c.status === 'pending_approval').length,
    [sales, costs],
  );

  const floatBalanceCents = business?.floatBalanceCents ?? 0;

  return (
    <BusinessContext.Provider
      value={{
        business,
        assets,
        sales,
        costs,
        priceList,
        totalAssetValueCents,
        weeklyRevenueCents,
        weeklyCostsCents,
        weeklyProfitCents,
        pendingCount,
        floatBalanceCents,
        loading,
      }}
    >
      {children}
    </BusinessContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────

export function useBusiness() {
  const ctx = useContext(BusinessContext);
  if (!ctx) throw new Error('useBusiness must be used within BusinessProvider');
  return ctx;
}
