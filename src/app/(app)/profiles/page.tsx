'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, BADGES, DailyRating, Award } from '@/lib/firestore';
import BackButton from '@/components/ui/BackButton';

export default function ProfilesPage() {
  const { profile } = useAuth();
  const { children } = useFamily();
  const [selected, setSelected] = useState(0);
  const [ratings, setRatings] = useState<DailyRating[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);

  const child = children[selected];

  useEffect(() => {
    if (!profile?.familyId) return;
    (async () => {
      const [r, a] = await Promise.all([
        getRecentRatings(profile.familyId, 14),
        getRecentAwards(profile.familyId, 14),
      ]);
      setRatings(r.filter((x) => x.childId === child?.id));
      setAwards(a.filter((x) => x.childId === child?.id));
    })();
  }, [profile?.familyId, child?.id]);

  if (!child) return null;

  const earnedBadges = BADGES.filter((b) => (child.badges || []).includes(b.id));
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // Build a simple 7-day activity heatmap
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dateStr = d.toISOString().split('T')[0];
    const dayRatings = ratings.filter((r) => r.date === dateStr);
    const pts = dayRatings.reduce((s, r) => s + r.totalPoints, 0);
    return { day: weekDays[d.getDay() === 0 ? 6 : d.getDay() - 1], date: dateStr, points: pts };
  });

  return (
    <div className="mx-auto max-w-md w-full px-4 pt-4">
      <BackButton />
      <div className="mb-5">
        <h1 className="font-display text-2xl font-black">Kid Profiles</h1>
      </div>

      {/* Child selector */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        {children.map((c, i) => (
          <button
            key={c.id}
            onClick={() => setSelected(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap border transition-all ${
              selected === i ? 'text-white border-transparent' : 'border-kaya-warm-dark bg-white text-kaya-sand'
            }`}
            style={selected === i ? { backgroundColor: c.houseColor } : {}}
          >
            {c.avatarEmoji} {c.name}
          </button>
        ))}
      </div>

      {/* Profile card */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-5 mb-5 text-center">
        <div
          className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl mb-3"
          style={{ backgroundColor: child.houseColor + '20' }}
        >
          {child.avatarEmoji}
        </div>
        <h2 className="font-display text-xl font-black">{child.name}</h2>
        <p className="text-sm font-semibold" style={{ color: child.houseColor }}>{child.houseName}</p>

        <div className="flex justify-around mt-4 pt-4 border-t border-kaya-warm-dark">
          <div>
            <p className="text-xl font-black" style={{ color: child.houseColor }}>{child.totalPoints || 0}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Total</p>
          </div>
          <div>
            <p className="text-xl font-black">{child.weeklyPoints || 0}</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">This Week</p>
          </div>
          <div>
            <p className="text-xl font-black">{child.streak || 0} 🔥</p>
            <p className="text-[10px] text-kaya-sand font-semibold uppercase">Streak</p>
          </div>
        </div>
      </div>

      {/* 7-day activity */}
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-4 mb-5">
        <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-3">Last 7 Days</h3>
        <div className="flex justify-between">
          {last7.map((d) => (
            <div key={d.date} className="flex flex-col items-center gap-1.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: d.points > 10 ? child.houseColor : d.points > 0 ? child.houseColor + '30' : '#F0EBE3',
                  color: d.points > 10 ? '#fff' : d.points > 0 ? child.houseColor : '#C4B89A',
                }}
              >
                {d.points || '—'}
              </div>
              <span className="text-[10px] text-kaya-sand font-medium">{d.day}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Badges */}
      {earnedBadges.length > 0 && (
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-3">Badges Earned</h3>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {earnedBadges.map((b) => (
              <div key={b.id} className="flex-shrink-0 bg-white border border-kaya-warm-dark rounded-kaya p-3 text-center w-20">
                <div className="text-2xl mb-1">{b.icon}</div>
                <p className="text-[10px] font-bold leading-tight">{b.name}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent awards */}
      {awards.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-kaya-sand uppercase tracking-wider mb-3">Recent Awards</h3>
          <div className="space-y-2">
            {awards.slice(0, 5).map((a) => (
              <div key={a.id} className="bg-white border border-kaya-warm-dark rounded-kaya-sm p-3 flex items-center gap-3">
                <span className="text-lg">🎖️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{a.reason}</p>
                  <p className="text-xs text-kaya-sand">by {a.awardedByName}</p>
                </div>
                <span className="text-xs font-bold text-kaya-gold">+{a.points}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
