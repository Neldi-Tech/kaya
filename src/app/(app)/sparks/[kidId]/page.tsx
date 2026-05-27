'use client';

// Kaya Sparks · kid Sparks home (/sparks/[kidId]).
//
// Bold-and-Playful surface (warm-white #FFFBF5 + kid palette accents,
// rounded geometry). Renders the kid's name + the five area cards;
// each card jumps to /sparks/[kidId]/<area-path> when Slice 2 lands.
// For Slice 1 the cards render WITHOUT a link — they show the area
// title + description + a "Capture lands next" pill so the family
// can already feel the surface without empty pages 404'ing under them.
//
// Parents can reach this page too — the same surface renders regardless
// of role; the only role-specific bit is the parent-only "Dashboard +
// Setup" action strip at the bottom. (Sibling visibility + dashboard
// route guards land in Slice 2 / Slice 5 respectively.)

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useSparksFeatures } from '@/lib/sparks/gating';
import KidAvatar from '@/components/ui/KidAvatar';
import {
  SPARKS_AREA_META, SPARKS_AREA_ORDER, type SparksArea,
} from '@/lib/sparks/schema';

// Kid palette accents per area — coral, sunny, grass, mint, purple
// in the locked area order. Pulled from the spec § 7 / mockup.
const AREA_ACCENT: Record<SparksArea, { bg: string; fg: string }> = {
  school_project:      { bg: '#FFE8E5', fg: '#E85C5C' }, // coral
  home_project:        { bg: '#FFF4D6', fg: '#B8860B' }, // sunny yellow
  achievement:         { bg: '#E5F7EF', fg: '#5BB85B' }, // grass green
  academic:            { bg: '#F0E8FB', fg: '#9B6BE3' }, // purple
  sports_subscription: { bg: '#DFF6F3', fg: '#2A9F94' }, // mint
};

export default function KidSparksHomePage() {
  const params = useParams<{ kidId: string }>();
  const kidId = params?.kidId;
  const router = useRouter();
  const { profile } = useAuth();
  const { children, loading } = useFamily();
  const features = useSparksFeatures();

  const isParent = profile?.role === 'parent';
  const isKid = profile?.role === 'kid';

  // Kid bouncer — a kid landing on a sibling's Sparks page when the
  // family hasn't enabled sibling visibility bounces them home. The
  // firestore.rules read of `sparks_profiles` is the source of truth;
  // this is the soft client-side bounce. Slice 2 wires the proper
  // profile fetch — Slice 1 only checks "you're not on your own page".
  const isSelf = !!profile?.childId && profile.childId === kidId;
  const kidViewingSibling = isKid && !isSelf;

  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  if (loading) {
    return <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">Loading…</div>;
  }

  if (!kid) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center px-5">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3" aria-hidden>🤷</div>
          <h1 className="font-display font-extrabold text-xl text-[#0F1F44]">We couldn&apos;t find that child</h1>
          <p className="text-[#6E7791] text-[13.5px] mt-2">
            They may have been removed, or the link is from another family.
          </p>
          <button
            type="button"
            onClick={() => router.push('/sparks')}
            className="mt-5 inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
            style={{ background: '#D4A847', color: '#0F1F44' }}
          >
            Back to Sparks
          </button>
        </div>
      </div>
    );
  }

  if (kidViewingSibling) {
    // Slice 1 stub. Slice 2 will resolve this via sibling_visibility on
    // the target's profile; for now we keep the kid out by default.
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center px-5">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3" aria-hidden>🤝</div>
          <h1 className="font-display font-extrabold text-xl text-[#0F1F44]">
            That&apos;s {kid.name}&apos;s Sparks
          </h1>
          <p className="text-[#6E7791] text-[13.5px] mt-2">
            Your family hasn&apos;t opened sibling Sparks yet. Ask a parent
            to flip it on in Sparks Setup.
          </p>
          <button
            type="button"
            onClick={() => router.push('/sparks')}
            className="mt-5 inline-flex px-4 py-2.5 rounded-xl font-extrabold text-[13px]"
            style={{ background: '#FFD93D', color: '#664D00' }}
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FFFBF5] text-[#0F1F44]">
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-8 pb-16">
        {/* Kid header — Bold-and-Playful avatar + name. */}
        <div className="flex items-center gap-4 mb-6">
          <KidAvatar child={kid} size="xl" />
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-extrabold text-3xl tracking-tight m-0 leading-tight">
              {kid.name}&apos;s Sparks
            </h1>
            <p className="text-[#6E7791] text-[13.5px] mt-1">
              Everything {kid.name} creates, achieves, and learns — in one place.
            </p>
          </div>
        </div>

        {/* AI nudge strip — Slice 5 wires the real companion. */}
        <div
          className="rounded-2xl p-4 mb-6 flex items-start gap-3"
          style={{ background: 'linear-gradient(135deg,#FFE8E5,#FFF4D6)' }}
        >
          <span className="text-2xl leading-none" aria-hidden>✨</span>
          <div className="flex-1">
            <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
              Your AI companion will land here
            </div>
            <p className="text-[12px] text-[#6E7791] leading-snug mt-1 m-0">
              Reminders, gentle nudges, talent spots — refreshed for {kid.name} every day.
              Lands with Slice 5.
            </p>
          </div>
        </div>

        {/* Five area cards ─────────────────────────────────── */}
        <h2 className="font-display font-bold text-lg mb-3">Five areas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {SPARKS_AREA_ORDER.map((areaKey) => {
            const meta = SPARKS_AREA_META[areaKey];
            const accent = AREA_ACCENT[areaKey];
            return (
              <div
                key={areaKey}
                className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 flex items-start gap-3"
              >
                <div
                  className="w-12 h-12 rounded-2xl grid place-items-center text-2xl shrink-0"
                  style={{ background: accent.bg, color: accent.fg }}
                  aria-hidden
                >
                  {meta.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">
                      {meta.label}
                    </div>
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#FFF4D6] text-[#9C7A1D]">
                      Next slice
                    </span>
                  </div>
                  <p className="text-[12px] text-[#6E7791] leading-snug mt-1 m-0">
                    {meta.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Parent-only strip ───────────────────────────────── */}
        {isParent && (
          <div className="mt-8 pt-6 border-t border-[rgba(15,31,68,0.08)] grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href={`/sparks/${kid.id}/dashboard`}
              className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 flex items-center gap-3 hover:border-[#D4A847] transition-colors no-underline"
            >
              <span className="text-2xl" aria-hidden>📊</span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">Progress dashboard</div>
                <div className="text-[11.5px] text-[#6E7791] mt-0.5">
                  Ratings, trends, AI insights — lands with Slice 5.
                  {!features.familyRollup && ' Family roll-up is Home+.'}
                </div>
              </div>
              <span className="text-[#D4A847] font-bold text-lg" aria-hidden>→</span>
            </Link>
            <Link
              href="/sparks/setup"
              className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 flex items-center gap-3 hover:border-[#D4A847] transition-colors no-underline"
            >
              <span className="text-2xl" aria-hidden>⚙️</span>
              <div className="flex-1 min-w-0">
                <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">Sparks setup</div>
                <div className="text-[11.5px] text-[#6E7791] mt-0.5">
                  Sibling visibility, subjects, AI toggles, workplan wiring.
                </div>
              </div>
              <span className="text-[#D4A847] font-bold text-lg" aria-hidden>→</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
