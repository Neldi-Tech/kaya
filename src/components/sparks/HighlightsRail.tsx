'use client';

// Kaya Sparks · ✨ Today's Highlights rail.
//
// Horizontal scrolling strip of up to HIGHLIGHTS_CAP items, picked
// deterministically per (kid, area, day) via pickDailyHighlights().
// Same picks across all family members for the same day; tomorrow's
// seed rotates the set so the wall stays fresh without parent
// curation.
//
// The ★ pin in the corner is a decorative spotlight badge — not a
// "this is starred" indicator. The kid can't pin or unpin; the
// rotation is automatic.
//
// When the area has zero items, the empty-state nudge renders only
// for canEdit users so capture is the obvious next step.

import type { SparksItem } from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  items: SparksItem[];                       // today's picks — caller derives via pickDailyHighlights()
  fallbackTileGradient: string;              // for items without a photo
  onOpenItem?: (item: SparksItem) => void;   // tap → lightbox / detail
  /** When true, the "Capture a few projects to see daily picks here"
   *  nudge renders if items is empty. When false, the rail is hidden
   *  in the empty case (e.g. helpers + sibling view). */
  showEmptyState?: boolean;
}

export default function HighlightsRail({ items, fallbackTileGradient, onOpenItem, showEmptyState }: Props) {
  const isEmpty = items.length === 0;
  if (isEmpty && !showEmptyState) return null;

  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between px-1 pb-1.5">
        <div className="text-[12px] font-extrabold tracking-[0.4px] text-[#1B1547] flex items-center gap-1.5">
          ✨ Today&apos;s highlights
        </div>
        <span className="text-[10.5px] font-bold text-[#5A6488]">
          Refreshes every day
        </span>
      </div>

      {isEmpty && (
        <div
          className="rounded-[12px] border-2 border-dashed text-[#5A6488] text-center px-3 py-3 mb-1"
          style={{ borderColor: '#D4A847', background: '#FFFBF0' }}
        >
          <div className="text-[18px] mb-0.5" aria-hidden>⭐</div>
          <div className="text-[11.5px] font-bold leading-snug text-[#1B1547]">
            Capture a few projects to see daily picks here.
          </div>
          <div className="text-[10.5px] mt-0.5">Kaya rotates them each day.</div>
        </div>
      )}

      <div className="flex gap-2 overflow-x-auto -mx-1 px-1 pb-1.5">
        {items.map((it) => {
          const photo = it.photo_urls?.[0];
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => onOpenItem?.(it)}
              className="shrink-0 w-[110px] rounded-[12px] bg-white p-[5px] text-left relative"
              style={{
                border: '2px solid #D4A847',
                boxShadow: '0 4px 12px rgba(212, 168, 71, 0.30)',
              }}
              title={`✨ Today's highlight · ${it.title}`}
            >
              <span
                aria-hidden
                className="absolute top-1 right-1 z-[2] w-4 h-4 rounded-full text-white text-[10px] font-extrabold grid place-items-center"
                style={{
                  background: '#D4A847',
                  boxShadow: '0 2px 6px rgba(212, 168, 71, 0.45)',
                }}
              >
                ★
              </span>
              <div className="aspect-square rounded-[8px] overflow-hidden grid place-items-center" style={{ background: photo ? undefined : fallbackTileGradient }}>
                {photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={photo} alt={it.title} className="w-full h-full object-cover" />
                ) : (
                  <span className="text-2xl" aria-hidden>🌟</span>
                )}
              </div>
              <div className="text-[10px] font-extrabold text-[#0F1F44] mt-1 truncate">{it.title}</div>
              <div className="text-[8.5px] font-bold text-[#5A6488] mt-0.5">{toDisplayDate(it.date)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
