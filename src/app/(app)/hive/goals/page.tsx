'use client';

// /hive/goals — list of active goals with a "+ Set a new goal" dashed
// card at the bottom. Per-goal progress, % complete and ETA come from
// GoalCard.

import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import GoalCard from '@/components/hive/GoalCard';
import KidSwitcher from '@/components/hive/KidSwitcher';
import BackButton from '@/components/ui/BackButton';

export default function GoalsPage() {
  const { goals, weeklyEarningsCents, config } = useHive();
  const active = goals.filter((g) => g.status === 'active');
  const done = goals.filter((g) => g.status === 'completed');

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Goals</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">What I&apos;m saving for</h1>
        </div>
      </div>

      <KidSwitcher />

      <div className="space-y-3">
        {active.map((g) => (
          <GoalCard
            key={g.id}
            goal={g}
            weeklyEarningsCents={weeklyEarningsCents}
            currency={config.currency}
          />
        ))}

        <Link
          href="/hive/goals/new"
          className="block rounded-hive-lg border-2 border-dashed border-hive-line p-5 text-center font-nunito font-extrabold text-[13px] text-hive-muted hover:border-hive-honey hover:text-hive-honey-dk transition-colors no-underline"
        >
          + Set a new goal
        </Link>
      </div>

      {done.length > 0 && (
        <>
          <h3 className="font-nunito font-extrabold text-[12px] uppercase tracking-[1.5px] text-hive-muted mt-6 mb-2">Reached ✓</h3>
          <div className="space-y-3 opacity-70">
            {done.map((g) => (
              <GoalCard
                key={g.id}
                goal={g}
                weeklyEarningsCents={weeklyEarningsCents}
                currency={config.currency}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
