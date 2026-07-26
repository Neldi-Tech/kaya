'use client';

// 🏅 Badge engine — client side (BDG PR2 · B7). The client only NOMINATES:
// it computes which released badges LOOK due from live data (the cheap
// signals) and asks /api/badges/mint to verify + mint each. The route
// re-checks everything server-side, so a wrong nomination just no-ops.
// Fire-and-forget: never blocks a page.

import type { User } from 'firebase/auth';
import type { Child } from './firestore';
import {
  familyBadgeSet, isBadgeReleased, badgeProgress, isBadgeInSeason, areaCollection,
  type BadgeConfig, type BadgeDef,
} from './badgeLib';

/** The caller's LOCAL day key — day boundaries are never read as UTC. */
export function localTodayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Every released badge whose measurable progress has reached its threshold.
 *  Since BDG PR3 that covers points, streaks AND every counter-tracked area
 *  (quiz, awards, meetings, workplan, conversions, family goals); PR5 adds
 *  the 💎 area Collectors. All of it readable off the child doc, and all of
 *  it re-verified at mint. */
export function dueBadgeIds(cfg: BadgeConfig | undefined, child: Child): string[] {
  const earned = new Set(child.badges || []);
  const today = localTodayKey();
  const out: string[] = [];
  for (const def of familyBadgeSet(cfg)) {
    if (earned.has(def.id) || !isBadgeReleased(cfg, def)) continue;
    // 🎁 out-of-season pack badges aren't nominated (and would be refused).
    if (!isBadgeInSeason(def.id, today)) continue;
    if (def.signal.kind === 'area_complete') {
      if (areaCollection(cfg, def.signal.area, child.badges).complete) out.push(def.id);
      continue;
    }
    const p = badgeProgress(cfg, def, child);
    if (p && p.have >= p.need) out.push(def.id);
  }
  return out;
}

/** 🧭 Kaya Badge advisory — the closest unearned badges, nearest first.
 *  Only badges Kaya can measure and the family has released. */
export function nextMilestones(
  cfg: BadgeConfig | undefined,
  child: Child,
  count = 3,
): Array<{ def: BadgeDef; have: number; need: number; pct: number }> {
  const earned = new Set(child.badges || []);
  const rows: Array<{ def: BadgeDef; have: number; need: number; pct: number }> = [];
  for (const def of familyBadgeSet(cfg)) {
    if (earned.has(def.id) || !isBadgeReleased(cfg, def)) continue;
    const p = badgeProgress(cfg, def, child);
    if (!p || p.have >= p.need) continue; // already due — the sweep mints it
    rows.push({ def, ...p });
  }
  // Nearest by remaining distance, then by how far along it already is.
  rows.sort((a, b) => (a.need - a.have) - (b.need - b.have) || b.pct - a.pct);
  return rows.slice(0, count);
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
        body: JSON.stringify({
          badgeId,
          todayKey: localTodayKey(),
          ...(childIdForParent ? { childId: childIdForParent } : {}),
        }),
      }).catch(() => {}),
    ));
  } catch { /* nominations are best-effort */ }
}
