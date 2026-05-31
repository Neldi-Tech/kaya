'use client';

// /parent/approvals — pending request inbox. Reads pending money requests
// from HiveContext (real-time across all kids) and renders each as an
// ApprovalRequestCard. Kaya Games wins worth House Points also surface here
// (in their own section) so a parent has one place to clear everything — the
// dedicated /games/approvals queue shows the same items.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useHive } from '@/contexts/HiveContext';
import { useAuth } from '@/contexts/AuthContext';
import ApprovalRequestCard from '@/components/hive/ApprovalRequestCard';
import GameApprovalCard from '@/components/games/GameApprovalCard';
import BackButton from '@/components/ui/BackButton';
import { subscribeToPendingGameApprovals } from '@/lib/gamesApprovals';
import type { GamePlay } from '@/lib/games';

export default function ParentApprovalsPage() {
  const { pendingApprovals } = useHive();
  const { profile } = useAuth();
  const familyId = profile?.familyId;
  const isParent = profile?.role === 'parent';

  const [gamePlays, setGamePlays] = useState<GamePlay[]>([]);
  useEffect(() => {
    if (!familyId || !isParent) return;
    const unsub = subscribeToPendingGameApprovals(familyId, setGamePlays);
    return () => unsub();
  }, [familyId, isParent]);

  const nothing = pendingApprovals.length === 0 && gamePlays.length === 0;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 lg:mb-7 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Parent · The Hive</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[40px] mt-1">Approvals</h1>
        </div>
        <Link href="/parent/rates" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
          Rates →
        </Link>
      </div>

      {nothing ? (
        <div className="bg-hive-paper border border-hive-line rounded-hive-lg p-10 text-center">
          <div className="text-5xl mb-3">📭</div>
          <p className="font-nunito font-extrabold text-[15px]">Inbox zero</p>
          <p className="text-hive-muted text-sm mt-1">
            Nothing waiting on your approval. New requests show up here in real time.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingApprovals.length > 0 && (
            <div className="space-y-3">
              {pendingApprovals.map((r) => (
                <ApprovalRequestCard key={r.id} req={r} />
              ))}
            </div>
          )}

          {gamePlays.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-2">
                <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">
                  🎮 Games · House Points
                </p>
                <Link href="/games/approvals" className="text-[12px] font-nunito font-extrabold text-hive-honey-dk hover:underline">
                  Open queue →
                </Link>
              </div>
              <div className="space-y-3">
                {gamePlays.map((p) => (
                  <GameApprovalCard key={p.id} play={p} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
