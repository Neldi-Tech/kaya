'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { sweepBadges, nextMilestones } from '@/lib/badgeEngine';
import {
  familyBadgeSet, isBadgeReleased, badgeProgress, BADGE_AREAS, BADGE_TIERS, TIER_RANK,
  type BadgeArea, type BadgeDef,
} from '@/lib/badgeLib';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';
import BadgeHistory from '@/components/rewards/BadgeHistory';
import BadgeBoard from '@/components/rewards/BadgeBoard';
import TopBadge from '@/components/rewards/TopBadge';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function BadgesPage() {
  const { user, profile } = useAuth();
  const { family, children } = useFamily();
  const [selectedChild, setSelectedChild] = useState(0);
  const [area, setArea] = useState<BadgeArea | 'all'>('all');

  const child = children[selectedChild];
  const cfg = family?.badgeConfig;
  const earnedBadges = child?.badges || [];
  // A kid viewer is pinned to their own history by the route anyway; parents
  // read the history of whichever kid is selected above.
  const isKidViewer = profile?.role === 'kid';

  // 🏅 BDG PR3 (B12) — the kid sees the family's OWN badge set: the released
  // slice of the all-Kaya catalog, in Boutique order (area → tier → name).
  const released = useMemo(() => {
    const set = familyBadgeSet(cfg).filter((b) => isBadgeReleased(cfg, b));
    const areaRank = new Map(BADGE_AREAS.map((a, i) => [a.id, i]));
    return set.sort((a, b) =>
      (areaRank.get(a.area) ?? 99) - (areaRank.get(b.area) ?? 99)
      || TIER_RANK[a.tier] - TIER_RANK[b.tier]
      || a.name.localeCompare(b.name));
  }, [cfg]);

  const earnedCount = released.filter((b) => earnedBadges.includes(b.id)).length;
  const shown = area === 'all' ? released : released.filter((b) => b.area === area);
  // Only offer area chips the family actually has badges in.
  const liveAreas = BADGE_AREAS.filter((a) => released.some((b) => b.area === a.id));

  // 🧭 BDG PR3 (B14) — Kaya Badge advisory: what's closest right now.
  const milestones = useMemo(
    () => (child ? nextMilestones(cfg, child, 3) : []),
    [cfg, child],
  );

  // 🏅 BDG PR2 (B6/B7) — the sweep: nominate every badge that looks due for
  // the kid on screen; the server verifies + mints (idempotent). This is what
  // finally unlocks First Star & co. for kids who earned them long ago.
  const counterKey = JSON.stringify(child?.badgeCounters || {});
  useEffect(() => {
    if (!user || !child) return;
    const isKid = profile?.role === 'kid';
    if (isKid && profile?.childId !== child.id) return;
    void sweepBadges(user, family?.badgeConfig, child, isKid ? undefined : child.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, child?.id, child?.totalPoints, child?.streak, (child?.badges || []).join(','), counterKey]);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-5xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>

      <div className="mb-5 lg:mb-7 flex items-end justify-between gap-6">
        <div>
          <h1 className="font-display text-2xl lg:text-[34px] font-black lg:font-extrabold tracking-tight">Badges</h1>
          <p className="text-kaya-sand text-sm mt-0.5 lg:mt-1">Milestones and achievements per kid.</p>
        </div>
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 lg:mb-6 overflow-x-auto pb-1">
        {children.map((c, i) => {
          const sel = selectedChild === i;
          return (
            <button
              key={c.id}
              onClick={() => setSelectedChild(i)}
              className={`flex items-center gap-2 px-4 py-2 lg:py-2.5 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
                sel ? 'text-white border-transparent shadow-sm' : 'border-kaya-warm-dark bg-white text-kaya-sand hover:border-kaya-sand-light'
              }`}
              style={sel ? { backgroundColor: c.houseColor } : {}}
            >
              <span>{c.avatarEmoji}</span>{c.name}
            </button>
          );
        })}
      </div>

      {/* Worn badge — mobile gets its own line (the desktop banner shows it
          beside the name). Tap it for what it means. */}
      {child && (
        <div className="lg:hidden flex items-center gap-2 mb-3">
          <span className="text-[12.5px] font-bold text-kaya-sand">{child.name.split(' ')[0]} is wearing</span>
          <TopBadge cfg={cfg} earned={child.badges} kidName={child.name.split(' ')[0]} />
          {(child.badges || []).length === 0 && (
            <span className="text-[12px] text-kaya-sand">nothing yet — first badge coming 🧭</span>
          )}
        </div>
      )}

      {/* Stats banner */}
      {child && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 lg:p-5 mb-5 lg:mb-6 grid grid-cols-3 lg:grid-cols-4 gap-3 lg:gap-4 items-center">
          <div className="hidden lg:flex items-center gap-3 col-span-1">
            <KidAvatar child={child} size="lg" shape="square" />
            <div>
              <p className="font-display font-bold text-base flex items-center gap-1.5">
                {child.name}
                <TopBadge cfg={cfg} earned={child.badges} kidName={child.name.split(' ')[0]} />
              </p>
              <p className="text-[11px] text-kaya-sand">{child.houseName} House</p>
            </div>
          </div>
          <div className="text-center lg:text-left">
            <p className="text-2xl lg:text-3xl font-display font-black" style={{ color: child.houseColor }}>{fmt(child.totalPoints || 0)}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase tracking-wider">Total points</p>
          </div>
          <div className="text-center lg:text-left">
            <p className="text-2xl lg:text-3xl font-display font-black">{child.streak || 0}<span className="text-base ml-0.5">🔥</span></p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase tracking-wider">Day streak</p>
          </div>
          <div className="text-center lg:text-left">
            <p className="text-2xl lg:text-3xl font-display font-black">{earnedCount}<span className="text-base text-kaya-sand font-semibold ml-1">/ {released.length}</span></p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase tracking-wider">Badges</p>
          </div>
        </div>
      )}

      {/* 🧭 Kaya Badge — the advisory voice: what's closest to unlocking */}
      {child && milestones.length > 0 && (
        <div
          className="rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5 mb-5 lg:mb-6 border"
          style={{ background: 'linear-gradient(160deg,#241a0e,#3a2c15 55%,#4a3a1c)', borderColor: 'rgba(240,163,42,.45)' }}
        >
          <div className="flex items-center gap-2 mb-3">
            <span className="text-lg">🧭</span>
            <div>
              <p className="text-[13px] font-black" style={{ color: '#F0A32A' }}>Kaya Badge</p>
              <p className="text-[11px] font-semibold" style={{ color: '#d9c89a' }}>
                {child.name}, here&apos;s what you&apos;re closest to earning
              </p>
            </div>
          </div>
          <div className="space-y-2.5">
            {milestones.map((m) => (
              <div key={m.def.id} className="flex items-center gap-3">
                <span className="text-xl shrink-0">{m.def.icon}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[12.5px] font-bold truncate" style={{ color: '#f3e7c8' }}>{m.def.name}</p>
                    <p className="text-[11px] font-black tabular-nums shrink-0" style={{ color: '#F0A32A' }}>
                      {fmt(m.need - m.have)} to go
                    </p>
                  </div>
                  <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,.15)' }}>
                    <div className="h-full rounded-full" style={{ width: `${m.pct}%`, background: '#F0A32A' }} />
                  </div>
                  <p className="mt-1 text-[10.5px]" style={{ color: '#c9b789' }}>{m.def.how} · {fmt(m.have)} / {fmt(m.need)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Area filter — only the areas this family has released */}
      {liveAreas.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          <button
            onClick={() => setArea('all')}
            className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap border transition-all ${
              area === 'all' ? 'bg-kaya-gold text-white border-transparent' : 'bg-white border-kaya-warm-dark text-kaya-sand'
            }`}
          >
            All {released.length}
          </button>
          {liveAreas.map((a) => (
            <button
              key={a.id}
              onClick={() => setArea(a.id)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap border transition-all ${
                area === a.id ? 'bg-kaya-gold text-white border-transparent' : 'bg-white border-kaya-warm-dark text-kaya-sand'
              }`}
            >
              {a.emoji} {a.label}
            </button>
          ))}
        </div>
      )}

      {/* Badge grid — one card shape for every badge, earned or chasing */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        {shown.map((badge: BadgeDef) => {
          const earned = earnedBadges.includes(badge.id);
          const p = child ? badgeProgress(cfg, badge, child) : null;
          return (
            <div
              key={badge.id}
              className={`rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5 text-center border transition-all ${
                earned
                  ? 'bg-white border-kaya-gold/40 shadow-sm'
                  : 'bg-kaya-warm/40 border-kaya-warm-dark/60'
              }`}
            >
              <div className={`text-3xl lg:text-4xl mb-2 lg:mb-3 ${earned ? '' : 'grayscale opacity-70'}`}>{badge.icon}</div>
              <p className="text-sm lg:text-[15px] font-bold mb-0.5">{badge.name}</p>
              <p className="text-[11px] lg:text-xs text-kaya-sand leading-tight">{badge.how}</p>
              <p className="mt-1.5 text-[9.5px] font-bold text-kaya-sand uppercase tracking-wider">
                {BADGE_TIERS[badge.tier].emoji} {BADGE_TIERS[badge.tier].label}
              </p>
              {earned ? (
                <div className="mt-3 text-[10px] font-bold text-kaya-gold uppercase tracking-wider">✓ Earned</div>
              ) : p ? (
                <div className="mt-3">
                  <div className="h-1.5 rounded-full bg-kaya-warm-dark/50 overflow-hidden">
                    <div className="h-full rounded-full bg-kaya-gold" style={{ width: `${p.pct}%` }} />
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-kaya-sand tabular-nums">{fmt(p.have)} / {fmt(p.need)}</p>
                </div>
              ) : (
                <div className="mt-3 text-[10px] font-bold text-kaya-sand uppercase tracking-wider">Locked</div>
              )}
            </div>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="text-center text-sm text-kaya-sand py-10">
          No badges released in this area yet — a parent can open them in Manage Rewards → 🏬 Badge Boutique.
        </p>
      )}

      {/* 📜 Badge history — every badge ever earned, with its date. A kid sees
          their own; a parent sees the family with per-kid filters. */}
      <div className="mt-6 lg:mt-8 bg-white border border-kaya-warm-dark rounded-kaya lg:rounded-kaya-lg p-4 lg:p-5">
        <p className="font-display text-[15px] lg:text-base font-black mb-1">📜 Badge history</p>
        <p className="text-[11.5px] text-kaya-sand mb-2">
          {isKidViewer
            ? 'Every badge you have ever earned, with the day it landed.'
            : 'Every badge the family has ever earned, with the day it landed.'}
        </p>
        <BadgeHistory childId={isKidViewer ? null : child?.id ?? null} />
      </div>

      {/* 🏆 Badge Board — family standings */}
      {children.length > 1 && (
        <div className="mt-4 lg:mt-5 mb-6">
          <BadgeBoard highlightChildId={child?.id ?? null} />
        </div>
      )}
    </div>
  );
}
