'use client';

// /moments/albums — the Keepsake Albums grid.
//
// Lists top-level albums for this family, filtered by visibility
// (`canViewAlbum`). "+ New album" is gated by the family's plan:
// free tier hits a "Coming soon" upgrade card after the first
// album.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Album, canViewAlbum, subscribeToTopLevelAlbums, getFamilyPhotoCount,
} from '@/lib/albums';
import {
  canCreateTopLevelAlbum, getLimits, resolvePlan,
} from '@/lib/keepsakeLimits';
import MomentsTabs from '@/components/moments/MomentsTabs';
import AlbumCard from '@/components/moments/AlbumCard';
import UpgradeCard from '@/components/moments/UpgradeCard';
import BackButton from '@/components/ui/BackButton';

type Filter = 'all' | 'mine' | 'shared' | 'private';

export default function AlbumsGridPage() {
  const { profile } = useAuth();
  const { family } = useFamily();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [photoCount, setPhotoCount] = useState<number>(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [loaded, setLoaded] = useState(false);

  const plan = resolvePlan(family?.plan);
  const limits = getLimits(plan);
  const isParent = profile?.role === 'parent';

  useEffect(() => {
    if (!profile?.familyId) return;
    const unsub = subscribeToTopLevelAlbums(profile.familyId, (list) => {
      setAlbums(list);
      setLoaded(true);
    });
    return () => unsub();
  }, [profile?.familyId]);

  // Recompute the family-wide photo total whenever the album list
  // changes — the photoCount on each album is denormalised so the
  // sum is O(albums). Used to drive the free-tier 200-photo cap.
  useEffect(() => {
    if (!profile?.familyId) return;
    void getFamilyPhotoCount(profile.familyId).then(setPhotoCount);
  }, [profile?.familyId, albums]);

  const visibleAlbums = useMemo(() => {
    if (!profile) return [];
    return albums
      .filter((a) => canViewAlbum(a, profile.uid, isParent))
      .filter((a) => {
        switch (filter) {
          case 'mine': return a.createdBy === profile.uid;
          case 'shared': return a.accessMode === 'all_family';
          case 'private': return a.accessMode === 'custom';
          default: return true;
        }
      });
  }, [albums, profile, filter, isParent]);

  const myTopLevelCount = albums.filter((a) => a.createdBy === profile?.uid).length;
  const createGate = canCreateTopLevelAlbum(plan, myTopLevelCount);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="lg:hidden"><BackButton /></div>

      <div className="mb-4 lg:mb-6 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kaya-sand">Moments</p>
          <h1 className="font-display text-2xl lg:text-[34px] font-black tracking-tight">Keepsake 🎞️</h1>
          <p className="text-sm text-kaya-sand mt-1">Family albums — kept safe, shared with the right people.</p>
        </div>
        {createGate.allowed && (
          <Link
            href="/moments/albums/new"
            className="h-10 px-4 bg-kaya-gold text-white rounded-kaya-sm font-bold text-xs flex items-center hover:bg-kaya-gold-dark transition-colors"
          >
            + New album
          </Link>
        )}
      </div>

      <MomentsTabs active="albums" albumCount={visibleAlbums.length} />

      <div className="flex gap-1.5 mt-4 mb-4 overflow-x-auto -mx-4 px-4 lg:-mx-8 lg:px-8 pb-1">
        <FilterChip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        <FilterChip label="Mine" active={filter === 'mine'} onClick={() => setFilter('mine')} />
        <FilterChip label="Shared" active={filter === 'shared'} onClick={() => setFilter('shared')} />
        <FilterChip label="🔒 Private" active={filter === 'private'} onClick={() => setFilter('private')} />
      </div>

      {!loaded && (
        <div className="text-center py-12">
          <p className="text-3xl mb-2">⏳</p>
          <p className="text-kaya-sand text-sm">Loading albums…</p>
        </div>
      )}

      {loaded && visibleAlbums.length === 0 && filter === 'all' && (
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-8 text-center">
          <p className="text-5xl mb-3">🎞️</p>
          <p className="font-display font-black text-lg mb-1">Your Keepsake is empty</p>
          <p className="text-kaya-sand text-sm mb-4">
            Start an album for a trip, a birthday, or just "Daily Life". You decide who in the family sees each one.
          </p>
          {createGate.allowed && (
            <Link
              href="/moments/albums/new"
              className="inline-flex items-center gap-1.5 h-11 px-5 bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
            >
              📷 Create your first album
            </Link>
          )}
        </div>
      )}

      {loaded && visibleAlbums.length === 0 && filter !== 'all' && (
        <p className="text-center text-sm text-kaya-sand py-8">No albums match this filter.</p>
      )}

      {visibleAlbums.length > 0 && (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleAlbums.map((a) => (
            <AlbumCard key={a.id} album={a} href={`/moments/albums/${a.id}`} />
          ))}
        </div>
      )}

      {/* Free-tier upgrade card — visible whenever they're hitting
          the album OR photo cap. */}
      {plan === 'free' && (!createGate.allowed || photoCount >= limits.maxPhotosTotal * 0.8) && (
        <div className="mt-6">
          <UpgradeCard
            reason={
              !createGate.allowed
                ? `${createGate.reason} Family plan unlocks unlimited albums, sub-albums, and custom access lists.`
                : 'You\'re close to the free-tier photo cap. Family plan removes the limit.'
            }
            ctaMode="notify"
            usage={
              photoCount > 0
                ? { current: photoCount, max: limits.maxPhotosTotal, label: `${photoCount} of ${limits.maxPhotosTotal} photos used` }
                : undefined
            }
            onNotify={() => alert('We\'ll email you when Family plan launches.')}
          />
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`h-8 px-3 rounded-full border whitespace-nowrap font-display font-bold text-[11px] uppercase tracking-wide transition-colors ${
        active
          ? 'bg-kaya-chocolate text-kaya-gold-light border-kaya-chocolate'
          : 'bg-white text-kaya-sand border-kaya-warm-dark hover:border-kaya-chocolate'
      }`}
    >
      {label}
    </button>
  );
}
