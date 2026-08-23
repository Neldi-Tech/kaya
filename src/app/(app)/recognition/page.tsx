'use client';

// 🌟 Recognition (RR PR-5) — the shared front door for parents AND
// helpers: tonight's waiting round (tap → pre-filled Award page) + the
// Hit-Map rhythm. Settings stay parent-only on Manage Rewards; this page
// is read + celebrate. Kids don't see it (their side is the Shine Wall).

import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import RecognitionHitMap, { RecognitionStats } from '@/components/rewards/RecognitionHitMap';
import RecognitionWizard from '@/components/rewards/RecognitionWizard';
import { ShineWall, GiftRegister } from '@/components/rewards/ShineCards';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import BackButton from '@/components/ui/BackButton';
import { Page } from '@/components/layout/Page';

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

  // Web-Fit (2026-08-23): wide tier. Desktop hero row — wizard spans
  // 2/3, the counters sit beside it; the collapsible record sections
  // run full width below. Mobile markup/order unchanged.
  return (
    <Page width="wide">
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
      <div className="lg:grid lg:grid-cols-3 lg:gap-6 lg:items-start">
        <div className="lg:col-span-2"><RecognitionWizard /></div>

        {/* 📌 FX PR-8 — the counters live on TOP, always in good order. */}
        <div><RecognitionStats /></div>
      </div>

      {/* 🗓️ FX PR-7 — everything below the wizard collapses so the page
          never overstacks as the record grows. */}
      <div className="mb-4">
        <CollapsibleSection id="rec-hitmap" remember icon="🗓️" title="Recognition Hit-Map" summary="rhythm · streak · pattern" defaultOpen>
          <RecognitionHitMap showStats={false} />
        </CollapsibleSection>
      </div>

      {/* 🎁 FX PR-7 — the gift register: every gift, linked to its card. */}
      <div className="mb-4">
        <CollapsibleSection id="rec-gifts" remember icon="🎁" title="Gift register" summary="what was given, linked to each recognition">
          <GiftRegister familyId={profile.familyId} />
        </CollapsibleSection>
      </div>

      {/* 🌟 FX PR-3+7 — history, filterable by year + month. */}
      <div className="mb-4">
        <CollapsibleSection id="rec-history" remember icon="🌟" title="Recognition history" summary="every card · filter by year & month">
          <ShineWall familyId={profile.familyId} title="🌟 Recognition history" bare filterable />
        </CollapsibleSection>
      </div>
    </Page>
  );
}
