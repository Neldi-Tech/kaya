// Client-side tier access — the resolved-module set the current
// family can use, recomputed live as either the family's plan or the
// admin's /config/tiers/plans/* overrides change.
//
// Used by <TierGate> (PR 3) and any feature that wants to render an
// upsell vs the real surface. Operators bypass the gate entirely
// (closed-beta convenience + escape hatch for support).

'use client';

import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { doc } from 'firebase/firestore';
import { db } from './firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  MODULE_REGISTRY, mergedTierConfig, resolveModuleAccess,
  type ModuleId, type SubscriptionTierId, type TierConfig,
} from './tiers';

// ── Default tier fallback ─────────────────────────────────────────────
//
// 2026-05-29 — flipped from 'castle' → 'nest' now that:
//   • the tier-codes admin path (PRs #335 / #343) is shipped, so Elia
//     can mint per-family upgrade codes to grant Home / Castle when
//     someone deserves more access; and
//   • the closed-beta cohort is already covered: the first 100
//     families carry `isFoundingFamily: true` (charter crew) and get
//     a full bypass below regardless of tier, and operators bypass
//     too — so flipping only affects families that joined after the
//     founding window AND haven't redeemed a tier code.
//
// Net effect: new signups land on **Free / Nest** by default and have
// to redeem a tier code to unlock Home / Castle. Founding + operator
// accounts are unchanged.
const DEFAULT_TIER_FALLBACK: SubscriptionTierId = 'nest';

export interface TierAccess {
  tierId: SubscriptionTierId;
  /** Set of module IDs the family currently has access to. */
  modules: Set<ModuleId>;
  /** True ⇒ the gate is in operator-bypass mode (always grants). */
  isOperatorBypass: boolean;
  /** True ⇒ the bypass is "founding family / closed beta" (also grants). */
  isFoundingBypass: boolean;
  /** Returns true if the given module is currently accessible. */
  has: (moduleId: ModuleId) => boolean;
  /** The merged tier configs (defaults + admin overrides). */
  tiers: Record<SubscriptionTierId, TierConfig>;
}

export function useTierAccess(): TierAccess {
  const { user } = useAuth();
  const { family } = useFamily();
  const [overrides, setOverrides] = useState<Partial<Record<SubscriptionTierId, Partial<TierConfig>>>>({});
  const [isOperator, setIsOperator] = useState(false);

  // Live subscription to operator status — gate-bypass for Kaya staff.
  useEffect(() => {
    if (!user?.email) { setIsOperator(false); return; }
    const ref = doc(db, 'operators', user.email.toLowerCase());
    const unsub = onSnapshot(ref, (s) => setIsOperator(s.exists()), () => setIsOperator(false));
    return () => unsub();
  }, [user?.email]);

  // Lazy expiry sweep — when the family's subscription.expiresAt is in
  // the past, hit /api/tier-codes/check-expiry so the server reverts to
  // Nest. Skipped for operator + founding families (server also skips,
  // but we save the round-trip). Re-runs whenever the family doc
  // refreshes, so a fresh redemption picks up immediately.
  useEffect(() => {
    if (!user) return;
    if (isOperator) return;
    if (family?.isFoundingFamily) return;
    const exp = (family?.subscription as { expiresAt?: { toMillis?: () => number } } | undefined)?.expiresAt;
    if (!exp || typeof exp.toMillis !== 'function') return;
    if (exp.toMillis() > Date.now()) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        await fetch('/api/tier-codes/check-expiry', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}` },
        });
      } catch { /* swallow — next page-load will retry */ }
    })();
  }, [user, isOperator, family]);

  // Live subscription to /config/tiers/plans/* — three docs, picked up
  // on every change so admin matrix edits propagate without reload.
  useEffect(() => {
    if (!user) return;
    const col = collection(db, 'config', 'tiers', 'plans');
    const unsub = onSnapshot(col, (snap) => {
      const next: Partial<Record<SubscriptionTierId, Partial<TierConfig>>> = {};
      for (const d of snap.docs) {
        const id = d.id as SubscriptionTierId;
        if (id === 'nest' || id === 'home' || id === 'castle') next[id] = d.data() as Partial<TierConfig>;
      }
      setOverrides(next);
    }, () => { /* rules-error fallthrough; defaults still apply */ });
    return () => unsub();
  }, [user]);

  const access = useMemo<TierAccess>(() => {
    // 2026-05-30 — founding-family is now IDENTITY ONLY (renders the
    // Charter #N badge on profiles) and no longer grants access bypass.
    // Founding families now see exactly what their tierId entitles them
    // to, just like everyone else. Operator bypass still applies — Kaya
    // staff need it for support flows. `isFoundingBypass` stays in the
    // return shape so consumers compile, hard-coded to false.
    const isFoundingBypass = false;
    const tierId = (family?.tierId as SubscriptionTierId | undefined) ?? DEFAULT_TIER_FALLBACK;
    const addons = family?.subscription?.addons ?? [];
    // Merge each tier through `mergedTierConfig` (defaults always
    // preserved, overrides UNION on top) so newly-shipped modules show
    // up in the comparison table even when an older Firestore override
    // doesn't list them.
    const tiers: Record<SubscriptionTierId, TierConfig> = {
      nest:   mergedTierConfig('nest',   overrides),
      home:   mergedTierConfig('home',   overrides),
      castle: mergedTierConfig('castle', overrides),
    };
    const modules = resolveModuleAccess(tierId, addons, overrides);
    const has = (m: ModuleId) => {
      if (isOperator) return true;
      return modules.has(m);
    };
    return { tierId, modules, isOperatorBypass: isOperator, isFoundingBypass, has, tiers };
  }, [family, overrides, isOperator]);

  return access;
}

/** Returns metadata for the requested module (display name, emoji,
 *  description) — sourced from MODULE_REGISTRY. */
export function moduleMeta(moduleId: ModuleId) {
  return MODULE_REGISTRY.find((m) => m.id === moduleId);
}
