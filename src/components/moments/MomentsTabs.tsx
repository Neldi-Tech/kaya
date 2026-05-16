'use client';

// Feed | Albums toggle at the top of /moments and /moments/albums.
// Renders as a tab strip with an active gold underline. Counts are
// optional — pass them when available so the badges advertise both
// halves of the surface.

import Link from 'next/link';

interface Props {
  active: 'feed' | 'albums';
  feedCount?: number;
  albumCount?: number;
}

export default function MomentsTabs({ active, feedCount, albumCount }: Props) {
  return (
    <div className="flex gap-0 border-b border-kaya-warm-dark -mx-4 px-4 lg:-mx-8 lg:px-8">
      <Tab href="/moments" emoji="📰" label="Feed" active={active === 'feed'} count={feedCount} />
      <Tab href="/moments/albums" emoji="🎞️" label="Keepsake" active={active === 'albums'} count={albumCount} />
    </div>
  );
}

function Tab({
  href, emoji, label, active, count,
}: {
  href: string;
  emoji: string;
  label: string;
  active: boolean;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className={`relative flex items-center gap-1.5 px-1 pt-2 pb-3 mr-5 font-display font-bold text-sm transition-colors ${
        active ? 'text-kaya-chocolate' : 'text-kaya-sand hover:text-kaya-chocolate'
      }`}
    >
      <span className="text-base">{emoji}</span>
      <span>{label}</span>
      {typeof count === 'number' && (
        <span
          className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
            active ? 'bg-kaya-gold/20 text-kaya-gold-dark' : 'bg-kaya-warm text-kaya-sand'
          }`}
        >
          {count}
        </span>
      )}
      {active && (
        <span className="absolute left-0 right-0 -bottom-px h-[3px] bg-kaya-gold rounded-t" />
      )}
    </Link>
  );
}
