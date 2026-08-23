// Per-family policy for how helper performance is computed (v3 —
// 2026-05-18). See PerformancePolicy in src/lib/firestore.ts for the
// shape + defaults. This module owns the read/subscribe/write paths
// and a few pure validators used by the settings UI.

'use client';

import {
  doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import {
  type PerformancePolicy, type PerformanceMetric,
  DEFAULT_PERFORMANCE_POLICY, DEFAULT_KID_REVIEW_SETTINGS,
} from './firestore';

const policyRef = (familyId: string) =>
  doc(db, 'families', familyId, 'performancePolicy', 'default');

/** Fetch the family's current policy. Returns the defaults when no
 *  doc has been written yet — getHelperPerformance + the settings
 *  page both treat the absence as "use the 25/25/25/25 baseline". */
export async function getPerformancePolicy(familyId: string): Promise<PerformancePolicy> {
  if (isGuestActive()) return DEFAULT_PERFORMANCE_POLICY;
  try {
    const snap = await getDoc(policyRef(familyId));
    if (!snap.exists()) return DEFAULT_PERFORMANCE_POLICY;
    return mergeWithDefaults(snap.data() as Partial<PerformancePolicy>);
  } catch {
    // Fail soft — perf surfaces should still render even if the
    // policy read errors. Defaults preserve today's behaviour.
    return DEFAULT_PERFORMANCE_POLICY;
  }
}

/** Live subscription — settings page uses this so two parents
 *  editing simultaneously see each other's changes. */
export function subscribeToPerformancePolicy(
  familyId: string,
  cb: (policy: PerformancePolicy) => void,
): () => void {
  if (isGuestActive()) {
    cb(DEFAULT_PERFORMANCE_POLICY);
    return () => {};
  }
  return onSnapshot(policyRef(familyId), (snap) => {
    if (!snap.exists()) { cb(DEFAULT_PERFORMANCE_POLICY); return; }
    cb(mergeWithDefaults(snap.data() as Partial<PerformancePolicy>));
  });
}

/** Patch-style update — caller passes only the fields they're
 *  changing. setDoc + merge so undefined fields stay untouched.
 *  Throws on validation failures so the settings UI can surface
 *  the inline error. */
export async function updatePerformancePolicy(
  familyId: string,
  patch: Partial<PerformancePolicy>,
  byUid: string,
): Promise<void> {
  if (isGuestActive()) return;
  if (patch.weights) {
    const err = validateWeights(patch.weights);
    if (err) throw new Error(err);
  }
  if (patch.thresholds) {
    const err = validateThresholds(patch.thresholds);
    if (err) throw new Error(err);
  }
  if (patch.windowDays != null) {
    const err = validateWindow(patch.windowDays);
    if (err) throw new Error(err);
  }
  await setDoc(policyRef(familyId), {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: byUid,
  }, { merge: true });
}

// ── Validators (pure — used by the settings UI live + the lib) ───

/** Weights must sum to 100 and each must be ≥ 0. */
export function validateWeights(weights: Record<PerformanceMetric, number>): string | null {
  // Legacy 4-metric maps (pre-HP2) — treat a missing kidReview as 0.
  const sum = METRICS.reduce((a, m) => a + (weights[m] ?? 0), 0);
  if (Object.values(weights).some((v) => v < 0)) return 'Weights cannot be negative.';
  if (Math.round(sum) !== 100) return `Weights must sum to 100 (currently ${Math.round(sum)}).`;
  return null;
}

/** Thresholds must be strictly decreasing and inside (0, 100]. */
export function validateThresholds(t: { excellent: number; good: number; okay: number }): string | null {
  if ([t.excellent, t.good, t.okay].some((v) => v <= 0 || v > 100)) {
    return 'Thresholds must be between 1 and 100.';
  }
  if (!(t.excellent > t.good && t.good > t.okay)) {
    return 'Thresholds must be ordered: Excellent > Good > Okay.';
  }
  return null;
}

/** Window must be at least 1 day, at most 90. */
export function validateWindow(days: number): string | null {
  if (!Number.isFinite(days) || days < 1 || days > 90) {
    return 'Window must be between 1 and 90 days.';
  }
  return null;
}

// ── HP2 (2026-08-23) — tracked / kids-review / min-age helpers ───

export const METRICS: PerformanceMetric[] = ['workplan', 'budget', 'ratingCompletion', 'parentFeedback', 'kidReview'];

/** D1 — is this helper's performance tracked at all? Default true. */
export function isHelperTracked(policy: PerformancePolicy | null | undefined, helperUid: string): boolean {
  return policy?.helperOverrides?.[helperUid]?.tracked !== false;
}

/** D9 — are assigned kids asked to review this helper weekly?
 *  Requires tracked; default true. */
export function isKidsReviewOn(policy: PerformancePolicy | null | undefined, helperUid: string): boolean {
  return isHelperTracked(policy, helperUid) && policy?.helperOverrides?.[helperUid]?.kidsReview !== false;
}

/** Validate the kid-review min age (3–12). */
export function validateMinAge(age: number): string | null {
  if (!Number.isInteger(age) || age < 3 || age > 12) return 'Minimum age must be between 3 and 12.';
  return null;
}

// ── Helpers used by getHelperPerformance ─────────────────────────

/** Resolve the effective weights for a single helper — applies any
 *  per-helper exclusions by zeroing those metrics, then re-scales
 *  the remaining weights so the total still equals 100. Returns the
 *  zero-weight metric set + the renormalised weight map. */
export function effectiveWeights(
  policy: PerformancePolicy,
  helperUid: string,
): { weights: Record<PerformanceMetric, number>; excluded: PerformanceMetric[] } {
  const excluded = policy.helperOverrides?.[helperUid]?.excludeMetrics ?? [];
  const base: Record<PerformanceMetric, number> = {
    ...DEFAULT_PERFORMANCE_POLICY.weights, ...policy.weights,
  };
  if (excluded.length === 0) return { weights: base, excluded: [] };
  const adjusted: Record<PerformanceMetric, number> = { ...base };
  for (const m of excluded) adjusted[m] = 0;
  const sum = Object.values(adjusted).reduce((a, b) => a + b, 0);
  if (sum === 0) {
    // All metrics excluded — return zeros so the consolidated score
    // resolves to null (no data).
    return { weights: adjusted, excluded };
  }
  // Re-normalise so non-excluded weights still sum to 100.
  for (const m of Object.keys(adjusted) as PerformanceMetric[]) {
    adjusted[m] = Math.round((adjusted[m] / sum) * 100);
  }
  return { weights: adjusted, excluded };
}

// ── Merge guard ──────────────────────────────────────────────────

/** Pad an incomplete persisted doc with defaults so callers can
 *  always rely on every nested field being present. */
function mergeWithDefaults(p: Partial<PerformancePolicy>): PerformancePolicy {
  return {
    weights: {
      workplan:         p.weights?.workplan         ?? DEFAULT_PERFORMANCE_POLICY.weights.workplan,
      budget:           p.weights?.budget           ?? DEFAULT_PERFORMANCE_POLICY.weights.budget,
      ratingCompletion: p.weights?.ratingCompletion ?? DEFAULT_PERFORMANCE_POLICY.weights.ratingCompletion,
      parentFeedback:   p.weights?.parentFeedback   ?? DEFAULT_PERFORMANCE_POLICY.weights.parentFeedback,
      kidReview:        p.weights?.kidReview        ?? DEFAULT_PERFORMANCE_POLICY.weights.kidReview,
    },
    thresholds: {
      excellent: p.thresholds?.excellent ?? DEFAULT_PERFORMANCE_POLICY.thresholds.excellent,
      good:      p.thresholds?.good      ?? DEFAULT_PERFORMANCE_POLICY.thresholds.good,
      okay:      p.thresholds?.okay      ?? DEFAULT_PERFORMANCE_POLICY.thresholds.okay,
    },
    windowDays:      p.windowDays ?? DEFAULT_PERFORMANCE_POLICY.windowDays,
    helperOverrides: p.helperOverrides ?? {},
    helpersSeeOwnScore: p.helpersSeeOwnScore ?? true,
    kidReview: {
      minAge:        p.kidReview?.minAge        ?? DEFAULT_KID_REVIEW_SETTINGS.minAge,
      emailOnSubmit: p.kidReview?.emailOnSubmit ?? DEFAULT_KID_REVIEW_SETTINGS.emailOnSubmit,
    },
    updatedAt:       p.updatedAt,
    updatedBy:       p.updatedBy,
  };
}
