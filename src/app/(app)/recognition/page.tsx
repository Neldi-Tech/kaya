'use client';

// 🌟 Recognition (RR PR-5) — the shared front door for parents AND
// helpers: tonight's waiting round (tap → pre-filled Award page) + the
// Hit-Map rhythm. Settings stay parent-only on Manage Rewards; this page
// is read + celebrate. Kids don't see it (their side is the Shine Wall).

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import RecognitionHitMap from '@/components/rewards/RecognitionHitMap';
import RecognitionWizard from '@/components/rewards/RecognitionWizard';
import { ShineWall } from '@/components/rewards/ShineCards';
import BackButton from '@/components/ui/BackButton';

export default function RecognitionPage() {
  const { profile } = useAuth();
  const isAdult = profile?.role === 'parent' || profile?.role === 'helper';

  if (!profile) return null;
  if (!isAdult) {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-10 text-center">
        <p className="text-4xl mb-3">🌟</p>
        <p className="text-sm text-kaya-sand">Your Shine Cards live on your profile — go collect them there! ✨</p>
      </div>
    );
  }

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

      {/* 🌟 FX PR-4 — Elia's 7-step wizard: pick → detail → gift/🎲 →
          points? → card → approve (rail+Moments+emails+📤) → streak. */}
      <RecognitionWizard />

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
