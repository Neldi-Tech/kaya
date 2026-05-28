'use client';

// Kaya Sparks · shared screen chrome for an area surface
// (/sparks/[kidId]/school-projects, /home-projects, etc.).
//
// Wraps every area page in the mockup's "detail" treatment: a coloured
// detail-head (gradient per area), then a white body with the page's
// content. Also renders a "Back to {kid}'s Sparks" pill so children
// can navigate up cleanly — the AppShell BackBar handles the broader
// up-nav, but per-area back is more legible inside the section.

import Link from 'next/link';
import type { ReactNode } from 'react';
import { SPARKS_AREA_META, type SparksItemArea } from '@/lib/sparks/schema';

// Gradient + text colour per area — pulled directly from the mockup
// (`.head-coral`, `.head-yellow`, `.head-green`, `.head-purple`, `.head-mint`).
// Revision = navy → purple (its own "study + brain" identity).
export const AREA_HEAD_BG: Record<SparksItemArea | 'academic', string> = {
  school_project:      'linear-gradient(135deg, #FF6B6B 0%, #FF8E72 100%)',
  home_project:        'linear-gradient(135deg, #FFB627 0%, #FFD93D 100%)',
  achievement:         'linear-gradient(135deg, #6BCB77 0%, #9DE0A6 100%)',
  academic:            'linear-gradient(135deg, #A66CFF 0%, #C49BFF 100%)',
  sports_subscription: 'linear-gradient(135deg, #4ECDC4 0%, #6FE5DC 100%)',
  revision:            'linear-gradient(135deg, #1B1547 0%, #5A3CB8 100%)',
};

export const AREA_HEAD_FG: Record<SparksItemArea | 'academic', string> = {
  school_project: '#fff',
  home_project:   '#0F1F44',
  achievement:    '#fff',
  academic:       '#fff',
  sports_subscription: '#fff',
  revision:       '#fff',
};

interface Props {
  kidId: string;
  kidName: string;
  area: SparksItemArea | 'academic';
  /** Right-side detail under the title (e.g. "12 captured · 3 upcoming"). */
  subtitle?: string;
  /** Right-aligned CTA, typically the "+ Add" button. */
  action?: ReactNode;
  /** Page content. Rendered inside a white card with 18×20 padding. */
  children: ReactNode;
}

export default function AreaScreen({
  kidId, kidName, area, subtitle, action, children,
}: Props) {
  const meta = SPARKS_AREA_META[area];
  return (
    <div className="min-h-screen bg-[#FFFBF5]">
      {/* Width steps: phone on mobile, 3xl on tablet, 5xl on desktop,
          6xl on xl — area surfaces fill the canvas next to the 260px
          AppShell sidebar instead of looking like centred phones. */}
      <div className="mx-auto max-w-md sm:max-w-3xl lg:max-w-5xl xl:max-w-6xl">
        {/* Back to kid Sparks home */}
        <div className="px-4 pt-4 lg:px-6">
          <Link
            href={`/sparks/${kidId}`}
            className="inline-flex items-center gap-1.5 pl-2.5 pr-3.5 py-1.5 rounded-full bg-white border border-[#ECE4D3] text-[#0F1F44] font-display font-extrabold text-[12px] no-underline hover:border-[#D4A847] transition-colors"
          >
            <span className="text-[13px] leading-none opacity-60" aria-hidden>‹</span>
            <span>{kidName}&apos;s Sparks</span>
          </Link>
        </div>

        {/* Detail card */}
        <div className="px-4 pt-3 pb-8 lg:px-6">
          <div className="bg-white rounded-[24px] shadow-[0_8px_24px_rgba(15,31,68,0.08)] overflow-hidden">
            {/* Detail head — coloured gradient + title + optional subtitle.
                Taller / more present on lg+ so the detail-head doesn't read
                as a tiny strip on a wide canvas. */}
            <div
              className="px-5 py-4 lg:px-7 lg:py-5 flex items-start justify-between gap-3"
              style={{ background: AREA_HEAD_BG[area], color: AREA_HEAD_FG[area] }}
            >
              <div className="min-w-0">
                <h1 className="font-display font-extrabold text-[16px] lg:text-[20px] m-0 leading-tight">
                  {meta.emoji} {meta.label}
                </h1>
                {subtitle && (
                  <div className="text-[12px] lg:text-[13px] opacity-90 mt-0.5">{subtitle}</div>
                )}
              </div>
              {action}
            </div>

            {/* Detail body */}
            <div className="px-5 py-5 lg:px-7 lg:py-6">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Compact "+ Add" pill used in `<AreaScreen action>`. Matches the
 *  detail-head colour scheme automatically. */
export function AddItemButton({
  onClick, label = '+ Add', fg, bg,
}: {
  onClick: () => void;
  label?: string;
  fg?: string;
  bg?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-[12px] font-extrabold whitespace-nowrap"
      style={{
        background: bg ?? 'rgba(255,255,255,0.22)',
        color: fg ?? 'inherit',
        border: '1px solid rgba(255,255,255,0.35)',
      }}
    >
      {label}
    </button>
  );
}

/** Shared empty-state card body. Each area page passes its own copy +
 *  CTA, but the rounded shell + iconography stay consistent. */
export function AreaEmptyState({
  emoji, title, body, action,
}: {
  emoji: string;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-[#FBF7EE] rounded-2xl px-5 py-8 text-center">
      <div className="text-4xl mb-2" aria-hidden>{emoji}</div>
      <div className="font-display font-extrabold text-[14.5px] text-[#0F1F44]">{title}</div>
      <p className="text-[12.5px] text-[#5A6488] mt-1 mb-4 leading-snug">{body}</p>
      {action}
    </div>
  );
}
