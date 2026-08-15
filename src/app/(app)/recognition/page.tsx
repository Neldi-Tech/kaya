'use client';

// 🌟 Recognition (RR PR-5) — the shared front door for parents AND
// helpers: tonight's waiting round (tap → pre-filled Award page) + the
// Hit-Map rhythm. Settings stay parent-only on Manage Rewards; this page
// is read + celebrate. Kids don't see it (their side is the Shine Wall).

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import RecognitionHitMap from '@/components/rewards/RecognitionHitMap';
import { ShineWall } from '@/components/rewards/ShineCards';
import BackButton from '@/components/ui/BackButton';
import { getWaitingRound, type WaitingRound } from '@/lib/shineCards';

export default function RecognitionPage() {
  const { profile } = useAuth();
  const isAdult = profile?.role === 'parent' || profile?.role === 'helper';
  const [waiting, setWaiting] = useState<WaitingRound | null>(null);
  useEffect(() => {
    if (!profile?.familyId || !isAdult) return;
    getWaitingRound(profile.familyId, profile.uid, profile.role).then(setWaiting).catch(() => setWaiting(null));
  }, [profile?.familyId, profile?.uid, profile?.role, isAdult]);

  if (!profile) return null;
  if (!isAdult) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-10 text-center">
        <p className="text-4xl mb-3">🌟</p>
        <p className="text-sm text-kaya-sand">Your Shine Cards live on your profile — go collect them there! ✨</p>
      </div>
    );
  }

  const celebrated = new Set(waiting?.celebratedKidIds || []);
  const waitingItems = waiting ? waiting.round.items.filter((i) => !celebrated.has(i.kidId)) : [];

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-5 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[3px] text-kaya-gold">Kaya · celebrate</p>
          <h1 className="font-display font-black text-3xl lg:text-[36px] mt-1">🌟 Recognition</h1>
        </div>
        {profile.role === 'parent' && (
          <Link href="/parent/rewards#recognition-rounds" className="text-[12px] font-bold text-kaya-gold hover:underline shrink-0">
            ⚙️ Rounds settings →
          </Link>
        )}
      </div>

      {waiting && waitingItems.length > 0 ? (
        <div className="rounded-kaya p-4 mb-5 text-white" style={{ background: 'linear-gradient(130deg,#6B3FE0,#9b6bff)' }}>
          <p className="text-[9.5px] uppercase tracking-[0.14em] font-bold opacity-85 mb-1.5">
            ⏳ Round of {waiting.round.date.slice(8)}/{waiting.round.date.slice(5, 7)} — still waiting
          </p>
          <div className="space-y-1.5">
            {waitingItems.map((it) => (
              <Link
                key={`${it.kidId}-${it.kind}`}
                href={`/award?round=${waiting.round.date}&kid=${it.kidId}`}
                className="block rounded-kaya-sm px-3 py-2 text-[12.5px] font-bold transition-colors hover:bg-white/25"
                style={{ background: 'rgba(255,255,255,.13)', border: '1px solid rgba(255,255,255,.25)' }}
              >
                {it.emoji} {it.line} <span className="opacity-80">→</span>
              </Link>
            ))}
          </div>
          <p className="text-[10.5px] opacity-75 mt-2">Tap a kid — the award sheet comes pre-filled. Two taps and their Shine Card is minted.</p>
        </div>
      ) : (
        <div className="rounded-kaya border border-kaya-warm-dark bg-white px-4 py-3 mb-5">
          <p className="text-[12.5px] font-bold">✅ Nothing waiting — every round is answered.</p>
          <p className="text-[11px] text-kaya-sand mt-0.5">Spotted something shine-worthy anyway? <Link href="/award" className="text-kaya-gold font-bold hover:underline">Celebrate spontaneously →</Link> (✨ paints the map too)</p>
        </div>
      )}

      <div className="bg-white border border-kaya-warm-dark rounded-kaya-lg p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-kaya-sand mb-3">🗓️ Recognition Hit-Map</p>
        <RecognitionHitMap />
      </div>

      {/* 🌟 FX PR-3 — the recognition history: every card, easy to go back. */}
      <div className="mt-5">
        <ShineWall familyId={profile.familyId} title="🌟 Recognition history" />
      </div>
    </div>
  );
}
