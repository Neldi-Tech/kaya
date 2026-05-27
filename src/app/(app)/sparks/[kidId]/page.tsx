'use client';

// Kaya Sparks · kid Sparks home (/sparks/[kidId]).
//
// Bold-and-Playful surface (warm-white #FFFBF5 + kid palette accents)
// styled 1:1 against `Kaya-Sparks_Mockup_2026-05-27.html` — the locked
// design. Layout:
//
//   ┌──────────────────────────────────┐
//   │ coral → purple gradient header   │
//   │   crumb · "Kaya › Sparks"        │
//   │   H2: "{kid}'s Sparks"           │
//   │   sub: "{House} House"           │
//   │   kid switcher pills (sibling-vis aware)
//   ├──────────────────────────────────┤
//   │ 5 area cards (row-style)         │
//   │   44×44 colored icon · title +   │
//   │   subtitle · count chip          │
//   │ purple → mint AI strip           │
//   ├──────────────────────────────────┤
//   │ (parent-only)                    │
//   │   Dashboard · Setup action strip │
//   └──────────────────────────────────┘
//
// Slice 1 (2026-05-27) — counts render as "Start" placeholders since
// sparks_items / sparks_academic / sparks_tasks are empty. Slice 2 wires
// real counts + makes the area cards clickable.

import { useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useSparksFeatures } from '@/lib/sparks/gating';
import {
  SPARKS_AREA_META, SPARKS_AREA_ORDER, type SparksArea,
} from '@/lib/sparks/schema';

// Kid palette accents per area — direct from the mockup
// (Step 2 · Module landing). Coral · Yellow · Green · Purple · Mint
// in the locked area order (school → home → achievement → academic → sports).
const AREA_ACCENT: Record<SparksArea, { bg: string; fg: string }> = {
  school_project:      { bg: '#FFE7E0', fg: '#E85C5C' }, // bg-coral
  home_project:        { bg: '#FFF1C9', fg: '#8A6800' }, // bg-yellow
  achievement:         { bg: '#DDF5DF', fg: '#2E7D34' }, // bg-green
  academic:            { bg: '#E5D6FF', fg: '#5A3CB8' }, // bg-purple
  sports_subscription: { bg: '#C9F0EC', fg: '#1E7873' }, // bg-mint
};

// Short single-line subtitles for the row cards — punchier than the
// SPARKS_AREA_META.description (which is the deep-dive paragraph).
const AREA_SUB: Record<SparksArea, string> = {
  school_project:      'Artwork, models, designs',
  home_project:        'Paper planes, builds, games',
  achievement:         'Certificates & awards',
  academic:            'Results, behavior, follow-ups',
  sports_subscription: 'Subscriptions, schedules',
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

  // Kid bouncer — Slice 1 keeps it simple: a kid viewing a SIBLING'S
  // page gets the friendly bounce. Slice 2 introduces the real
  // sparks_profiles.sibling_visibility lookup; today everyone defaults
  // to 'open' per the rules + visibility helpers.
  const isSelf = !!profile?.childId && profile.childId === kidId;
  const kidViewingSibling = isKid && !isSelf;

  const kid = useMemo(() => children.find((c) => c.id === kidId), [children, kidId]);

  // Switcher target list — every kid the viewer is allowed to see.
  // Parents see all kids; kids see themselves (sibling visibility wiring
  // lands in Slice 2 — for now the kid sees only self).
  const switcherKids = useMemo(() => {
    if (isParent) return features.multiKid ? children : children.slice(0, 1);
    if (isKid) return kid ? [kid] : [];
    return children;
  }, [isParent, isKid, children, features.multiKid, kid]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center text-[#0F1F44] text-sm">
        Loading…
      </div>
    );
  }

  if (!kid) {
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center px-5">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3" aria-hidden>🤷</div>
          <h1 className="font-display font-extrabold text-xl text-[#0F1F44]">
            We couldn&apos;t find that child
          </h1>
          <p className="text-[#5A6488] text-[13.5px] mt-2">
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
    return (
      <div className="min-h-screen bg-[#FFFBF5] grid place-items-center px-5">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3" aria-hidden>🤝</div>
          <h1 className="font-display font-extrabold text-xl text-[#0F1F44]">
            That&apos;s {kid.name}&apos;s Sparks
          </h1>
          <p className="text-[#5A6488] text-[13.5px] mt-2">
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
    <div className="min-h-screen bg-[#FFFBF5] text-[#1B2547]">
      {/* Phone-style content frame — caps width on desktop so the kid
          surface stays one-thumb-friendly even on a 27" monitor. */}
      <div className="mx-auto max-w-md">
        {/* Header — coral → purple gradient · per mockup Step 2. */}
        <div
          className="text-white px-5 pt-6 pb-6 rounded-b-[24px]"
          style={{ background: 'linear-gradient(135deg, #FF6B6B 0%, #A66CFF 100%)' }}
        >
          <div className="text-[12px] opacity-85 mb-1">Kaya › Sparks</div>
          <h1 className="font-display font-extrabold text-[22px] leading-tight tracking-tight m-0">
            {kid.name}&apos;s Sparks
          </h1>
          <div className="text-[13px] opacity-90 mt-1">
            {kid.houseName ? `${kid.houseName} House` : 'Kaya family'}
          </div>

          {/* Kid switcher pills */}
          {switcherKids.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {switcherKids.map((k) => {
                const active = k.id === kid.id;
                return (
                  <Link
                    key={k.id}
                    href={`/sparks/${k.id}`}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold no-underline transition-all ${
                      active
                        ? 'bg-white text-[#1B2547] shadow-sm'
                        : 'bg-white/25 text-white hover:bg-white/35'
                    }`}
                  >
                    <span
                      className="inline-block w-2 h-2 rounded-full"
                      style={{ background: k.houseColor || '#FFD93D' }}
                      aria-hidden
                    />
                    {k.name}
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Body — 5 area cards + AI strip. */}
        <div className="px-4 py-4">
          {SPARKS_AREA_ORDER.map((areaKey) => {
            const meta = SPARKS_AREA_META[areaKey];
            const accent = AREA_ACCENT[areaKey];
            return (
              <div
                key={areaKey}
                className="bg-white rounded-[18px] p-[14px] mb-2.5 flex items-center gap-3 border border-[#ECE4D3]"
              >
                <div
                  className="w-11 h-11 rounded-[14px] grid place-items-center text-xl shrink-0"
                  style={{ background: accent.bg, color: accent.fg }}
                  aria-hidden
                >
                  {meta.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-extrabold text-[14px] text-[#0F1F44] leading-tight">
                    {meta.label}
                  </div>
                  <div className="text-[11px] text-[#5A6488] mt-0.5 leading-tight">
                    {AREA_SUB[areaKey]}
                  </div>
                </div>
                {/* Count chip — placeholder "Start" until Slice 2 wires
                    sparks_items + sparks_academic + sparks_tasks counts. */}
                <span className="text-[11px] font-bold text-[#5A6488] bg-[#FBF7EE] px-2 py-1 rounded-full whitespace-nowrap">
                  Start
                </span>
              </div>
            );
          })}

          {/* AI strip — purple → mint gradient per mockup. */}
          <div
            className="text-white px-4 py-3.5 rounded-[16px] mt-3"
            style={{ background: 'linear-gradient(135deg, #A66CFF 0%, #4ECDC4 100%)' }}
          >
            <div className="text-[10px] font-extrabold tracking-[1px] opacity-85 mb-1">
              ✨ KAYA AI
            </div>
            <div className="text-[12px] leading-snug">
              <strong>Your AI companion will land here.</strong>{' '}
              Reminders · talent spotting · term summaries — refreshed daily for {kid.name}.
              Wires in with Slice 5.
            </div>
          </div>
        </div>

        {/* Parent-only action strip — keeps Premium surface so it reads
            as the parent's controls, not the kid's surface. */}
        {isParent && (
          <div className="px-4 pb-8 mt-4">
            <div className="border-t border-[#ECE4D3] pt-4 grid grid-cols-1 gap-2.5">
              <Link
                href={`/sparks/${kid.id}/dashboard`}
                className="bg-white border border-[#ECE4D3] rounded-[14px] p-3.5 flex items-center gap-3 hover:border-[#D4A847] transition-colors no-underline"
              >
                <span className="text-xl" aria-hidden>📊</span>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
                    Progress dashboard
                  </div>
                  <div className="text-[11px] text-[#5A6488] mt-0.5">
                    Ratings, trends, AI insights — wires in with Slice 5.
                    {!features.familyRollup && ' Family roll-up is Home+.'}
                  </div>
                </div>
                <span className="text-[#D4A847] font-bold text-lg" aria-hidden>→</span>
              </Link>
              <Link
                href="/sparks/setup"
                className="bg-white border border-[#ECE4D3] rounded-[14px] p-3.5 flex items-center gap-3 hover:border-[#D4A847] transition-colors no-underline"
              >
                <span className="text-xl" aria-hidden>⚙️</span>
                <div className="flex-1 min-w-0">
                  <div className="font-display font-extrabold text-[13px] text-[#0F1F44]">
                    Sparks setup
                  </div>
                  <div className="text-[11px] text-[#5A6488] mt-0.5">
                    Sibling visibility, subjects, AI toggles, workplan wiring.
                  </div>
                </div>
                <span className="text-[#D4A847] font-bold text-lg" aria-hidden>→</span>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
