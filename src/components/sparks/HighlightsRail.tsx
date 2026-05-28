'use client';

// Kaya Sparks · ✨ All-time Highlights rail.
//
// Horizontal scrolling strip of up to HIGHLIGHTS_CAP starred items.
// Sits above the month-grouped gallery on Home / School / Achievements.
// Tapping a card opens the same lightbox the kid would get from the
// normal tile. The ★ pin in the corner is decorative — toggling
// happens via the ☆ button on the tile/row below.
//
// Always-rendered header — even when nothing is starred yet, the header
// + a friendly empty state appear so the feature is discoverable. The
// only path that returns null is the "no items at all + nothing the
// caller can guide the kid toward" case (caller filters by canEdit).

import type { SparksItem } from '@/lib/sparks/schema';
import { toDisplayDate } from '@/lib/dates';

interface Props {
  items: SparksItem[];                       // already filtered to is_highlight === true
  fallbackTileGradient: string;              // for items without a photo
  onOpenItem?: (item: SparksItem) => void;   // tap → lightbox / detail
  /** When true, the empty-state nudge renders ("Tap ☆ on a project…").
   *  When false (kid view + nothing starred), we hide the rail entirely
   *  rather than show a useless prompt the kid can't act on. */
  showEmptyState?: boolean;
}

export default function HighlightsRail({ items, fallbackTileGradient, onOpenItem, showEmptyState }: Props) {
  const isEmpty = items.length === 0;
  if (isEmpty && !showEmptyState) return null;

  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between px-1 pb-1.5">
        <div className="text-[12px] font-extrabold tracking-[0.4px] text-[#1B1547] flex items-center gap-1.5">
          ✨ All-time highlights
        </div>
        <span className="text-[10.5px] font-extrabold text-[#5A6488]">{items.length} / 5</span>
      </div>

      {isEmpty && (
        <div
          className="rounded-[12px] border-2 border-dashed text-[#5A6488] text-center px-3 py-3 mb-1"
          style={{ borderColor: '#D4A847', background: '#FFFBF0' }}
        >
          <div className="text-[18px] mb-0.5" aria-hidden>⭐</div>
          <div className="text-[11.5px] font-bold leading-snug text-[#1B1547]">
            Tap <span className="text-[#D4A847]">☆</span> on any project below to feature it here.
          </div>
          <div className="text-[10.5px] mt-0.5">Up to 5 highlights per area.</div>
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
              title={`✨ Highlight · ${it.title}`}
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
