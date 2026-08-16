'use client';

// 🌟 Recognition strip on Home (RR PR-5 → FX PR-6).
//
// Two states, ALWAYS present for adults (Elia: "include recognition
// shortcut at Home"):
//   ⏳ purple banner — a round's 72h window is open with kids waiting
//   🌟 quiet strip  — nothing waiting: slim link with the 🔥 streak,
//                     so Recognition is one tap away every day

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { listRounds, listShineCards, type RecognitionRound, type ShineCard } from '@/lib/shineCards';

export default function WaitingRoundCard({ className = '' }: { className?: string }) {
  const { profile } = useAuth();
  const [state, setState] = useState<{
    waitingKids: RecognitionRound['items'];
    streak: number;
  } | null>(null);

  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent' && profile.role !== 'helper') return;
    (async () => {
      try {
        const [rounds, cards] = await Promise.all([
          listRounds(profile.familyId).catch(() => [] as RecognitionRound[]),
          listShineCards(profile.familyId).catch(() => [] as ShineCard[]),
        ]);
        const answered = (date: string) => {
          const start = new Date(`${date}T00:00:00`).getTime();
          return cards.some((c) => c.at >= start && c.at < start + 72 * 3600_000);
        };
        let streak = 0;
        for (const r of [...rounds].sort((a, b) => b.date.localeCompare(a.date))) {
          const start = new Date(`${r.date}T00:00:00`).getTime();
          if (Date.now() < start + 72 * 3600_000 && !answered(r.date)) continue;
          if (answered(r.date)) streak++; else break;
        }
        const latest = rounds[0];
        let waitingKids: RecognitionRound['items'] = [];
        if (latest) {
          const start = new Date(`${latest.date}T00:00:00`).getTime();
          const windowOpen = Date.now() < start + 72 * 3600_000;
          const audienceOk = profile.role === 'parent' || (latest.sentTo || []).includes(profile.uid);
          if (windowOpen && audienceOk) {
            const celebrated = new Set(cards.filter((c) => c.at >= start).map((c) => c.kidId));
            waitingKids = latest.items.filter((i) => !celebrated.has(i.kidId));
          }
        }
        setState({ waitingKids, streak });
      } catch { setState(null); }
    })();
  }, [profile?.familyId, profile?.uid, profile?.role]);

  if (!profile || (profile.role !== 'parent' && profile.role !== 'helper')) return null;
  if (!state) return null;

  if (state.waitingKids.length > 0) {
    return (
      <Link
        href="/recognition"
        className={`block rounded-kaya p-3.5 text-white hover:brightness-105 transition-all ${className}`}
        style={{ background: 'linear-gradient(130deg,#6B3FE0,#9b6bff)' }}
      >
        <p className="text-[12.5px] font-bold">
          ⏳ 🌟 Recognition round waiting — {state.waitingKids.length} kid{state.waitingKids.length === 1 ? '' : 's'} to celebrate
          <span className="float-right font-black">Celebrate →</span>
        </p>
        <p className="text-[11px] opacity-80 mt-0.5 truncate">
          {state.waitingKids[0].emoji} {state.waitingKids[0].line}
          {state.waitingKids[0].giftIdea ? ` · 🎁 idea: ${state.waitingKids[0].giftIdea.label}` : ''}
        </p>
      </Link>
    );
  }

  // Quiet state — the permanent shortcut.
  return (
    <Link
      href="/recognition"
      className={`flex items-center gap-2 rounded-kaya border border-kaya-warm-dark bg-white px-3.5 py-2.5 hover:border-kaya-gold transition-colors ${className}`}
    >
      <span className="text-[12.5px] font-bold flex-1">🌟 Recognition{state.streak > 0 ? <span className="text-kaya-sand font-semibold"> · 🔥 {state.streak} round{state.streak === 1 ? '' : 's'} in a row</span> : ''}</span>
      <span className="text-[11.5px] font-black text-kaya-gold">open →</span>
    </Link>
  );
}
