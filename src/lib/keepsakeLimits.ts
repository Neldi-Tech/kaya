// Keepsake — tier limits + gating helpers.
//
// `families/{familyId}.plan` is the single source of truth for what a
// family can do with Albums. Default is 'free' if missing (the field
// only lands on docs that opt into a paid plan — a missing field is
// equivalent to free, not an error).
//
// The numbers here are intentionally generous for free and uncapped
// for paid — the goal is for free to feel useful (so families try it),
// while paid removes friction at the moments that matter (multiple
// albums, sub-albums, custom access lists).

export type KeepsakePlan = 'free' | 'family' | 'family_pro';

export interface PlanLimits {
  maxTopLevelAlbums: number;
  maxPhotosTotal: number;
  allowSubAlbums: boolean;
  allowCustomAccess: boolean;
  allowAI: boolean;
  allowVideo: boolean;
  storageBudgetBytes: number;
}

export const PLAN_LIMITS: Record<KeepsakePlan, PlanLimits> = {
  free: {
    maxTopLevelAlbums:   1,
    maxPhotosTotal:      200,
    allowSubAlbums:      false,
    allowCustomAccess:   false,
    allowAI:             false,
    allowVideo:          false,
    storageBudgetBytes:  500 * 1024 * 1024,         // ~500 MB
  },
  family: {
    maxTopLevelAlbums:   Infinity,
    maxPhotosTotal:      Infinity,
    allowSubAlbums:      true,
    allowCustomAccess:   true,
    allowAI:             true,
    allowVideo:          false,
    storageBudgetBytes:  50 * 1024 * 1024 * 1024,   // 50 GB
  },
  family_pro: {
    maxTopLevelAlbums:   Infinity,
    maxPhotosTotal:      Infinity,
    allowSubAlbums:      true,
    allowCustomAccess:   true,
    allowAI:             true,
    allowVideo:          true,
    storageBudgetBytes:  250 * 1024 * 1024 * 1024,  // 250 GB
  },
};

export function resolvePlan(plan: string | undefined | null): KeepsakePlan {
  if (plan === 'family' || plan === 'family_pro') return plan;
  return 'free';
}

export function getLimits(plan: string | undefined | null): PlanLimits {
  return PLAN_LIMITS[resolvePlan(plan)];
}

// ── Action gates (use these in UI to enable/disable + reason copy) ──

export interface GateResult {
  allowed: boolean;
  /** Short human reason when blocked. UI surfaces this in upgrade card. */
  reason?: string;
  /** Set when the block is due to plan limits (vs. a generic error). */
  needsUpgrade?: boolean;
}

export function canCreateTopLevelAlbum(
  plan: KeepsakePlan,
  currentTopLevelCount: number,
): GateResult {
  const lim = PLAN_LIMITS[plan];
  if (currentTopLevelCount >= lim.maxTopLevelAlbums) {
    return {
      allowed: false,
      needsUpgrade: plan === 'free',
      reason: plan === 'free'
        ? `Free plan = ${lim.maxTopLevelAlbums} album. Upgrade for unlimited.`
        : 'Album limit reached.',
    };
  }
  return { allowed: true };
}

export function canCreateSubAlbum(plan: KeepsakePlan): GateResult {
  if (!PLAN_LIMITS[plan].allowSubAlbums) {
    return {
      allowed: false,
      needsUpgrade: plan === 'free',
      reason: 'Sub-albums are a Family plan feature.',
    };
  }
  return { allowed: true };
}

export function canUseCustomAccess(plan: KeepsakePlan): GateResult {
  if (!PLAN_LIMITS[plan].allowCustomAccess) {
    return {
      allowed: false,
      needsUpgrade: plan === 'free',
      reason: 'Custom access lists are a Family plan feature.',
    };
  }
  return { allowed: true };
}

export function canAddPhoto(
  plan: KeepsakePlan,
  currentPhotoCount: number,
): GateResult {
  const lim = PLAN_LIMITS[plan];
  if (currentPhotoCount >= lim.maxPhotosTotal) {
    return {
      allowed: false,
      needsUpgrade: plan === 'free',
      reason: plan === 'free'
        ? `Free plan = ${lim.maxPhotosTotal} photos. Upgrade for unlimited.`
        : 'Photo limit reached.',
    };
  }
  return { allowed: true };
}
