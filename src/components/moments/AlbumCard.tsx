'use client';

// A single album tile in the Albums grid. Renders the cover (real
// photo if present, gradient placeholder if not), the access chip,
// photo count, and album name + meta.

import Link from 'next/link';
import type { Album } from '@/lib/albums';

interface Props {
  album: Album;
  href: string;
  subAlbumCount?: number;
}

export default function AlbumCard({ album, href, subAlbumCount }: Props) {
  const isParentsOnly = album.accessMode === 'custom' && album.accessList.length <= 2;

  return (
    <Link
      href={href}
      className="bg-white border border-kaya-warm-dark rounded-kaya overflow-hidden hover:border-kaya-chocolate transition-colors flex flex-col"
    >
      <div className={`relative aspect-square ${album.coverThumbUrl ? 'bg-kaya-warm' : gradientForAlbum(album.id)}`}>
        {album.coverThumbUrl && (
          <img
            src={album.coverThumbUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover"
            loading="lazy"
          />
        )}
        <span
          className={`absolute top-2 right-2 text-[10px] font-display font-black px-2 py-1 rounded-md tracking-wide flex items-center gap-1 ${
            album.accessMode === 'all_family'
              ? 'bg-black/70 text-kaya-gold-light backdrop-blur-sm'
              : isParentsOnly
                ? 'bg-red-700/85 text-white'
                : 'bg-kaya-chocolate/85 text-kaya-gold-light'
          }`}
        >
          {album.accessMode === 'all_family' ? (
            <>👨‍👩‍👧 Family</>
          ) : isParentsOnly ? (
            <>🔒 Parents</>
          ) : (
            <>+{album.accessList.length} members</>
          )}
        </span>
        <span className="absolute bottom-2 left-2 text-[10px] font-display font-black px-2 py-1 rounded-md bg-white/85 text-kaya-chocolate">
          {album.photoCount} {album.photoCount === 1 ? 'photo' : 'photos'}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <p className="font-display font-black text-sm leading-tight text-kaya-chocolate truncate">{album.name || 'Untitled album'}</p>
        <p className="text-[11px] text-kaya-sand mt-0.5 flex items-center gap-1">
          {subAlbumCount && subAlbumCount > 0 ? (
            <>🗂️ {subAlbumCount} sub-album{subAlbumCount === 1 ? '' : 's'}</>
          ) : album.description ? (
            <span className="truncate">{album.description}</span>
          ) : (
            <>📷 Album</>
          )}
        </p>
      </div>
    </Link>
  );
}

// Deterministic gradient per album so a placeholder cover stays
// stable across re-renders without storing colour metadata on the
// doc. Picks from a small warm palette that matches Moments tones.
const GRADIENTS = [
  'bg-gradient-to-br from-amber-300 via-amber-600 to-amber-900',
  'bg-gradient-to-br from-rose-200 via-rose-400 to-rose-700',
  'bg-gradient-to-br from-stone-200 via-stone-400 to-stone-600',
  'bg-gradient-to-br from-emerald-200 via-emerald-500 to-emerald-800',
  'bg-gradient-to-br from-sky-200 via-sky-500 to-sky-800',
  'bg-gradient-to-br from-yellow-200 via-yellow-500 to-yellow-800',
];

function gradientForAlbum(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}
