'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards, DailyRating, Award } from '@/lib/firestore';

export default function DashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const [recentActivity, setRecentActivity] = useState<any[]>([]);

  useEffect(() => {
    if (!profile?.familyId) return;
    (async () => {
      const [ratings, awards] = await Promise.all([
        getRecentRatings(profile.familyId, 3),
        getRecentAwards(profile.familyId, 3),
      ]);
      const activity = [
        ...ratings.map((r) => ({
          type: 'rating' as const,
          childId: r.childId,
          points: r.totalPoints,
          desc: `${r.period} routine rated`,
          date: r.date,
          by: r.ratedByName,
        })),
        ...awards.map((a) => ({
          type: 'award' as const,
          childId: a.childId,
          points: a.points,
          desc: a.reason,
          date: a.createdAt?.toDate?.()?.toISOString?.()?.split('T')[0] || '',
          by: a.awardedByName,
        })),
      ].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 8);
      setRecentActivity(activity);
    })();
  }, [profile?.familyId]);

  const childName = (id: string) => children.find((c) => c.id === id)?.name || 'Unknown';
  const childColor = (id: string) => children.find((c) => c.id === id)?.houseColor || '#999';
  const childEmoji = (id: string) => children.find((c) => c.id === id)?.avatarEmoji || '👧';

  const topChild = children[0];
  const totalFamilyPoints = children.reduce((s, c) => s + (c.totalPoints || 0), 0);

  return (
    <div className="px-4 pt-4">
      {/* Greeting */}
      <div className="mb-5">
        <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="font-display text-2xl font-black mt-0.5">
          Hello, {profile?.displayName?.split(' ')[0]} 👋
        </h1>
      </div>

      {/* House Scores Card */}
      <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya-lg p-5 mb-5 shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-kaya-gold text-xs font-semibold uppercase tracking-wider">Family Score</p>
            <p className="text-white text-3xl font-display font-black">{totalFamilyPoints}</p>
          </div>
          {topChild && (
            <div className="text-right">
              <p className="text-white/60 text-xs">Leader</p>
              <p className="text-white font-bold text-sm">{topChild.avatarEmoji} {topChild.name}</p>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          {children.map((child) => (
            <div key={child.id} className="flex items-center gap-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm"
                style={{ backgroundColor: child.houseColor + '30' }}
              >
                {child.avatarEmoji}
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-white text-xs font-semibold">{child.name}</span>
                  <span className="text-kaya-gold text-xs font-bold">{child.totalPoints || 0} pts</span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, ((child.totalPoints || 0) / Math.max(totalFamilyPoints, 1)) * 100)}%`,
                      backgroundColor: child.houseColor,
                    }}
                  />
                </div>
              </div>
              {child.streak > 0 && (
                <span className="text-xs" title={`${child.streak}-day streak`}>🔥{child.streak}</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {[
          { icon: '☀️', label: 'Morning\nRating', path: '/rate?period=morning', color: '#FFF8E7' },
          { icon: '🌙', label: 'Evening\nRating', path: '/rate?period=evening', color: '#EFF0FF' },
          { icon: '🎖️', label: 'Award\nPoints', path: '/award', color: '#FFF0E7' },
          { icon: '👨‍👩‍👧‍👦', label: 'Family\nMeeting', path: '/meetings', color: '#E7FFF0' },
        ].map((action) => (
          <button
            key={action.label}
            onClick={() => router.push(action.path)}
            className="flex items-center gap-3 p-4 rounded-kaya border border-kaya-warm-dark bg-white hover:shadow-sm transition-shadow text-left"
          >
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
              style={{ backgroundColor: action.color }}
            >
              {action.icon}
            </div>
            <span className="text-xs font-bold leading-tight whitespace-pre-line">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Recent Activity */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-base font-bold">Recent Activity</h2>
          <button
            onClick={() => router.push('/reports')}
            className="text-xs text-kaya-gold font-semibold"
          >
            View Reports →
          </button>
        </div>

        {recentActivity.length === 0 ? (
          <div className="bg-white border border-kaya-warm-dark rounded-kaya p-6 text-center">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-kaya-sand text-sm">No activity yet. Start by rating today's morning routine!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((item, idx) => (
              <div key={idx} className="flex items-center gap-3 bg-white border border-kaya-warm-dark rounded-kaya-sm p-3">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-sm"
                  style={{ backgroundColor: childColor(item.childId) + '20' }}
                >
                  {childEmoji(item.childId)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {childName(item.childId)}
                    <span className="font-normal text-kaya-sand"> — {item.desc}</span>
                  </p>
                  <p className="text-xs text-kaya-sand">{item.by} · {item.date}</p>
                </div>
                <span
                  className="text-xs font-bold px-2 py-1 rounded-full"
                  style={{
                    backgroundColor: item.type === 'award' ? '#FFF0E7' : '#E7FFF0',
                    color: item.type === 'award' ? '#D4A017' : '#27AE60',
                  }}
                >
                  +{item.points}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
