'use client';

// ⏳ Waiting-round todo (RR PR-5) — shows on Home for parents (and
// helpers in the round's audience) ONLY while a round is inside its 72h
// window with kids still uncelebrated. Disappears the moment a card is
// given — zero clutter on quiet days. (Moves into adult My Day when that
// phase lands.)

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { getWaitingRound, type WaitingRound } from '@/lib/shineCards';

export default function WaitingRoundCard({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const [waiting, setWaiting] = useState<WaitingRound | null>(null);

  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent' && profile.role !== 'helper') return;
    getWaitingRound(profile.familyId, profile.uid, profile.role)
      .then(setWaiting)
      .catch(() => setWaiting(null));
  }, [profile?.familyId, profile?.uid, profile?.role]);

  if (!waiting) return null;
  const celebrated = new Set(waiting.celebratedKidIds);
  const kids = waiting.round.items.filter((i) => !celebrated.has(i.kidId));
  if (kids.length === 0) return null;

  return (
    <Link
      href={`/award?round=${waiting.round.date}`}
      className={`block rounded-kaya p-3.5 text-white hover:brightness-105 transition-all ${className}`}
      style={{ background: 'linear-gradient(130deg,#6B3FE0,#9b6bff)' }}
    >
      <p className="text-[12.5px] font-bold">
        ⏳ 🌟 Recognition round waiting — {kids.length} kid{kids.length === 1 ? '' : 's'} to celebrate
        <span className="float-right font-black">Celebrate →</span>
      </p>
      <p className="text-[11px] opacity-80 mt-0.5 truncate">{kids[0].emoji} {kids[0].line}</p>
    </Link>
  );
}
