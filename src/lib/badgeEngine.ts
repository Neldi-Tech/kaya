'use client';

// 🏅 Badge engine — client side (BDG PR2 · B7). The client only NOMINATES:
// it computes which released badges LOOK due from live data (the cheap
// signals) and asks /api/badges/mint to verify + mint each. The route
// re-checks everything server-side, so a wrong nomination just no-ops.
// Fire-and-forget: never blocks a page.

import type { User } from 'firebase/auth';
import type { Child } from './firestore';
import { familyBadgeSet, isBadgeReleased, badgeThreshold, type BadgeConfig } from './badgeLib';

/** Signals the client can pre-screen cheaply (PR2). PR3 hooks call the mint
 *  route directly from their own flows (quiz answer, award given, …). */
export function dueBadgeIds(cfg: BadgeConfig | undefined, child: Child): string[] {
  const earned = new Set(child.badges || []);
  const lifetime = Math.max(child.lifetimePoints || 0, child.totalPoints || 0);
  const out: string[] = [];
  for (const def of familyBadgeSet(cfg)) {
    if (earned.has(def.id) || !isBadgeReleased(cfg, def)) continue;
    const t = badgeThreshold(cfg, def);
    if (def.signal.kind === 'lifetime_points' && lifetime >= t) out.push(def.id);
    else if (def.signal.kind === 'streak_days' && (child.streak || 0) >= t) out.push(def.id);
  }
  return out;
}

/** Nominate every due badge for one kid. Safe to call often (idempotent). */
export async function sweepBadges(
  user: User,
  cfg: BadgeConfig | undefined,
  child: Child,
  /** Parents pass the kid's id; kids omit (the route uses their own). */
  childIdForParent?: string,
): Promise<void> {
  const due = dueBadgeIds(cfg, child);
  if (due.length === 0) return;
  try {
    const token = await user.getIdToken();
    await Promise.all(due.map((badgeId) =>
      fetch('/api/badges/mint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ badgeId, ...(childIdForParent ? { childId: childIdForParent } : {}) }),
      }).catch(() => {}),
    ));
  } catch { /* nominations are best-effort */ }
}
