'use client';

// Kaya Sparks · rating display primitives. Render the latest rating on
// a tile (Home Projects, School Projects, etc.) in the mockup's style:
//
//   ⭐⭐⭐⭐ ⭐(faded)   4.0
//   ─────────── coral→green progress bar ────────  85%
//
// Companion to RatingSheet — the sheet writes; this just paints.
//
// "Rate" button when no rating exists; chip-style summary otherwise.
// Parent-only by convention (caller decides whether to render based on
// profile.role).

import type { SparksRating } from '@/lib/sparks/schema';

interface Props {
  rating: SparksRating | null;
  /** Tap target — opens RatingSheet (rate when null, edit when set). */
  onTap: () => void;
  /** Compact variant (tile-card) is the default. Set 'wide' when
   *  rendered in a row that has horizontal room (e.g. achievements). */
  variant?: 'compact' | 'wide';
}

export default function RatingDisplay({ rating, onTap, variant = 'compact' }: Props) {
  if (!rating) {
    return (
      <button
        type="button"
        onClick={onTap}
        className="text-[10.5px] font-extrabold uppercase tracking-wider rounded-full px-2.5 py-1 transition-colors"
        style={{ background: '#FFF1C9', color: '#8A6800' }}
      >
        ✨ Rate
      </button>
    );
  }

  const hasStars = typeof rating.stars === 'number';
  const hasPct = typeof rating.percent === 'number';

  if (variant === 'wide') {
    return (
      <button
        type="button"
        onClick={onTap}
        className="inline-flex items-center gap-2 bg-[#FFF1C9] hover:bg-[#FFE39A] transition-colors rounded-full px-3 py-1.5"
      >
        {hasStars && (
          <span className="text-[12px] font-extrabold text-[#8A6800]">
            ⭐ {rating.stars!.toFixed(1)}
          </span>
        )}
        {hasPct && (
          <span className="text-[11px] font-extrabold text-[#5A3CB8] bg-[#E5D6FF] rounded-full px-2 py-0.5">
            {rating.percent}%
          </span>
        )}
      </button>
    );
  }

  // Compact (tile) layout — mirrors the mockup's rated tile card:
  //   ⭐ row + score chip on row 1
  //   coral→green progress bar + % chip on row 2 (when percent set)
  return (
    <button
      type="button"
      onClick={onTap}
      className="w-full flex flex-col gap-1 -mt-0.5 cursor-pointer text-left"
      aria-label="Edit rating"
    >
      {hasStars && (
        <div className="flex items-center gap-1">
          <span className="text-[11px] leading-none" aria-hidden>
            {'⭐'.repeat(Math.round(rating.stars!))}
            <span className="opacity-25">{'⭐'.repeat(5 - Math.round(rating.stars!))}</span>
          </span>
          <span className="text-[10px] font-extrabold text-[#8A6800] bg-[#FFF1C9] rounded-full px-1.5 py-0.5 ml-auto">
            {rating.stars!.toFixed(1)}
          </span>
        </div>
      )}
      {hasPct && (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 h-1.5 bg-white rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${rating.percent}%`,
                background: 'linear-gradient(90deg, #FF6B6B, #6BCB77)',
              }}
            />
          </div>
          <span className="text-[10px] font-extrabold text-[#5A3CB8] bg-[#E5D6FF] rounded-full px-1.5 py-0.5">
            {rating.percent}%
          </span>
        </div>
      )}
    </button>
  );
}
