// Budget Health Score (2026-06-15) — surprise #1.
//
// A single 0-100 glanceable read of how the household is tracking against
// its caps for the selected range. Pace-aware: a month seen half-way
// through is judged against half its cap, not the full cap. Over-cap
// modules pull the score down. Pure + deterministic.

export interface BudgetHealth {
  /** 0-100, or 0 with grade '—' when no caps are set. */
  score: number;
  grade: string;   // A / B+ / B / C / D / E / —
  label: string;   // Healthy / On track / Watch / Over pace / No caps set
  reason: string;  // one-line plain-language explanation
  hasCaps: boolean;
}

export function budgetHealth(
  spentCents: number,
  capCents: number,
  fractionElapsed: number,
  overModules: number,
): BudgetHealth {
  if (capCents <= 0) {
    return {
      score: 0, grade: '—', label: 'No caps set', hasCaps: false,
      reason: 'Set module caps in /pantry/budget to unlock a health score.',
    };
  }
  const expected = capCents * Math.max(0.02, Math.min(1, fractionElapsed));
  const ratio = spentCents / Math.max(1, expected);
  // On/under pace ⇒ 100; over pace falls off ~80 pts per 1× over expected.
  const paceScore = ratio <= 1 ? 100 : Math.max(20, Math.round(100 - (ratio - 1) * 80));
  const score = Math.max(5, Math.min(100, paceScore - overModules * 8));

  const grade = score >= 90 ? 'A' : score >= 80 ? 'B+' : score >= 70 ? 'B'
    : score >= 60 ? 'C' : score >= 50 ? 'D' : 'E';
  const label = score >= 78 ? 'Healthy' : score >= 62 ? 'On track'
    : score >= 45 ? 'Watch' : 'Over pace';
  const usedPct = Math.round((spentCents / capCents) * 100);
  const reason = overModules > 0
    ? `${overModules} bucket${overModules > 1 ? 's' : ''} over cap · ${usedPct}% of caps used`
    : ratio <= 1
      ? `On or under pace · ${usedPct}% of caps used`
      : `Spending ahead of pace · ${usedPct}% of caps used`;
  return { score, grade, label, reason, hasCaps: true };
}
