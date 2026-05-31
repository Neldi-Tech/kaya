'use client';

// /games/approvals — the dedicated parent queue of games waiting to become
// House Points. HP carries real value, so a valued game a kid finishes lands
// here until a parent taps ✓ (or declines). Real-time; parent-only.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { subscribeToPendingGameApprovals } from '@/lib/gamesApprovals';
import GameApprovalCard from '@/components/games/GameApprovalCard';
import type { GamePlay } from '@/lib/games';

export default function GamesApprovalsPage() {
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  const [plays, setPlays] = useState<GamePlay[] | null>(null);

  useEffect(() => {
    if (!familyId || !isParent) return;
    const unsub = subscribeToPendingGameApprovals(familyId, setPlays);
    return () => unsub();
  }, [familyId, isParent]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-games-bg to-transparent">
      <div className="mx-auto max-w-md w-full px-4 pt-4 pb-28">
        <div className="flex items-center justify-between">
          <Link href="/games" className="text-sm font-bold text-games-ink-soft">&larr; Games</Link>
          <Link href="/games/controls" className="text-[12px] font-extrabold text-games-violet hover:underline">Controls →</Link>
        </div>

        {!isParent ? (
          <div className="text-center py-16">
            <p className="text-5xl mb-3">🛡️</p>
            <p className="font-display text-xl font-extrabold text-games-ink mb-2">Parents only</p>
            <p className="text-sm text-games-ink-soft">Game approvals are handled by a parent.</p>
          </div>
        ) : (
          <>
            <div className="rounded-kaya-lg p-5 my-4 text-white bg-gradient-to-br from-games-ink to-games-violet-deep">
              <h1 className="font-display text-2xl font-black mb-1">✅ Game approvals</h1>
              <p className="text-xs opacity-90">Tap ✓ to send these House Points to your kids — or decline with a note.</p>
            </div>

            {plays === null ? (
              <p className="text-center text-sm text-games-ink-soft py-16">Loading…</p>
            ) : plays.length === 0 ? (
              <div className="bg-games-card rounded-kaya-lg p-10 text-center">
                <div className="text-5xl mb-3">🎮</div>
                <p className="font-display font-extrabold text-[15px] text-games-ink">All caught up</p>
                <p className="text-games-ink-soft text-sm mt-1">
                  No games waiting. New wins from valued games show up here in real time.
                </p>
                <Link href="/games/controls" className="inline-block mt-4 text-[12px] font-extrabold text-games-violet hover:underline">
                  Set points per game →
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                {plays.map((p) => (
                  <GameApprovalCard key={p.id} play={p} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
