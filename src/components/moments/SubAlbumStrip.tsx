'use client';

// Horizontal scrolling strip of sub-albums on an album detail page.
// Renders one tile per sub-album plus a trailing "+ New" tile when
// the user is allowed to add (custom access + has perm).

import Link from 'next/link';
import type { Album } from '@/lib/albums';

interface Props {
  parentAlbumId: string;
  subAlbums: Album[];
  canAddSubAlbum: boolean;
}

export default function SubAlbumStrip({ parentAlbumId, subAlbums, canAddSubAlbum }: Props) {
  if (subAlbums.length === 0 && !canAddSubAlbum) return null;

  return (
    <div className="flex gap-2 overflow-x-auto -mx-4 px-4 lg:-mx-8 lg:px-8 pb-1">
      {subAlbums.map((sub) => (
        <Link
          key={sub.id}
          href={`/moments/albums/${sub.id}`}
          className="flex-shrink-0 w-20 flex flex-col gap-1.5"
        >
          <div className="relative h-20 w-20 rounded-kaya-sm overflow-hidden border border-kaya-warm-dark bg-kaya-warm">
            {sub.coverThumbUrl && (
              <img src={sub.coverThumbUrl} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
            )}
            {sub.accessMode === 'custom' && (
              <span className="absolute top-1 right-1 w-5 h-5 rounded-md bg-red-700/90 text-white text-[10px] flex items-center justify-center font-bold">🔒</span>
            )}
            <span className="absolute bottom-1 right-1 text-[9px] font-display font-black px-1.5 py-0.5 rounded bg-white/85 text-kaya-chocolate">
              {sub.photoCount}
            </span>
          </div>
          <p className="font-display font-bold text-[11px] text-kaya-chocolate text-center leading-tight truncate">{sub.name || 'Untitled'}</p>
        </Link>
      ))}
      {canAddSubAlbum && (
        <Link
          href={`/moments/albums/new?parent=${parentAlbumId}`}
          className="flex-shrink-0 w-20 flex flex-col gap-1.5"
        >
          <div className="h-20 w-20 rounded-kaya-sm border-2 border-dashed border-kaya-gold-dark bg-kaya-gold-light/30 flex items-center justify-center text-kaya-gold-dark text-2xl font-black">+</div>
          <p className="font-display font-bold text-[11px] text-kaya-gold-dark text-center">New</p>
        </Link>
      )}
    </div>
  );
}
