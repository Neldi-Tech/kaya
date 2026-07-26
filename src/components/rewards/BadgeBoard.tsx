'use client';

// 🏆 Badge Board (BDG PR4 · B18) — the family leaderboard Elia asked for
// ("Badge leadership"): who has how many, what they're wearing, and how their
// collection splits across tiers. Ranked by weighted score (a 💎 legendary
// counts for more than a 🟢 easy) so chasing hard badges actually moves you,
// then by raw count.
//
// Reads only the child docs already in FamilyContext — no extra fetch.

import { useMemo } from 'react';
import { useFamily } from '@/contexts/FamilyContext';
import { familyBadgeSet, isBadgeReleased, BADGE_TIERS, TIER_RANK, type BadgeTier } from '@/lib/badgeLib';
import TopBadge from './TopBadge';

const TIER_WEIGHT: Record<BadgeTier, number> = { easy: 1, medium: 2, hard: 4, legendary: 8 };
const TIER_ORDER: BadgeTier[] = ['easy', 'medium', 'hard', 'legendary'];

export default function BadgeBoard({ highlightChildId }: { highlightChildId?: string | null }) {
  const { family, children } = useFamily();
  const cfg = family?.badgeConfig;

  const rows = useMemo(() => {
    const byId = new Map(familyBadgeSet(cfg).map((b) => [b.id, b]));
    const releasedTotal = familyBadgeSet(cfg).filter((b) => isBadgeReleased(cfg, b)).length;
    return children.map((c) => {
      const earned = (c.badges || []).map((id) => byId.get(id)).filter(Boolean) as NonNullable<ReturnType<typeof byId.get>>[];
      const perTier = TIER_ORDER.map((t) => ({ tier: t, n: earned.filter((b) => b.tier === t).length }));
      const score = earned.reduce((s, b) => s + TIER_WEIGHT[b.tier], 0);
      const best = earned.reduce<number>((m, b) => Math.max(m, TIER_RANK[b.tier]), -1);
      return { child: c, count: earned.length, perTier, score, best, releasedTotal };
    }).sort((a, b) => b.score - a.score || b.count - a.count || a.child.name.localeCompare(b.child.name));
  }, [cfg, children]);

  if (rows.length === 0) return null;
  const leaderScore = rows[0].score;
  const medal = ['🥇', '🥈', '🥉'];

  return (
    <div className="bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5">
      <div className="flex items-baseline justify-between gap-3 mb-3">
        <p className="font-display text-[15px] lg:text-base font-black">🏆 Badge Board</p>
        <p className="text-[10.5px] text-kaya-sand font-semibold">
          Harder badges count for more
        </p>
      </div>

      <ul className="space-y-2.5">
        {rows.map((r, i) => (
          <li
            key={r.child.id}
            className={`rounded-kaya p-3 border ${
              highlightChildId === r.child.id ? 'border-kaya-gold/60 bg-kaya-gold/5' : 'border-kaya-warm-dark/50 bg-kaya-warm/25'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <span className="text-[15px] w-6 shrink-0 text-center">{medal[i] || `${i + 1}.`}</span>
              <span className="text-lg shrink-0">{r.child.avatarEmoji || '🧒'}</span>
              <p className="text-[13px] font-bold truncate flex-1 flex items-center gap-1.5">
                {r.child.name.split(' ')[0]}
                <TopBadge cfg={cfg} earned={r.child.badges} size="sm" kidName={r.child.name.split(' ')[0]} />
              </p>
              <span className="text-[12px] font-black tabular-nums shrink-0" style={{ color: r.child.houseColor }}>
                {r.count}<span className="text-[10px] text-kaya-sand font-semibold"> / {r.releasedTotal}</span>
              </span>
            </div>

            {/* Score bar — relative to the family's leader */}
            <div className="mt-2 h-1.5 rounded-full bg-kaya-warm-dark/50 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${leaderScore > 0 ? Math.round((r.score / leaderScore) * 100) : 0}%`, backgroundColor: r.child.houseColor }}
              />
            </div>

            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
              {r.perTier.filter((t) => t.n > 0).map((t) => (
                <span key={t.tier} className="text-[10.5px] font-bold text-kaya-sand">
                  {BADGE_TIERS[t.tier].emoji} {t.n} {BADGE_TIERS[t.tier].label.toLowerCase()}
                </span>
              ))}
              {r.count === 0 && (
                <span className="text-[10.5px] font-bold text-kaya-sand">No badges yet — the chase is open 🧭</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
