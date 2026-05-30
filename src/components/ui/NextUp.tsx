// NextUp — page-bottom cross-link strip stitching the Kaya Core pages
// together. Each `from` page suggests the next habit (rate → award,
// meeting → reward, etc.) so families read the modules as a path
// instead of isolated rooms.
//
// Server-component-safe (no client state) — just markup + a Link.

import Link from 'next/link';

export type NextUpFrom =
  | 'rate'
  | 'award'
  | 'rewards'
  | 'meetings'
  | 'hive'
  | 'moments';

type NextUpTarget = {
  emoji: string;
  label: string;
  href: string;
};

const NEXT_UP_MAP: Record<NextUpFrom, NextUpTarget> = {
  rate: {
    emoji: '🎖️',
    label: 'Catch a kindness today',
    href: '/award',
  },
  award: {
    emoji: '👨‍👩‍👧‍👦',
    label: 'Plan a quick Sunday meeting',
    href: '/meetings',
  },
  rewards: {
    emoji: '📋',
    label: "Rate today's routines",
    href: '/rate',
  },
  meetings: {
    emoji: '🎁',
    label: 'Set up a reward — so points mean something',
    href: '/parent/rewards?wizard=1',
  },
  hive: {
    emoji: '🎁',
    label: 'Manage what kids can earn',
    href: '/parent/rewards',
  },
  moments: {
    emoji: '🎖️',
    label: 'Catch a kindness',
    href: '/award',
  },
};

export default function NextUp({ from }: { from: NextUpFrom }) {
  const target = NEXT_UP_MAP[from];
  return (
    <div
      className="mt-6 rounded-kaya border border-brand-honey/35 px-4 py-3 sm:px-5 sm:py-3.5 flex items-center gap-3 sm:gap-4"
      style={{
        background:
          'linear-gradient(90deg, var(--brand-cream-warm, #F8EED4) 0%, white 100%)',
      }}
    >
      <span className="text-2xl shrink-0" aria-hidden>
        {target.emoji}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[10.5px] font-extrabold text-brand-honey-dk uppercase tracking-[0.1em] leading-none">
          Next up
        </div>
        <div className="text-[13.5px] sm:text-[14px] font-extrabold text-brand-navy mt-0.5 leading-snug">
          {target.label}
        </div>
      </div>
      <Link
        href={target.href}
        className="bg-brand-honey hover:bg-brand-honey-dk text-brand-navy text-[12px] font-extrabold px-3.5 py-2 rounded-full shrink-0 no-underline transition-colors whitespace-nowrap"
      >
        Go →
      </Link>
    </div>
  );
}
