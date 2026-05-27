// Client wrappers for /api/admin/tiers. Mirrors the buzzClient
// pattern — Bearer-auth fetches that hand back typed shapes.

import { auth } from './firebase';
import type { SubscriptionTierId, TierConfig } from './tiers';

async function authHeader(): Promise<HeadersInit> {
  const u = auth.currentUser;
  if (!u) throw new Error('not-signed-in');
  const token = await u.getIdToken();
  return { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

export type TierMap = Record<SubscriptionTierId, TierConfig>;

export async function getTiers(): Promise<TierMap> {
  const res = await fetch('/api/admin/tiers', { headers: await authHeader() });
  if (!res.ok) throw new Error(`get-tiers-failed-${res.status}`);
  const { tiers } = (await res.json()) as { tiers: TierMap };
  return tiers;
}

export async function saveTierPatch(tierId: SubscriptionTierId, patch: Partial<TierConfig>): Promise<TierMap> {
  const res = await fetch('/api/admin/tiers', {
    method: 'PATCH',
    headers: await authHeader(),
    body: JSON.stringify({ tierId, patch }),
  });
  if (!res.ok) throw new Error(`save-tier-failed-${res.status}`);
  const { tiers } = (await res.json()) as { tiers: TierMap };
  return tiers;
}
