'use client';

// Lightweight placeholder used by the three Hive routes that don't have
// real screens yet (Quests, Insights, Convert). Each ships in a later PR;
// in the meantime tabbing to them shouldn't 404 or look broken.

import Link from 'next/link';

export default function ComingSoon({
  emoji,
  title,
  blurb,
  pr,
}: {
  emoji: string;
  title: string;
  blurb: string;
  /** "PR-Hive-B" etc. — the slice that ships this surface. */
  pr: string;
}) {
  return (
    <div className="mx-auto max-w-md w-full px-4 pt-16 lg:pt-24 text-center">
      <div className="text-6xl lg:text-7xl mb-4">{emoji}</div>
      <h2 className="font-nunito font-black text-3xl lg:text-4xl mb-2">{title}</h2>
      <p className="text-hive-muted text-sm lg:text-base mb-6 max-w-sm mx-auto">{blurb}</p>
      <span className="inline-block px-3 py-1.5 rounded-hive-pill bg-hive-honey-soft text-hive-honey-dk font-nunito font-extrabold text-[11px] mb-8">
        Coming in {pr}
      </span>
      <div className="flex justify-center gap-3">
        <Link href="/hive" className="px-4 py-2.5 rounded-hive-pill border border-hive-line text-[12px] font-nunito font-extrabold text-hive-navy no-underline hover:bg-hive-paper transition-colors">
          ← Back to Hive
        </Link>
      </div>
    </div>
  );
}
