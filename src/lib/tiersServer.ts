// Server-only helpers for /api/admin/tiers/*. Loads / persists the
// /config/tiers/{tierId} overrides on top of DEFAULT_TIERS. Never
// imported from a client component.

import type { Firestore } from 'firebase-admin/firestore';
import {
  DEFAULT_TIERS, MODULE_REGISTRY,
  type SubscriptionTierId, type TierConfig, type ModuleId,
} from './tiers';

export type TierOverrides = Partial<Record<SubscriptionTierId, Partial<TierConfig>>>;

const TIER_IDS: SubscriptionTierId[] = ['nest', 'home', 'castle'];

/** Returns the merged tier config map: defaults overlaid by anything
 *  stored at /config/tiers/{tierId}. */
export async function loadAllTiers(db: Firestore): Promise<Record<SubscriptionTierId, TierConfig>> {
  const overrides = await loadTierOverrides(db);
  const out = {} as Record<SubscriptionTierId, TierConfig>;
  for (const id of TIER_IDS) {
    const base = DEFAULT_TIERS[id];
    const patch = overrides[id] ?? {};
    out[id] = {
      ...base,
      ...patch,
      modules: patch.modules ?? base.modules,
      addonModules: patch.addonModules ?? base.addonModules,
    };
  }
  return out;
}

async function loadTierOverrides(db: Firestore): Promise<TierOverrides> {
  const snaps = await Promise.all(TIER_IDS.map((id) => db.collection('config').doc('tiers').collection('plans').doc(id).get()));
  const out: TierOverrides = {};
  snaps.forEach((snap, i) => {
    if (snap.exists) out[TIER_IDS[i]] = snap.data() as Partial<TierConfig>;
  });
  return out;
}

/** Persist a partial patch to one tier's config doc. The defaults stay
 *  in code (lib/tiers.ts); the doc just stores the diff. Callers
 *  validate the shape — this writer trusts the input. */
export async function saveTierPatch(db: Firestore, tierId: SubscriptionTierId, patch: Partial<TierConfig>): Promise<void> {
  await db.collection('config').doc('tiers').collection('plans').doc(tierId).set(patch, { merge: true });
}

/** Filters a moduleId array down to ones that exist in the registry.
 *  Use before persisting so an admin can't accidentally store a typo. */
export function sanitiseModuleIds(ids: unknown): ModuleId[] {
  if (!Array.isArray(ids)) return [];
  const valid = new Set(MODULE_REGISTRY.map((m) => m.id));
  return ids.filter((id): id is ModuleId => typeof id === 'string' && valid.has(id as ModuleId));
}
