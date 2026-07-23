'use client';

// 🧞 Wish Jar (CASH UPGRADE, design §5) — the kid's pinned wish with a
// progress ring measured against the Honey Pot. When the Pot can cover the
// wish, one tap pre-loads a withdrawal for exactly that amount.

import Link from 'next/link';
import type { Goal } from '@/lib/hive';
import { formatCash } from './format';

export default function WishJar({
  goal,
  potCents,
  weeklyEarningsCents,
  currency,
}: {
  goal: Goal;
  /** The kid's Honey Pot balance — the jar fills from banked money. */
  potCents: number;
  weeklyEarningsCents: number;
  currency: string;
}) {
  const target = Math.max(1, goal.targetAmount);
  const pct = Math.max(0, Math.min(100, Math.round((potCents / target) * 100)));
  const ready = potCents >= target;
  const remaining = Math.max(0, target - potCents);
  const weeks = weeklyEarningsCents > 0 ? Math.ceil(remaining / weeklyEarningsCents) : null;

  return (
    <div className="mb-3 rounded-hive-lg border-2 border-hive-line bg-hive-paper p-4 flex items-center gap-4">
      <div
        className="w-[86px] h-[86px] rounded-full shrink-0 flex items-center justify-center"
        style={{ background: `conic-gradient(#F39C2F 0% ${pct}%, #F0E6D2 ${pct}% 100%)` }}
        role="img"
        aria-label={`${pct}% saved toward ${goal.title}`}
      >
        <div className="w-[64px] h-[64px] rounded-full bg-hive-cream flex flex-col items-center justify-center">
          <span className="text-[15px] leading-none">{goal.icon || '🧞'}</span>
          <span className="font-nunito font-black text-[14px] leading-tight">{pct}%</span>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">🧞 Wish Jar</p>
        <p className="font-nunito font-black text-[15px] leading-tight mt-0.5 truncate">
          {goal.title} · {formatCash(target, currency)}
        </p>
        {ready ? (
          <>
            <p className="text-[12px] text-hive-green font-bold mt-0.5">Your wish is ready! 🎉</p>
            <Link
              href={`/hive/withdraw?amount=${(target / 100).toString()}&for=${encodeURIComponent(`My wish: ${goal.title} ${goal.icon || '🧞'}`)}`}
              className="inline-block mt-1.5 px-3.5 py-1.5 rounded-hive-pill bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-extrabold text-[12px] no-underline transition-colors"
            >
              🏧 Withdraw for my wish
            </Link>
          </>
        ) : (
          <p className="text-[12px] text-hive-muted font-bold mt-0.5">
            {formatCash(remaining, currency)} to go
            {weeks !== null && weeks > 0 && <> — about {weeks} more week{weeks === 1 ? '' : 's'} 🚀</>}
          </p>
        )}
      </div>
    </div>
  );
}
