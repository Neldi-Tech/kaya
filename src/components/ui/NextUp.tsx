// NextUp — page-bottom cross-link strip stitching the Kaya Core pages
// together. Each `from` page suggests the next habit (rate → award,
// meeting → reward, etc.) so families read the modules as a path
// instead of isolated rooms.
//
// 2026-06-07 layout fix (PR #1 of Sunday-Meeting v2 SDP):
// Old layout stacked the "Next up" eyebrow above the label inside a
// flex-1 column. On narrow phones the label wrapped to 2-3 lines and
// the Go pill drifted mid-stack ("outsize"). New layout is a single
// horizontal pill — inline "NEXT UP" tag + label (truncated) + Go —
// matching the approved Kaya-Sunday-Meeting v2 design proposal. The
// emoji shrinks on mobile so the label always has room, and a soft
// shadow lifts it off the page background.
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
      className="mt-6 rounded-kaya border border-brand-honey/35 px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-2.5 sm:gap-3 shadow-sm"
      style={{
        background:
          'linear-gradient(90deg, var(--brand-cream-warm, #F8EED4) 0%, white 100%)',
      }}
    >
      <span className="text-xl sm:text-2xl shrink-0" aria-hidden>
        {target.emoji}
      </span>
      {/* Inline row: NEXT UP tag · label. min-w-0 lets the label truncate
          instead of pushing the Go pill out / wrapping the whole strip. */}
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span className="shrink-0 text-[9.5px] sm:text-[10px] font-extrabold text-brand-honey-dk uppercase tracking-[0.12em] bg-white/70 border border-brand-honey/30 px-2 py-0.5 rounded-full leading-none">
          Next up
        </span>
        <span className="min-w-0 truncate text-[13px] sm:text-[14px] font-extrabold text-brand-navy leading-tight">
          {target.label}
        </span>
      </div>
      <Link
        href={target.href}
        className="bg-brand-honey hover:bg-brand-honey-dk text-brand-navy text-[12px] font-extrabold px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-full shrink-0 no-underline transition-colors whitespace-nowrap"
      >
        Go →
      </Link>
    </div>
  );
}
