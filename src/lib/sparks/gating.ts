// Kaya Sparks · tier-aware feature gating.
//
// Module-level access (does this family have Sparks at all?) is handled
// by `<TierGate moduleId="sparks">` in the route layout — this module
// answers the FINER question: which Sparks features are available
// inside the granted module?
//
// Mapping locked 2026-05-27 (see the spec § 10):
//   Sparks Lite (free)   → Nest   — manual capture, 1 kid, 50-item cap, 30d ratings, no AI, no PDF
//   Sparks Family ($)    → Home   — AI scan, pre-submission highlights, ≤5 kids, full dashboard + PDF
//   Sparks Pro ($$)      → Castle — Family + coach sharing, multi-school, year-end portfolio
//
// Operators + closed-beta founding families are bypassed by
// `useTierAccess` (see `lib/tierAccess.ts`); they automatically see the
// Pro feature set. To check a SPECIFIC feature inside a component, call
// `useSparksFeatures()` and read the boolean.

'use client';

import { useMemo } from 'react';
import { useTierAccess } from '../tierAccess';
import type { SubscriptionTierId } from '../tiers';

export interface SparksFeatures {
  /** Which Sparks plan the family is on. Mirrors the live SubscriptionTier
   *  with a friendlier label for the UI. */
  plan: 'lite' | 'family' | 'pro';
  /** AI auto-label on photo upload + report-card / certificate OCR. */
  aiScan: boolean;
  /** Pre-submission AI highlights (handwriting / homework / art). */
  aiHighlights: boolean;
  /** Family roll-up tab on the dashboard (parent-only). */
  familyRollup: boolean;
  /** Beyond Lite's 1-kid limit. */
  multiKid: boolean;
  /** Items-per-kid cap. `null` = unlimited. */
  itemCap: number | null;
  /** Days of ratings history shown on the dashboard. `null` = unlimited. */
  historyDays: number | null;
  /** Term-PTM PDF export. */
  pdfExport: boolean;
  /** Coach / tutor shared view (Pro only). */
  coachShare: boolean;
  /** Year-end portfolio book PDF (Pro only). */
  yearEndPortfolio: boolean;
}

const FEATURES_BY_PLAN: Record<SparksFeatures['plan'], SparksFeatures> = {
  lite: {
    plan: 'lite',
    aiScan: false,
    aiHighlights: false,
    familyRollup: false,
    multiKid: false,
    itemCap: 50,
    historyDays: 30,
    pdfExport: false,
    coachShare: false,
    yearEndPortfolio: false,
  },
  family: {
    plan: 'family',
    aiScan: true,
    aiHighlights: true,
    familyRollup: true,
    multiKid: true,
    itemCap: null,
    historyDays: null,
    pdfExport: true,
    coachShare: false,
    yearEndPortfolio: false,
  },
  pro: {
    plan: 'pro',
    aiScan: true,
    aiHighlights: true,
    familyRollup: true,
    multiKid: true,
    itemCap: null,
    historyDays: null,
    pdfExport: true,
    coachShare: true,
    yearEndPortfolio: true,
  },
};

function planForTier(tierId: SubscriptionTierId): SparksFeatures['plan'] {
  switch (tierId) {
    case 'nest':   return 'lite';
    case 'home':   return 'family';
    case 'castle': return 'pro';
  }
}

/** Resolve the Sparks feature flags for the active family. Reads
 *  `useTierAccess()` for the live subscription tier + bypass state. */
export function useSparksFeatures(): SparksFeatures {
  const access = useTierAccess();
  return useMemo(() => {
    // Operator / founding-family bypass → highest tier features.
    if (access.isOperatorBypass || access.isFoundingBypass) {
      return FEATURES_BY_PLAN.pro;
    }
    return FEATURES_BY_PLAN[planForTier(access.tierId)];
  }, [access.tierId, access.isOperatorBypass, access.isFoundingBypass]);
}

/** Pure helper for non-hook callers (Cloud Functions, server actions).
 *  Takes a tierId directly instead of reading context. */
export function sparksFeaturesForTier(tierId: SubscriptionTierId): SparksFeatures {
  return FEATURES_BY_PLAN[planForTier(tierId)];
}
