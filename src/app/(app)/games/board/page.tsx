'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';

// Family leaderboard. Ranks kids by this-week (weeklyPoints) or all-time
// (totalPoints) House Points — both already on the child docs, so no extra
// reads/rules. Mirrors the existing Family Home weekly board.

const MEDALS = ['🥇', '🥈', '🥉'];

export default function GamesBoardPage() {
  const { profile } = useAuth();
  const { children, loading } = useFamily();
  const [tab, setTab] = useState<'week' | 'all'>('week');
  const myId = profile?.childId;

  const ranked = [...children].sort((a, b) =>
    tab === 'week'
      ? (b.weeklyPoints || 0) - (a.weeklyPoints || 0)
      : (b.totalPoints || 0) - (a.totalPoints || 0),
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-white text-center bg-gradient-to-br from-games-violet to-games-violet-deep">
          <div className="text-4xl mb-1">🏆</div>
          <h1 className="font-display text-2xl font-black">Family Leaderboard</h1>
        </div>

        <div className="flex gap-1 mb-4 bg-games-bg rounded-full p-1">
          {(['week', 'all'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-full text-sm font-extrabold transition-colors ${
                tab === t ? 'bg-games-violet text-white' : 'text-games-ink-soft'
              }`}
            >
              {t === 'week' ? 'This week' : 'All time'}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="text-center text-sm text-games-ink-soft py-10">Loading…</p>
        ) : ranked.length === 0 ? (
          <p className="text-center text-sm text-games-ink-soft py-10">No kids in the family yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {ranked.map((c, i) => {
              const pts = tab === 'week' ? (c.weeklyPoints || 0) : (c.totalPoints || 0);
              const me = !!myId && c.id === myId;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 rounded-kaya p-3 shadow-[0_4px_12px_rgba(26,18,64,0.06)] ${
                    me ? 'bg-games-violet/10 ring-2 ring-games-violet' : 'bg-games-card'
                  }`}
                >
                  <span className="w-7 text-center font-display font-black text-games-ink-soft text-lg">
                    {i < 3 ? MEDALS[i] : i + 1}
                  </span>
                  <span className="text-2xl">{c.avatarEmoji || '🙂'}</span>
                  <span className="flex-1 font-display font-extrabold text-games-ink truncate">
                    {c.name}
                    {me && <span className="text-[10px] font-bold text-games-violet ml-1.5">you</span>}
                  </span>
                  <span className="font-display font-black text-games-violet">
                    {pts.toLocaleString()}
                    <span className="text-[10px] font-bold text-games-ink-soft ml-0.5">pts</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'week' && (
          <p className="text-center text-[11px] text-games-ink-soft mt-4">
            Weekly scores reset Sunday · all-time totals always count
          </p>
        )}
      </div>
    </div>
  );
}
