// Kaya Wealth · data hook (Phase 1 · 2026-06-01).
//
// One place the vault pulls everything from: live wealth_assets, the
// household currency (from the Hive config, same source the rest of the
// money UI uses), resolved FX so the net-worth roll-up can convert mixed-
// currency assets, and the USD benchmark multiplier for the currency
// toggle. Pre-filtering by view (shared / personal / a junior) happens in
// the page; this hook just hands back the raw materials.

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { resolveFxRate } from '@/lib/fx';
import { subscribeToWealthAssets, type WealthAsset, type WealthAuthor } from '@/lib/wealth';

export interface WealthData {
  familyId: string | undefined;
  householdCurrency: string;
  assets: WealthAsset[];
  loading: boolean;
  /** Multiplier: asset currency → household currency (1 if equal/unknown). */
  rateFor: (currency: string) => number;
  /** Multiplier: household currency → USD, for the benchmark. null until resolved. */
  usdPerHousehold: number | null;
  author: WealthAuthor;
  isParent: boolean;
}

export function useWealthData(): WealthData {
  const { user, profile } = useAuth();
  const { config } = useHive();
  const familyId = profile?.familyId;
  const householdCurrency = config?.currency || 'USD';

  const [assets, setAssets] = useState<WealthAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [rates, setRates] = useState<Record<string, number>>({});
  const [usdPerHousehold, setUsdPerHousehold] = useState<number | null>(null);

  const uid = user?.uid;
  useEffect(() => {
    if (!familyId || !uid) { setAssets([]); setLoading(false); return; }
    setLoading(true);
    return subscribeToWealthAssets(familyId, uid, (a) => { setAssets(a); setLoading(false); });
  }, [familyId, uid]);

  // Resolve FX once per distinct set of currencies present (+ the USD
  // benchmark). Unknown rates fall back to 1 — the roll-up never throws.
  const currencyKey = useMemo(
    () => Array.from(new Set(assets.map((a) => a.currency))).sort().join(','),
    [assets],
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const present = currencyKey ? currencyKey.split(',') : [];
      const next: Record<string, number> = { [householdCurrency]: 1 };
      for (const c of present) {
        if (c === householdCurrency) { next[c] = 1; continue; }
        const r = await resolveFxRate(c, householdCurrency);
        next[c] = r ?? 1;
      }
      const usd = householdCurrency === 'USD' ? 1 : await resolveFxRate(householdCurrency, 'USD');
      if (!cancelled) { setRates(next); setUsdPerHousehold(usd ?? null); }
    })();
    return () => { cancelled = true; };
  }, [currencyKey, householdCurrency]);

  const rateFor = useCallback(
    (c: string) => (c === householdCurrency ? 1 : rates[c] ?? 1),
    [rates, householdCurrency],
  );

  const author: WealthAuthor = useMemo(
    () => ({ uid: user?.uid ?? '', name: profile?.displayName || 'You' }),
    [user?.uid, profile?.displayName],
  );

  return {
    familyId, householdCurrency, assets, loading,
    rateFor, usdPerHousehold, author,
    isParent: profile?.role === 'parent',
  };
}
