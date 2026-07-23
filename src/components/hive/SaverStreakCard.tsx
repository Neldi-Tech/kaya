'use client';

// 🔥 Saver Streak card (CASH UPGRADE, design §5). Shows the flame run,
// progress to the next milestone, and mints the real Kaya badge (into
// child.badges, shown on /badges) the moment a milestone is crossed.

import { useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { computeSaverStreak, SAVER_MILESTONES } from '@/lib/saverStreak';
import { updateChild, type Child } from '@/lib/firestore';

export default function SaverStreakCard({ child }: { child: Child | undefined }) {
  const { profile } = useAuth();
  const { transactions } = useHive();
  const streak = useMemo(() => computeSaverStreak(transactions), [transactions]);

  // Mint crossed milestones as real badges — idempotent (skips ones already
  // on the child), best-effort (a failed write never breaks the Hive home).
  useEffect(() => {
    if (!profile?.familyId || !child?.id || streak.weeks <= 0) return;
    const earned = child.badges || [];
    const due = SAVER_MILESTONES
      .filter((m) => streak.weeks >= m.weeks && !earned.includes(m.badgeId))
      .map((m) => m.badgeId);
    if (due.length === 0) return;
    updateChild(profile.familyId, child.id, { badges: [...earned, ...due] }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.familyId, child?.id, streak.weeks, (child?.badges || []).join(',')]);

  if (streak.weeks <= 0) return null;

  const next = SAVER_MILESTONES.find((m) => streak.weeks < m.weeks);
  const flames = '🔥'.repeat(Math.min(streak.weeks, 5));
  const belowRateNow = streak.currentRate !== null && streak.currentRate < 0.5;

  return (
    <div className="mb-3 rounded-hive-lg border-2 border-hive-line bg-hive-paper p-4 flex items-center gap-3">
      <div className="text-[26px] leading-none shrink-0">{flames}</div>
      <div className="flex-1 min-w-0">
        <p className="font-nunito font-black text-[15px] leading-tight">
          {streak.weeks}-week saver streak!
        </p>
        <p className="text-[12px] text-hive-muted font-bold mt-0.5">
          {belowRateNow
            ? 'Careful — this week is under 50% saved. A little more banking keeps the flame 🔥'
            : next
              ? <>Save ≥ 50% each week · badge progress: {next.emoji} {streak.weeks}/{next.weeks}</>
              : 'Gold Saver — the bees bow to you 🥇🐝'}
        </p>
      </div>
      <div className="flex gap-1 shrink-0">
        {SAVER_MILESTONES.map((m) => (
          <span
            key={m.badgeId}
            title={`${m.name} · ${m.weeks} weeks`}
            className={`text-[16px] ${streak.weeks >= m.weeks ? '' : 'opacity-25 grayscale'}`}
          >
            {m.emoji}
          </span>
        ))}
      </div>
    </div>
  );
}
