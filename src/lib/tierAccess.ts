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
  DEFAULT_TIERS, MODULE_REGISTRY, resolveModuleAccess,
  type ModuleId, type SubscriptionTierId, type TierConfig,
} from './tiers';

// ── Default tier fallback ─────────────────────────────────────────────
//
// During closed beta every existing family has unrestricted access —
// the gate is wired but the default is Castle so we don't accidentally
// lock anyone out of features that worked yesterday. Flip this to
// 'nest' when the paid funnel opens (PR 4) and we want missing /
// new families to land on Free by default.
//
// Operator-owned families and `isFoundingFamily` accounts are already
// bypassed below, so this constant only matters for plain user
// accounts that haven't picked a plan yet.
const DEFAULT_TIER_FALLBACK: SubscriptionTierId = 'castle';

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
    const isFoundingBypass = !!family?.isFoundingFamily;
    const tierId = (family?.tierId as SubscriptionTierId | undefined) ?? DEFAULT_TIER_FALLBACK;
    const addons = family?.subscription?.addons ?? [];
    const tiers: Record<SubscriptionTierId, TierConfig> = {
      nest:   { ...DEFAULT_TIERS.nest,   ...overrides.nest,   modules: overrides.nest?.modules     ?? DEFAULT_TIERS.nest.modules,   addonModules: overrides.nest?.addonModules     ?? DEFAULT_TIERS.nest.addonModules },
      home:   { ...DEFAULT_TIERS.home,   ...overrides.home,   modules: overrides.home?.modules     ?? DEFAULT_TIERS.home.modules,   addonModules: overrides.home?.addonModules     ?? DEFAULT_TIERS.home.addonModules },
      castle: { ...DEFAULT_TIERS.castle, ...overrides.castle, modules: overrides.castle?.modules ?? DEFAULT_TIERS.castle.modules, addonModules: overrides.castle?.addonModules ?? DEFAULT_TIERS.castle.addonModules },
    };
    const modules = resolveModuleAccess(tierId, addons, overrides);
    const has = (m: ModuleId) => {
      if (isOperator) return true;
      if (isFoundingBypass) return true;
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
