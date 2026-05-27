'use client';

// Kaya Sparks · module landing (/sparks).
//
// Parents land on a kid selector — one tile per kid → /sparks/[kidId].
// Kids skip the selector and route straight to their own page.
// Helpers see a parent-style selector but limited to the kids in
// their HelperLink.kidIds scope (Slice 2 will scope; today they see
// every kid since the link doc isn't queried yet).
//
// The page is parent-led (Premium navy/gold/cream) since the parent
// chooses which kid they're managing. The kid pages themselves swap
// to Bold-and-Playful (warm-white #FFFBF5 + kid palette accents).
// Spec section 7 + locked-decision #5 (placement) drive the look.
//
// Slice 1 (2026-05-27) ships the landing + kid home shell — capture
// flows arrive in Slice 2.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useSparksFeatures } from '@/lib/sparks/gating';
import KidAvatar from '@/components/ui/KidAvatar';

export default function SparksLandingPage() {
  const { profile } = useAuth();
  const { family, children } = useFamily();
  const router = useRouter();
  const features = useSparksFeatures();
  const isKid = profile?.role === 'kid';

  // Kids skip the selector — drop them on their own Sparks home.
  useEffect(() => {
    if (isKid && profile?.childId) {
      router.replace(`/sparks/${profile.childId}`);
    }
  }, [isKid, profile?.childId, router]);

  const visibleKids = useMemo(() => {
    // Lite is single-kid; show the first kid only so the parent isn't
    // surprised by sibling tiles that turn out to be paywalled in
    // Slice 2 when the per-kid cap actually starts firing.
    if (!features.multiKid) return children.slice(0, 1);
    return children;
  }, [children, features.multiKid]);

  // While the kid redirect is in flight, render nothing — the splash
  // happens fast and a flash of the selector reads as "wrong page".
  if (isKid) return null;

  return (
    <div className="min-h-[80vh] bg-[#FBF7EE] text-[#0F1F44]">
      <div className="mx-auto max-w-3xl px-5 lg:px-8 pt-8 pb-16">
        {/* Header ─────────────────────────────────────────── */}
        <div className="flex items-start gap-4 mb-6">
          <div
            className="w-14 h-14 rounded-2xl grid place-items-center text-3xl shrink-0"
            style={{ background: 'linear-gradient(135deg,#FFF4D6,#FFE8E5)' }}
            aria-hidden
          >
            ✨
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-extrabold text-3xl tracking-tight m-0">Kaya Sparks</h1>
            <p className="text-[#6E7791] text-[14px] mt-1 leading-snug max-w-prose">
              A keep-and-grow space for everything your kids create, achieve, and learn —
              school projects, home builds, awards, term grades, and sports — with a
              gentle AI companion that helps you nurture what&apos;s already showing up.
            </p>
          </div>
        </div>

        {/* Plan strip ────────────────────────────────────── */}
        <div className="flex items-center gap-2 text-[12px] mb-8">
          <span
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold uppercase tracking-wider"
            style={{ background: '#FFF4D6', color: '#9C7A1D' }}
          >
            <span aria-hidden>{features.plan === 'pro' ? '🏰' : features.plan === 'family' ? '🏠' : '🏡'}</span>
            Sparks {features.plan === 'pro' ? 'Pro' : features.plan === 'family' ? 'Family' : 'Lite'}
          </span>
          {!features.aiScan && (
            <span className="text-[#6E7791]">· AI scanning unlocks on Home / Castle</span>
          )}
          {features.plan === 'family' && (
            <span className="text-[#6E7791]">· Full AI + dashboard included</span>
          )}
        </div>

        {/* Kid selector ─────────────────────────────────── */}
        <h2 className="font-display font-bold text-lg mb-3">Pick a child</h2>
        {!family ? (
          <div className="text-[#6E7791] text-sm">Loading your family…</div>
        ) : visibleKids.length === 0 ? (
          <div className="bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-6 text-center">
            <p className="text-[14px] text-[#0F1F44] font-medium">No kids on this family yet.</p>
            <Link href="/settings" className="inline-block mt-3 text-[#D4A847] font-bold text-[13px]">
              Add a child in Settings →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {visibleKids.map((kid) => (
              <Link
                key={kid.id}
                href={`/sparks/${kid.id}`}
                className="group flex items-center gap-3 bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 hover:border-[#D4A847] hover:shadow-[0_8px_24px_rgba(15,31,68,0.06)] transition-all no-underline"
              >
                <KidAvatar child={kid} size="lg" />
                <div className="flex-1 min-w-0">
                  <div className="font-display font-extrabold text-[15px] text-[#0F1F44] truncate">{kid.name}</div>
                  <div className="text-[12px] text-[#6E7791] mt-0.5">
                    {kid.totalPoints?.toLocaleString() ?? 0} Kaya Points
                  </div>
                </div>
                <span
                  className="text-[#D4A847] font-bold text-lg group-hover:translate-x-0.5 transition-transform"
                  aria-hidden
                >→</span>
              </Link>
            ))}
            {!features.multiKid && children.length > 1 && (
              <Link
                href="/settings/subscription"
                className="flex items-center gap-3 bg-[#FFF4D6] border border-[#D4A847]/40 rounded-2xl p-4 hover:border-[#D4A847] transition-colors no-underline"
              >
                <div
                  className="w-12 h-12 rounded-2xl grid place-items-center text-xl shrink-0"
                  style={{ background: '#fff' }}
                  aria-hidden
                >🔒</div>
                <div className="flex-1">
                  <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">
                    + {children.length - 1} more {children.length - 1 === 1 ? 'child' : 'children'}
                  </div>
                  <div className="text-[11.5px] text-[#6E7791] mt-0.5">
                    Upgrade to Home to manage up to 5 kids
                  </div>
                </div>
              </Link>
            )}
          </div>
        )}

        {/* AI companion teaser ──────────────────────────── */}
        <div className="mt-10">
          <h2 className="font-display font-bold text-lg mb-3">Your AI companion</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <CompanionCard
              tone="celebrate"
              icon="🔍"
              title="Scan & label"
              body="Bulk-upload years of artwork or report cards. Sparks auto-dates and auto-labels."
              locked={!features.aiScan}
            />
            <CompanionCard
              tone="suggest"
              icon="✏️"
              title="Gentle highlights"
              body="Before submission, Sparks flags letter shape, blanks, missing steps — and never blocks the submit button."
              locked={!features.aiHighlights}
            />
            <CompanionCard
              tone="watch"
              icon="🌱"
              title="Pattern spotting"
              body="Reads across school, home, and sports to surface emerging talents and quiet early warnings."
              locked={!features.aiScan}
            />
          </div>
          {(!features.aiScan || !features.aiHighlights) && (
            <Link
              href="/settings/subscription"
              className="inline-flex mt-4 px-4 py-2.5 rounded-xl font-extrabold text-[13px] no-underline"
              style={{ background: '#D4A847', color: '#0F1F44' }}
            >
              Unlock AI on Kaya Home →
            </Link>
          )}
        </div>

        {/* Parent-only setup link ──────────────────────── */}
        <div className="mt-10 pt-6 border-t border-[rgba(15,31,68,0.08)] flex items-center justify-between">
          <div>
            <div className="font-display font-bold text-[14px] text-[#0F1F44]">Sparks setup</div>
            <div className="text-[12px] text-[#6E7791] mt-0.5">Sibling visibility, subjects, AI toggles, workplan wiring.</div>
          </div>
          <Link
            href="/sparks/setup"
            className="text-[#D4A847] font-bold text-[13px] no-underline whitespace-nowrap"
          >
            Open setup →
          </Link>
        </div>
      </div>
    </div>
  );
}

function CompanionCard({
  tone, icon, title, body, locked,
}: {
  tone: 'celebrate' | 'suggest' | 'watch';
  icon: string;
  title: string;
  body: string;
  locked?: boolean;
}) {
  // Subtle accent strip on the left — three different tones to make the
  // three companion shapes visually distinct without going kid-bright on
  // the parent-facing landing.
  const accent =
    tone === 'celebrate' ? '#6BCB77' :
    tone === 'suggest'   ? '#4ECDC4' :
                           '#A66CFF';
  return (
    <div
      className="relative bg-white border border-[rgba(15,31,68,0.08)] rounded-2xl p-4 overflow-hidden"
    >
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: accent }}
        aria-hidden
      />
      <div className="flex items-start gap-3 pl-2">
        <span className="text-2xl leading-none" aria-hidden>{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="font-display font-extrabold text-[13.5px] text-[#0F1F44]">{title}</div>
            {locked && (
              <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-[#FFF4D6] text-[#9C7A1D]">
                Home+
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#6E7791] leading-snug mt-1 m-0">{body}</p>
        </div>
      </div>
    </div>
  );
}
