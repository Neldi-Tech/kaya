'use client';

// Kaya Sparks · photo lightbox. Tap any captured photo on
// /sparks/[kidId]/school-projects, /home-projects, or /achievements
// to open it full-screen. Multi-photo items get prev/next nav.
//
// Behavior:
//   • Backdrop click → close
//   • ESC key       → close
//   • ← / →         → prev / next photo (when photos.length > 1)
//   • Body scroll locked while open
//
// Photos render at object-contain inside the viewport so portraits
// stay portrait + landscapes stay landscape. URLs are the feed-size
// variant (1080 px long edge) which is plenty for full-screen on
// most devices; the 2400 px full variant can be wired later if anyone
// asks for sharper.

import { useEffect } from 'react';

interface Props {
  photos: string[];
  index: number;
  onIndexChange: (idx: number) => void;
  onClose: () => void;
  /** Title shown in the caption strip; usually the item's title. */
  caption?: string;
  /** Sub-caption — usually the display date. */
  subCaption?: string;
}

export default function PhotoLightbox({
  photos, index, onIndexChange, onClose, caption, subCaption,
}: Props) {
  const current = photos[index];
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
      else if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
    };
    window.addEventListener('keydown', onKey);
    // lock body scroll while the lightbox is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [index, hasPrev, hasNext, onIndexChange, onClose]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={caption || 'Photo'}
      className="fixed inset-0 z-[60] flex items-center justify-center"
    >
      {/* Backdrop — tap closes */}
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/90"
      />

      {/* Image */}
      <div className="relative max-w-[95vw] max-h-[88vh] flex flex-col items-center pointer-events-none">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current}
          alt={caption || 'Captured photo'}
          className="max-w-[95vw] max-h-[80vh] object-contain rounded-xl shadow-2xl pointer-events-auto"
        />
        {(caption || subCaption || photos.length > 1) && (
          <div className="mt-3 text-center text-white pointer-events-auto">
            {caption && (
              <div className="font-display font-extrabold text-[15px]">{caption}</div>
            )}
            {subCaption && (
              <div className="text-[12px] opacity-75 mt-0.5">{subCaption}</div>
            )}
            {photos.length > 1 && (
              <div className="text-[11px] opacity-60 mt-1">{index + 1} / {photos.length}</div>
            )}
          </div>
        )}
      </div>

      {/* Close button — top right */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close photo"
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center text-lg font-extrabold backdrop-blur-sm transition-colors z-10"
      >
        ✕
      </button>

      {/* Prev / next arrows — only when there's more than one photo */}
      {photos.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => hasPrev && onIndexChange(index - 1)}
            disabled={!hasPrev}
            aria-label="Previous photo"
            className="absolute left-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center text-xl font-extrabold backdrop-blur-sm transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={() => hasNext && onIndexChange(index + 1)}
            disabled={!hasNext}
            aria-label="Next photo"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white grid place-items-center text-xl font-extrabold backdrop-blur-sm transition-colors disabled:opacity-25 disabled:cursor-not-allowed"
          >
            ›
          </button>
        </>
      )}
    </div>
  );
}
