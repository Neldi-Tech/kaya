'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, DailyRating, Award } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

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

  const childStats = children.map((child) => {
    const childRatings = ratings.filter((r) => r.childId === child.id);
    const childAwards = awards.filter((a) => a.childId === child.id);
    const routinePoints = childRatings.reduce((s, r) => s + r.totalPoints, 0);
    const awardPoints = childAwards.reduce((s, a) => s + a.points, 0);
    const totalDays = new Set(childRatings.map((r) => r.date)).size;

    // Routine breakdown
    const routineScores: Record<string, { excellent: number; good: number; bad: number }> = {};
    childRatings.forEach((r) => {
      Object.entries(r.ratings).forEach(([routineId, val]) => {
        if (!routineScores[routineId]) routineScores[routineId] = { excellent: 0, good: 0, bad: 0 };
        if (val === 'excellent') routineScores[routineId].excellent++;
        else if (val === 'good') routineScores[routineId].good++;
        else routineScores[routineId].bad++;
      });
    });

    return { child, routinePoints, awardPoints, totalDays, routineScores, total: routinePoints + awardPoints };
  });

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Reports</h1>
        <p className="text-kaya-sand text-sm">Performance insights</p>
      </div>

      {/* Range selector */}
      <div className="flex gap-2 mb-5">
        {[7, 14, 30].map((d) => (
          <button
            key={d}
            onClick={() => setRange(d)}
            className={`flex-1 h-9 rounded-kaya-sm text-xs font-semibold transition-colors ${
              range === d ? 'bg-kaya-chocolate text-white' : 'bg-kaya-warm text-kaya-sand'
            }`}
          >
            {d} days
          </button>
        ))}
      </div>

      {/* Per-child cards */}
      {childStats.map(({ child, routinePoints, awardPoints, totalDays, total }) => (
        <div key={child.id} className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-4">
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-lg"
              style={{ backgroundColor: child.houseColor + '20' }}
            >
              {child.avatarEmoji}
            </div>
            <div className="flex-1">
              <p className="font-bold text-sm">{child.name}</p>
              <p className="text-xs text-kaya-sand">{child.houseName}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-display font-black" style={{ color: child.houseColor }}>{total}</p>
              <p className="text-[10px] text-kaya-sand">points earned</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
              <p className="text-sm font-bold">{routinePoints}</p>
              <p className="text-[10px] text-kaya-sand">Routine</p>
            </div>
            <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
              <p className="text-sm font-bold">{awardPoints}</p>
              <p className="text-[10px] text-kaya-sand">Awards</p>
            </div>
            <div className="bg-kaya-cream rounded-kaya-sm p-2.5 text-center">
              <p className="text-sm font-bold">{totalDays}</p>
              <p className="text-[10px] text-kaya-sand">Days Rated</p>
            </div>
          </div>

          {/* Simple bar visualization */}
          <div className="h-2 bg-kaya-warm rounded-full overflow-hidden flex">
            {routinePoints > 0 && (
              <div
                className="h-full"
                style={{
                  width: `${(routinePoints / Math.max(total, 1)) * 100}%`,
                  backgroundColor: child.houseColor,
                }}
              />
            )}
            {awardPoints > 0 && (
              <div
                className="h-full bg-kaya-gold"
                style={{ width: `${(awardPoints / Math.max(total, 1)) * 100}%` }}
              />
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
  );
}
