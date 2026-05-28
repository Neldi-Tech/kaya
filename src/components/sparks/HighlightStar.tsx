'use client';

// Kaya Sparks · ☆/★ button for an individual gallery item.
//
// • Parent / owning kid taps → toggles `is_highlight`.
// • When already 5 starred items in the same area, taps on an
//   un-starred row prompt for a friendly nudge to swap one out.
// • Helpers and other family members see nothing (no button).

import { useState } from 'react';
import { setItemHighlight } from '@/lib/sparks/firestore';
import { HIGHLIGHTS_CAP } from '@/lib/sparks/grouping';
import type { SparksItem } from '@/lib/sparks/schema';

interface Props {
  item: SparksItem;
  familyId: string;
  /** All items in the same area (used to enforce the 5-per-area cap). */
  areaItems: SparksItem[];
  /** When false, the button is hidden. */
  canEdit: boolean;
  /** Optional className overrides — keeps the parent layout in charge. */
  className?: string;
}

export default function HighlightStar({ item, familyId, areaItems, canEdit, className }: Props) {
  const [busy, setBusy] = useState(false);

  if (!canEdit) return null;

  const isHighlight = !!item.is_highlight;
  const starredCount = areaItems.reduce((n, it) => n + (it.is_highlight ? 1 : 0), 0);

  const onClick = async () => {
    if (busy) return;
    // Adding past the cap — ask the kid / parent to swap one out first.
    if (!isHighlight && starredCount >= HIGHLIGHTS_CAP) {
      if (typeof window !== 'undefined') {
        window.alert(`You can highlight up to ${HIGHLIGHTS_CAP} items per area.\nUn-star one of the current highlights first.`);
      }
      return;
    }
    setBusy(true);
    try { await setItemHighlight(familyId, item.id, !isHighlight); }
    finally { setBusy(false); }
  };

  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      disabled={busy}
      aria-pressed={isHighlight}
      aria-label={isHighlight ? `Remove ${item.title} from highlights` : `Add ${item.title} to highlights`}
      title={isHighlight ? 'Highlighted — tap to remove' : 'Tap to add to highlights'}
      className={`text-[14px] leading-none px-1 transition ${isHighlight ? 'text-[#D4A847]' : 'text-[#5A6488] hover:text-[#D4A847]'} ${className ?? ''}`}
    >
      {isHighlight ? '★' : '☆'}
    </button>
  );
}
