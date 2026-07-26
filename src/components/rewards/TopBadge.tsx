'use client';

// 🏅 Top badge "wear" (BDG PR4 · B19) — a kid's proudest badge, shown next to
// their name. Highest tier wins; ties break on catalog order so the pick is
// stable, never random. Tap (or hover on desktop) tells you what it means —
// Elia's ask: "always show the top most badge in the kids profile, and once
// hovering around it it can tell the meaning".
//
// Pure display: reads the child's earned ids against the family's badge set.

import { useState } from 'react';
import { familyBadgeSet, BADGE_TIERS, TIER_RANK, type BadgeConfig, type BadgeDef } from '@/lib/badgeLib';

/** The badge a kid wears: highest tier they've earned, stable on ties. */
export function topBadgeFor(cfg: BadgeConfig | undefined, earned: string[] | undefined): BadgeDef | null {
  const ids = new Set(earned || []);
  if (ids.size === 0) return null;
  let best: BadgeDef | null = null;
  for (const def of familyBadgeSet(cfg)) {
    if (!ids.has(def.id)) continue;
    if (!best || TIER_RANK[def.tier] > TIER_RANK[best.tier]) best = def;
  }
  return best;
}

export default function TopBadge({
  cfg,
  earned,
  size = 'md',
  kidName,
}: {
  cfg: BadgeConfig | undefined;
  earned: string[] | undefined;
  size?: 'sm' | 'md' | 'lg';
  kidName?: string;
}) {
  const [open, setOpen] = useState(false);
  const def = topBadgeFor(cfg, earned);
  if (!def) return null;

  const tier = BADGE_TIERS[def.tier];
  const px = size === 'lg' ? 'text-[26px]' : size === 'sm' ? 'text-[15px]' : 'text-[20px]';

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={`${px} leading-none`}
        style={{ filter: 'drop-shadow(0 2px 6px rgba(240,163,42,.45))' }}
        aria-label={`Top badge: ${def.name}. ${def.how}`}
        title={`${def.name} — ${def.how}`}
      >
        {def.icon}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 left-1/2 -translate-x-1/2 top-full mt-1.5 w-52 rounded-xl px-3 py-2 text-left shadow-lg"
          style={{ background: 'linear-gradient(160deg,#241a0e,#3a2c15 60%,#4a3a1c)', border: '1px solid rgba(240,163,42,.45)' }}
        >
          <span className="block text-[11.5px] font-black" style={{ color: '#F0A32A' }}>
            {def.icon} {def.name}
          </span>
          <span className="block text-[10.5px] font-bold mt-0.5" style={{ color: '#f3e7c8' }}>
            {tier.emoji} {tier.label} · {def.how}
          </span>
          <span className="block text-[10px] mt-1" style={{ color: '#c9b789' }}>
            {kidName ? `${kidName}'s proudest badge` : 'Proudest badge'} — top tier earned so far.
          </span>
        </span>
      )}
    </span>
  );
}
