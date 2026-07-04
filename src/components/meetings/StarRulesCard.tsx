'use client';

// 📜 How the ⭐ Star is chosen (SM3.1 · #3) — the OPEN rules card. It sits
// right on the podium reveal (and the review explainer) so kids can read
// exactly how to win next week. Numbers mirror STAR_WEIGHTS /
// STAR_QUALIFY_FRACTION in lib/meetingReview — change them there, this
// card follows.

import { STAR_WEIGHTS, STAR_QUALIFY_FRACTION } from '@/lib/meetingReview';

export default function StarRulesCard({ activeDays, daysNeeded }: {
  /** Distinct rated days in the current window — shown so the threshold is concrete. */
  activeDays?: number;
  /** Days a kid must have been rated to qualify in this window. */
  daysNeeded?: number;
}) {
  const pct = Math.round(STAR_QUALIFY_FRACTION * 100);
  return (
    <div className="rounded-kaya border border-dashed border-kaya-gold/50 bg-kaya-gold/[0.06] p-4 text-left">
      <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-gold mb-2">
        📜 How the Star is chosen — open rules
      </p>
      <ul className="space-y-1.5 text-[12.5px] lg:text-[13.5px] text-white/85">
        <li>
          🌟 Excellent = <b>+{STAR_WEIGHTS.excellent}</b> · 👍 Good = <b>+{STAR_WEIGHTS.good}</b> · 👎 Bad = <b>−{Math.abs(STAR_WEIGHTS.bad)}</b>
        </li>
        <li>Your <b>Star Score</b> adds up across the whole selected timeframe.</li>
        <li>
          You qualify by being rated on <b>most days ({pct}%+)</b>
          {typeof daysNeeded === 'number' && typeof activeDays === 'number'
            ? <> — this window that&rsquo;s <b>{daysNeeded} of {activeDays}</b> rated days</>
            : null}
          . Fair to everyone — nobody wins by being away.
        </li>
        <li>Tie? <b>Fewer Bads</b> wins · still tied? You <b>share the step</b> 🤝</li>
      </ul>
    </div>
  );
}
