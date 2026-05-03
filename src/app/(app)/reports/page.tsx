'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, DailyRating, Award } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';
import KidAvatar from '@/components/ui/KidAvatar';

const fmt = (n: number) => n.toLocaleString('en-US');

export default function ReportsPage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [range, setRange] = useState(7);

  useEffect(() => {
    if (!profile?.familyId) return;
    Promise.all([
      getRecentRatings(profile.familyId, range),
      getRecentAwards(profile.familyId, range),
    ]).then(([r, a]) => { setRatings(r); setAwards(a); });
  }, [profile?.familyId, range]);

  // Build a date list for the selected range (oldest → today).
  const today = new Date();
  const dateList = Array.from({ length: range }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (range - 1 - i));
    return d.toISOString().slice(0, 10);
  });

  const childStats = children.map((child) => {
    const childRatings = ratings.filter((r) => r.childId === child.id);
    const childAwards = awards.filter((a) => a.childId === child.id);
    const routinePoints = childRatings.reduce((s, r) => s + r.totalPoints, 0);
    const awardPoints = childAwards.reduce((s, a) => s + a.points, 0);
    const totalDays = new Set(childRatings.map((r) => r.date)).size;

    // Daily totals (routine + award) for the bar chart.
    const dailyTotals = dateList.map((date) => {
      const r = childRatings.filter((x) => x.date === date).reduce((s, x) => s + x.totalPoints, 0);
      const a = childAwards.filter((x) => x.createdAt?.toDate?.()?.toISOString?.()?.slice(0, 10) === date)
        .reduce((s, x) => s + x.points, 0);
      return { date, routine: r, award: a, total: r + a };
    });
    const peakDay = Math.max(1, ...dailyTotals.map((d) => d.total));

    return {
      child, routinePoints, awardPoints, totalDays,
      total: routinePoints + awardPoints,
      dailyTotals, peakDay,
    };
  });

  // Family-level totals.
  const familyTotals = childStats.reduce(
    (acc, s) => ({
      total:   acc.total   + s.total,
      routine: acc.routine + s.routinePoints,
      award:   acc.award   + s.awardPoints,
      days:    Math.max(acc.days, s.totalDays),
    }),
    { total: 0, routine: 0, award: 0, days: 0 },
  );
  const top = [...childStats].sort((a, b) => b.total - a.total)[0];

  // ── Range toggle (shared) ─────────────────────────────────
  const RangeToggle = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
    <div className={`flex gap-2 ${size === 'lg' ? '' : ''}`}>
      {[7, 14, 30].map((d) => (
        <button
          key={d}
          onClick={() => setRange(d)}
          className={`${size === 'lg' ? 'h-10 px-4 text-[13px]' : 'flex-1 h-9 text-xs'} rounded-kaya-sm font-semibold transition-colors ${
            range === d ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
          }`}
        >
          {d} days
        </button>
      ))}
    </div>
  );

  return (
    <>
      {/* ─────────────────────────────────────────────────────────── */}
      {/* MOBILE (< lg) — preserved                                    */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <BackButton />
        <div className="mb-5">
          <h1 className="font-display text-2xl font-black">Reports</h1>
          <p className="text-kaya-sand text-sm">Performance insights</p>
        </div>

        <div className="mb-5"><RangeToggle /></div>

        {childStats.map(({ child, routinePoints, awardPoints, totalDays, total }) => (
          <div key={child.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
            <div className="flex items-center gap-3 mb-3">
              <KidAvatar child={child} size="md" bgOpacity="20" />
              <div className="flex-1">
                <p className="font-bold text-sm">{child.name}</p>
                <p className="text-xs text-kaya-sand">{child.houseName}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-display font-black" style={{ color: child.houseColor }}>{fmt(total)}</p>
                <p className="text-[10px] text-kaya-sand">points earned</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                <p className="text-sm font-bold">{fmt(routinePoints)}</p>
                <p className="text-[10px] text-kaya-sand">Routine</p>
              </div>
              <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                <p className="text-sm font-bold">{fmt(awardPoints)}</p>
                <p className="text-[10px] text-kaya-sand">Awards</p>
              </div>
              <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                <p className="text-sm font-bold">{totalDays}</p>
                <p className="text-[10px] text-kaya-sand">Days Rated</p>
              </div>
            </div>

            <div className="h-2 bg-kaya-warm rounded-full overflow-hidden flex">
              {routinePoints > 0 && (
                <div className="h-full" style={{ width: `${(routinePoints / Math.max(total, 1)) * 100}%`, backgroundColor: child.houseColor }} />
              )}
              {awardPoints > 0 && (
                <div className="h-full bg-kaya-gold" style={{ width: `${(awardPoints / Math.max(total, 1)) * 100}%` }} />
              )}
            </div>
            <div className="flex gap-4 mt-1.5">
              <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: child.houseColor }} /> Routine
              </span>
              <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                <span className="w-2 h-2 rounded-full bg-kaya-gold" /> Awards
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ─────────────────────────────────────────────────────────── */}
      {/* DESKTOP (lg+) — family summary + grid + per-day bars         */}
      {/* ─────────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        <div className="flex items-end justify-between gap-6 mb-7">
          <div>
            <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">Reports</h1>
            <p className="text-sm text-kaya-sand mt-1">Performance across the last {range} days.</p>
          </div>
          <RangeToggle size="lg" />
        </div>

        {/* Family summary */}
        <div className="grid grid-cols-12 gap-4 mb-8">
          <div className="col-span-3 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya-lg p-5 text-white relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
            <div className="relative">
              <p className="text-kaya-gold text-[11px] font-bold uppercase tracking-[0.14em]">Family total</p>
              <p className="font-display font-black text-5xl mt-2">{fmt(familyTotals.total)}</p>
              {top && top.total > 0 && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-white/60 text-[11px]">Top this period</p>
                  <p className="font-bold text-sm mt-1">{top.child.avatarEmoji} {top.child.name} · {fmt(top.total)}</p>
                </div>
              )}
            </div>
          </div>

          <div className="col-span-3 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Routine points</p>
            <p className="font-display font-extrabold text-4xl mt-2">{fmt(familyTotals.routine)}</p>
            <p className="text-[11px] text-kaya-sand mt-2">From morning + evening ratings</p>
          </div>
          <div className="col-span-3 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Award points</p>
            <p className="font-display font-extrabold text-4xl mt-2">{fmt(familyTotals.award)}</p>
            <p className="text-[11px] text-kaya-sand mt-2">Bonuses for kindness, effort, etc.</p>
          </div>
          <div className="col-span-3 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Days rated</p>
            <p className="font-display font-extrabold text-4xl mt-2">{familyTotals.days}<span className="text-base text-kaya-sand font-semibold ml-1">/ {range}</span></p>
            <p className="text-[11px] text-kaya-sand mt-2">{Math.round((familyTotals.days / range) * 100)}% coverage</p>
          </div>
        </div>

        {/* Per-child cards with daily bars */}
        <h2 className="font-display text-base font-bold mb-3">Per child</h2>
        <div className="grid grid-cols-3 gap-4 mb-8">
          {childStats.map(({ child, routinePoints, awardPoints, totalDays, total, dailyTotals, peakDay }) => (
            <div key={child.id} className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
              <div className="flex items-center gap-3 mb-4">
                <KidAvatar child={child} size="lg" shape="square" />
                <div className="flex-1 min-w-0">
                  <p className="font-display font-bold text-lg truncate">{child.name}</p>
                  <p className="text-[11px] text-kaya-sand truncate">{child.houseName} House</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-black text-2xl" style={{ color: child.houseColor }}>{fmt(total)}</p>
                  <p className="text-[10px] text-kaya-sand">earned</p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mb-4">
                <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                  <p className="text-sm font-bold">{fmt(routinePoints)}</p>
                  <p className="text-[10px] text-kaya-sand">Routine</p>
                </div>
                <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                  <p className="text-sm font-bold">{fmt(awardPoints)}</p>
                  <p className="text-[10px] text-kaya-sand">Awards</p>
                </div>
                <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
                  <p className="text-sm font-bold">{totalDays}</p>
                  <p className="text-[10px] text-kaya-sand">Days</p>
                </div>
              </div>

              {/* Daily bars */}
              <div>
                <div className="flex items-end justify-between gap-1 h-20">
                  {dailyTotals.map((d) => {
                    const h = d.total > 0 ? Math.max(8, Math.round((d.total / peakDay) * 80)) : 2;
                    const dayLabel = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'narrow' });
                    return (
                      <div key={d.date} className="flex-1 flex flex-col items-center gap-1" title={`${d.date}: ${d.total} pts`}>
                        <div className="flex-1 w-full flex items-end">
                          <div
                            className="w-full rounded-sm transition-all"
                            style={{
                              height: `${h}px`,
                              backgroundColor: d.total > 0 ? child.houseColor : '#E8E0D4',
                              opacity: d.total > 0 ? 1 : 0.5,
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-end justify-between gap-1 mt-1">
                  {dailyTotals.map((d, i) => {
                    const showLabel = range <= 7 || i === 0 || i === dailyTotals.length - 1 || i === Math.floor(dailyTotals.length / 2);
                    const dayLabel = new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short' });
                    return (
                      <div key={d.date} className="flex-1 text-center">
                        {showLabel && <span className="text-[9px] text-kaya-sand-light font-semibold">{dayLabel.slice(0, 1)}</span>}
                      </div>
                    );
                  })}
                </div>
                <p className="text-[10px] text-kaya-sand-light mt-2">Daily total · last {range} days</p>
              </div>

              {/* Routine vs award split bar */}
              <div className="mt-3">
                <div className="h-2 bg-kaya-warm rounded-full overflow-hidden flex">
                  {routinePoints > 0 && (
                    <div className="h-full" style={{ width: `${(routinePoints / Math.max(total, 1)) * 100}%`, backgroundColor: child.houseColor }} />
                  )}
                  {awardPoints > 0 && (
                    <div className="h-full bg-kaya-gold" style={{ width: `${(awardPoints / Math.max(total, 1)) * 100}%` }} />
                  )}
                </div>
                <div className="flex gap-4 mt-1.5">
                  <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: child.houseColor }} /> Routine
                  </span>
                  <span className="flex items-center gap-1 text-[10px] text-kaya-sand">
                    <span className="w-2 h-2 rounded-full bg-kaya-gold" /> Awards
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
