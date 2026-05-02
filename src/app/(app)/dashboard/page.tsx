'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { getRecentRatings, getRecentAwards } from '@/lib/firestore';
import KidAvatar from '@/components/ui/KidAvatar';

type ActivityItem = {
  type: 'rating' | 'award';
  childId: string;
  points: number;
  desc: string;
  date: string;
  by: string;
};

const QUICK_ACTIONS = [
  { icon: '☀️', short: 'Morning\nRating',  long: 'Morning rating',  hint: 'Rate today’s wake-up routines',  path: '/rate?period=morning', color: '#FFF8E7' },
  { icon: '🌙', short: 'Evening\nRating',  long: 'Evening rating',  hint: 'Rate today’s wind-down routines', path: '/rate?period=evening', color: '#EFF0FF' },
  { icon: '🎖️', short: 'Award\nPoints',    long: 'Award points',    hint: 'Catch a kindness',                path: '/award',               color: '#FFF0E7' },
  { icon: '👨‍👩‍👧‍👦', short: 'Family\nMeeting', long: 'Family meeting', hint: '6-step weekly flow',              path: '/meetings',            color: '#E7FFF0' },
];

export default function DashboardPage() {
  const router = useRouter();
  const { profile } = useAuth();
  const { family, children, rewards } = useFamily();
  const [recentActivity, setRecentActivity] = useState<ActivityItem[]>([]);

  useEffect(() => {
    if (!profile?.familyId) return;
    (async () => {
      const [ratings, awards] = await Promise.all([
        getRecentRatings(profile.familyId, 3),
        getRecentAwards(profile.familyId, 3),
      ]);
      const activity: ActivityItem[] = [
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
      ]
        .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        .slice(0, 8);
      setRecentActivity(activity);
    })();
  }, [profile?.familyId]);

  const childName = (id: string) => children.find((c) => c.id === id)?.name || 'Unknown';
  const childColor = (id: string) => children.find((c) => c.id === id)?.houseColor || '#999';
  const childEmoji = (id: string) => children.find((c) => c.id === id)?.avatarEmoji || '👧';

  const sortedKids = [...children].sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0));
  const topChild = sortedKids[0];
  const totalFamilyPoints = children.reduce((s, c) => s + (c.totalPoints || 0), 0);
  const fmt = (n: number) => n.toLocaleString('en-US');
  const firstName = profile?.displayName?.split(' ')[0] || 'there';
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const houseTextColor = (hex: string) => hex; // kept for clarity; tags use rgba bg only

  return (
    <>
      {/* ──────────────────────────────────────────────────────── */}
      {/* Mobile layout (< lg) — preserved as today                 */}
      {/* ──────────────────────────────────────────────────────── */}
      <div className="lg:hidden mx-auto max-w-md w-full px-4 pt-4">
        <div className="mb-5">
          <p className="text-xs text-kaya-sand font-semibold uppercase tracking-wider">{today}</p>
          <h1 className="font-display text-2xl font-black mt-0.5">Hello, {firstName} 👋</h1>
        </div>

        <div className="bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya-lg p-5 mb-5 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-kaya-gold text-xs font-semibold uppercase tracking-wider">Family Score</p>
              <p className="text-white text-3xl font-display font-black">{fmt(totalFamilyPoints)}</p>
            </div>
            {topChild && (
              <div className="text-right">
                <p className="text-white/60 text-xs">Leader</p>
                <p className="text-white font-bold text-sm">{topChild.avatarEmoji} {topChild.name}</p>
              </div>
            )}
          </div>

          <div className="space-y-2.5">
            {sortedKids.map((child) => (
              <div key={child.id} className="flex items-center gap-3">
                <KidAvatar child={child} size="sm" bgOpacity="30" />
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white text-xs font-semibold">{child.name}</span>
                    <span className="text-kaya-gold text-xs font-bold">{fmt(child.totalPoints || 0)} pts</span>
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

        <div className="grid grid-cols-2 gap-3 mb-6">
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.path}
              onClick={() => router.push(a.path)}
              className="flex items-center gap-3 p-4 rounded-kaya border border-kaya-warm-dark bg-white hover:shadow-sm transition-shadow text-left"
            >
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ backgroundColor: a.color }}
              >
                {a.icon}
              </div>
              <span className="text-xs font-bold leading-tight whitespace-pre-line">{a.short}</span>
            </button>
          ))}
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-display text-base font-bold">Recent Activity</h2>
            <button onClick={() => router.push('/reports')} className="text-xs text-kaya-gold font-semibold">
              View Reports →
            </button>
          </div>

          {recentActivity.length === 0 ? (
            <div className="bg-white border border-kaya-warm-dark rounded-kaya p-6 text-center">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-kaya-sand text-sm">No activity yet. Start by rating today’s morning routine!</p>
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
                    +{fmt(item.points)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ──────────────────────────────────────────────────────── */}
      {/* Desktop layout (lg+) — sidebar shell handled by AppShell  */}
      {/* ──────────────────────────────────────────────────────── */}
      <div className="hidden lg:block max-w-[1400px] w-full px-8 py-8">
        <div className="mb-7">
          <h1 className="font-display text-[34px] leading-tight font-extrabold tracking-tight">
            Hello, {firstName} 👋
          </h1>
          <p className="text-sm text-kaya-sand mt-1">Here’s how the family is tracking this week.</p>
        </div>

        {/* Hero strip: family score + kid cards */}
        <div className="grid grid-cols-12 gap-4 mb-8">
          <div className="col-span-3 bg-gradient-to-br from-kaya-chocolate to-kaya-chocolate-light rounded-kaya-lg p-5 text-white relative overflow-hidden">
            <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-kaya-gold/15 blur-2xl pointer-events-none" />
            <div className="relative">
              <p className="text-kaya-gold text-[11px] font-bold uppercase tracking-[0.14em]">Family Score</p>
              <p className="font-display font-black text-5xl mt-2">{fmt(totalFamilyPoints)}</p>
              {topChild && (
                <div className="mt-4 pt-4 border-t border-white/10">
                  <p className="text-white/60 text-[11px]">Leader this week</p>
                  <p className="font-bold text-sm mt-1">
                    {topChild.avatarEmoji} {topChild.name}
                    {topChild.weeklyPoints ? ` · +${fmt(topChild.weeklyPoints)} pts` : ''}
                  </p>
                </div>
              )}
            </div>
          </div>

          {sortedKids.slice(0, 3).map((child) => {
            const pct = Math.min(
              100,
              ((child.totalPoints || 0) / Math.max(totalFamilyPoints, 1)) * 100,
            );
            const tagBg = `${child.houseColor}26`;
            return (
              <button
                key={child.id}
                onClick={() => router.push(`/profiles?child=${child.id}`)}
                className="col-span-3 bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5 hover:border-kaya-chocolate transition-colors text-left"
              >
                <div className="flex items-start justify-between">
                  <KidAvatar child={child} size="lg" shape="square" />
                  <span
                    className="text-[11px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
                    style={{ backgroundColor: tagBg, color: child.houseColor }}
                  >
                    {child.houseName}
                  </span>
                </div>
                <div className="mt-4">
                  <div className="font-display font-bold text-lg">{child.name}</div>
                  {child.streak > 0 && (
                    <div className="text-[11px] text-kaya-sand">{child.streak}-day streak 🔥</div>
                  )}
                </div>
                <div className="mt-4 flex items-baseline gap-1.5">
                  <span className="font-display font-extrabold text-3xl">{fmt(child.totalPoints || 0)}</span>
                  <span className="text-[11px] text-kaya-sand">
                    total{child.weeklyPoints ? ` · +${fmt(child.weeklyPoints)} wk` : ''}
                  </span>
                </div>
                <div className="mt-3 h-1.5 bg-kaya-warm rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: child.houseColor }}
                  />
                </div>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] text-kaya-sand">
                  <span>🏆 {child.badges?.length || 0} {child.badges?.length === 1 ? 'badge' : 'badges'}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Quick actions */}
        <div className="mb-8">
          <h2 className="font-display text-base font-bold mb-3">Quick actions</h2>
          <div className="grid grid-cols-4 gap-3">
            {QUICK_ACTIONS.map((a) => (
              <button
                key={a.path}
                onClick={() => router.push(a.path)}
                className="flex items-center gap-3 p-4 rounded-kaya border border-kaya-warm-dark bg-white hover:shadow-md hover:-translate-y-0.5 transition-all text-left"
              >
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                  style={{ backgroundColor: a.color }}
                >
                  {a.icon}
                </div>
                <div>
                  <div className="text-sm font-bold">{a.long}</div>
                  <div className="text-[11px] text-kaya-sand">{a.hint}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Activity + sidebar */}
        <div className="grid grid-cols-12 gap-6">
          <section className="col-span-8">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-display text-base font-bold">Recent activity</h2>
              <button
                onClick={() => router.push('/reports')}
                className="text-[12px] text-kaya-gold font-semibold"
              >
                View all reports →
              </button>
            </div>
            {recentActivity.length === 0 ? (
              <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-10 text-center">
                <p className="text-3xl mb-2">📋</p>
                <p className="text-kaya-sand text-sm">No activity yet. Start with today’s morning routine.</p>
              </div>
            ) : (
              <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg overflow-hidden">
                {recentActivity.map((item, idx) => (
                  <div
                    key={idx}
                    className={`px-5 py-3.5 flex items-center gap-3 ${
                      idx < recentActivity.length - 1 ? 'border-b border-kaya-warm-dark/60' : ''
                    }`}
                  >
                    <div
                      className="w-9 h-9 rounded-full flex items-center justify-center text-sm"
                      style={{ backgroundColor: childColor(item.childId) + '20' }}
                    >
                      {childEmoji(item.childId)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold">
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
                      +{fmt(item.points)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="col-span-4 space-y-4">
            <div className="bg-white border border-kaya-warm-dark/70 rounded-kaya-lg p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-sm font-bold">Reward shelf</h3>
                <button
                  onClick={() => router.push('/rewards')}
                  className="text-[11px] text-kaya-gold font-semibold"
                >
                  Manage →
                </button>
              </div>
              {rewards.length === 0 ? (
                <p className="text-[12px] text-kaya-sand">Add rewards in the rewards screen to see them here.</p>
              ) : (
                <div className="space-y-2.5">
                  {rewards.slice(0, 3).map((r) => {
                    const top = topChild?.totalPoints || 0;
                    const ready = top >= r.pointsCost;
                    return (
                      <div key={r.id} className="flex items-center gap-3 p-2.5 rounded-kaya-sm hover:bg-kaya-warm/40 transition-colors">
                        <div className="w-9 h-9 rounded-[10px] flex items-center justify-center text-base bg-kaya-warm/60">
                          {r.icon}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[13px] font-bold truncate">{r.title}</div>
                          <div className="text-[11px] text-kaya-sand">{fmt(r.pointsCost)} pts</div>
                        </div>
                        <span className={`text-[10px] font-bold uppercase ${ready ? 'text-kaya-gold' : 'text-kaya-sand'}`}>
                          {ready ? 'Ready' : 'Soon'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="bg-kaya-chocolate text-kaya-gold-light rounded-kaya-lg p-5">
              <p className="text-kaya-gold text-[10px] font-bold uppercase tracking-[0.14em]">Next family meeting</p>
              <p className="font-display text-white font-bold text-lg mt-1">Open the meeting flow</p>
              <p className="text-[12px] text-kaya-sand-light mt-1.5 leading-relaxed">
                6-step weekly flow — gratitude, goals, reward redemption.
              </p>
              <button
                onClick={() => router.push('/meetings')}
                className="mt-3 bg-kaya-gold text-kaya-chocolate font-bold text-[12px] px-3 py-2 rounded-kaya-sm hover:bg-kaya-gold-light transition-colors"
              >
                Start meeting →
              </button>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
