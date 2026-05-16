'use client';

// 3-col (mobile) / 4-col (desktop) tile grid of album photos. Tap a
// tile to open the PhotoLightbox at that index. Tiles are aspect-
// square crops of the `thumbUrl` variant (300px long edge).

import { useState } from 'react';
import type { AlbumPhoto } from '@/lib/albums';
import PhotoLightbox from './PhotoLightbox';

interface Props {
  photos: AlbumPhoto[];
  emptyHint?: string;
}

export default function AlbumPhotoGrid({ photos, emptyHint }: Props) {
  const [openAt, setOpenAt] = useState<number | null>(null);

  if (photos.length === 0) {
    return (
      <div className="bg-white border border-kaya-warm-dark rounded-kaya p-8 text-center">
        <p className="text-3xl mb-2">📷</p>
        <p className="text-sm text-kaya-sand">{emptyHint || 'No photos yet — tap + to add some.'}</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-3 lg:grid-cols-4 gap-1">
        {photos.map((p, i) => (
          <button
            key={p.id}
            onClick={() => setOpenAt(i)}
            className="relative aspect-square overflow-hidden rounded-md bg-kaya-warm border border-kaya-warm-dark hover:opacity-90 transition-opacity"
            aria-label={`Open photo ${i + 1}`}
          >
            <img
              src={p.thumbUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          </button>
        ))}
      </div>

      {openAt !== null && (
        <PhotoLightbox
          photos={photos}
          index={openAt}
          onPrev={() => setOpenAt((i) => (i !== null && i > 0 ? i - 1 : i))}
          onNext={() => setOpenAt((i) => (i !== null && i < photos.length - 1 ? i + 1 : i))}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}
