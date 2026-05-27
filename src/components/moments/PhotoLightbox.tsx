'use client';

// Full-screen photo viewer for an album. Renders the `feedUrl`
// variant (1080px long edge — keeps bandwidth sane on mobile while
// still sharp on tablets/desktop). Swipe via prev/next buttons; tap
// the backdrop to close. Keyboard: ← → for nav, Esc to close.

import { useEffect, useState } from 'react';
import type { AlbumPhoto } from '@/lib/albums';
import { downloadImage, suggestedPhotoFilename } from '@/lib/downloadImage';

interface Props {
  photos: AlbumPhoto[];
  index: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}

export default function PhotoLightbox({ photos, index, onPrev, onNext, onClose }: Props) {
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft') onPrev();
      else if (e.key === 'ArrowRight') onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onPrev, onNext, onClose]);

  const photo = photos[index];
  if (!photo) return null;
  const hasPrev = index > 0;
  const hasNext = index < photos.length - 1;

  const onDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadImage(photo.fullUrl, suggestedPhotoFilename(photo.uploadedAt));
    } catch (err) {
      console.error('Photo download failed', err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 text-white font-display font-black text-lg flex items-center justify-center transition-colors"
        aria-label="Close"
      >
        ✕
      </button>

      {/* Counter */}
      <div className="absolute top-5 left-4 z-10 px-2.5 py-1 rounded-md bg-white/15 text-white text-xs font-display font-bold">
        {index + 1} / {photos.length}
      </div>

      {/* Image */}
      <div className="relative max-w-full max-h-full px-4 py-12 lg:px-16">
        <img
          src={photo.feedUrl}
          alt=""
          className="max-w-full max-h-[85vh] object-contain"
          style={{ aspectRatio: `${photo.width} / ${photo.height}` }}
        />
      </div>

      {/* Prev */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          className="absolute left-2 lg:left-6 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white text-2xl flex items-center justify-center transition-colors"
          aria-label="Previous photo"
        >
          ‹
        </button>
      )}
      {/* Next */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          className="absolute right-2 lg:right-6 top-1/2 -translate-y-1/2 z-10 w-12 h-12 rounded-full bg-white/15 hover:bg-white/25 text-white text-2xl flex items-center justify-center transition-colors"
          aria-label="Next photo"
        >
          ›
        </button>
      )}

      {/* Bottom meta strip */}
      <div className="absolute bottom-0 left-0 right-0 z-10 px-4 py-3 bg-gradient-to-t from-black/80 to-transparent text-white text-xs flex items-center justify-between">
        <span className="font-display font-bold opacity-80">
          {photo.uploadedAt?.toDate?.()?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) || ''}
        </span>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading}
          className="px-3 py-1 rounded-md bg-white/15 hover:bg-white/25 font-display font-bold transition-colors disabled:opacity-60"
        >
          {downloading ? 'Saving…' : 'Download ↓'}
        </button>
      </div>
    </div>
  );
}
