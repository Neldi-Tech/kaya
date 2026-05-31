'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';

// Games Leaderboard — two tabs:
//   ⭐ Game Points — House Points earned ONLY from games (sum of approved
//      gamePlays), not chores/routines, so it's a true Games board.
//   🏆 Wins — total multi-device wins (child.gameWins) + a 🔥 streak badge.
// Both read existing family-readable data — no rules deploy.

const MEDALS = ['🥇', '🥈', '🥉'];
type Tab = 'points' | 'wins';

export default function GamesBoardPage() {
  const { profile } = useAuth();
  const { children, loading } = useFamily();
  const [tab, setTab] = useState<Tab>('points');
  const [gamePts, setGamePts] = useState<Record<string, number>>({});
  const myId = profile?.childId;
  const familyId = profile?.familyId;

  // ⭐ Game Points = sum of APPROVED game plays per kid (games only).
  useEffect(() => {
    let cancelled = false;
    if (!familyId) return;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'families', familyId, 'gamePlays'),
          where('status', '==', 'approved'),
        ));
        if (cancelled) return;
        const acc: Record<string, number> = {};
        snap.forEach((d) => {
          const p = d.data() as { kidId?: string; pointsAwarded?: number };
          if (p.kidId) acc[p.kidId] = (acc[p.kidId] || 0) + (Number(p.pointsAwarded) || 0);
        });
        setGamePts(acc);
      } catch { /* board still works on the Wins tab */ }
    })();
    return () => { cancelled = true; };
  }, [familyId]);

  const ranked = useMemo(() => (
    [...children].sort((a, b) => (tab === 'points'
      ? (gamePts[b.id] || 0) - (gamePts[a.id] || 0)
      : (b.gameWins || 0) - (a.gameWins || 0)))
  ), [children, tab, gamePts]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>

        <div className="rounded-kaya-lg p-5 my-4 text-white text-center bg-gradient-to-br from-games-violet to-[#9333EA]">
          <div className="text-4xl mb-1">🏆</div>
          <h1 className="font-display text-2xl font-black">Games Leaderboard</h1>
        </div>

        <div className="flex gap-1 mb-4 bg-games-bg rounded-full p-1">
          {(['points', 'wins'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-full text-sm font-extrabold transition-colors ${
                tab === t ? 'bg-games-violet text-white' : 'text-games-ink-soft'
              }`}
            >
              {t === 'points' ? '⭐ Game Points' : '🏆 Wins'}
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
              const me = !!myId && c.id === myId;
              const points = gamePts[c.id] || 0;
              const wins = c.gameWins || 0;
              const streak = c.gameWinStreak || 0;
              return (
                <div
                  key={c.id}
                  className={`flex items-center gap-3 rounded-kaya p-3 shadow-[0_4px_12px_rgba(26,18,64,0.06)] ${
                    me ? 'bg-games-violet/10 ring-2 ring-games-violet' : 'bg-games-card'
                  }`}
                >
                  <span className="w-7 text-center font-display font-black text-games-ink-soft text-lg shrink-0">
                    {i < 3 ? MEDALS[i] : i + 1}
                  </span>
                  <span className="text-2xl shrink-0">{c.avatarEmoji || '🙂'}</span>
                  <span className="flex-1 font-display font-extrabold text-games-ink truncate">
                    {c.name}
                    {me && <span className="text-[10px] font-bold text-games-violet ml-1.5">you</span>}
                  </span>
                  {tab === 'points' ? (
                    <span className="font-display font-black text-games-violet shrink-0">
                      {points.toLocaleString()}<span className="text-[10px] font-bold text-games-ink-soft ml-0.5">pts</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <span className="font-display font-black text-games-violet">
                        {wins}<span className="text-[10px] font-bold text-games-ink-soft ml-0.5">{wins === 1 ? 'win' : 'wins'}</span>
                      </span>
                      {streak > 0 && (
                        <span className="bg-[#FFEDE0] text-[#C2410C] text-[10px] font-black px-2 py-0.5 rounded-full">🔥 {streak}</span>
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <p className="text-center text-[11px] text-games-ink-soft mt-4">
          {tab === 'points'
            ? 'Only House Points earned from games — not chores or routines.'
            : 'Wins counted from multi-device games (everyone on their own phone).'}
        </p>
      </div>
    </div>
  );
}
