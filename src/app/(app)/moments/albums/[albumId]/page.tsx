'use client';

// /moments/albums/[albumId] — Album detail.
//
// Hero (cover + name + access chip), sub-album strip, photo grid,
// upload FAB. The PhotoLightbox lives inside AlbumPhotoGrid so this
// page stays a thin shell.

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import {
  Album, AlbumPhoto, getAlbum, subscribeToAlbumPhotos,
  subscribeToSubAlbums, uploadAlbumPhoto, setAlbumCover, canViewAlbum,
  getFamilyPhotoCount,
} from '@/lib/albums';
import { processPhotoForUpload } from '@/lib/photoUpload';
import { canCreateSubAlbum, canAddPhoto, resolvePlan, getLimits } from '@/lib/keepsakeLimits';
import BackButton from '@/components/ui/BackButton';
import SubAlbumStrip from '@/components/moments/SubAlbumStrip';
import AlbumPhotoGrid from '@/components/moments/AlbumPhotoGrid';
import UpgradeCard from '@/components/moments/UpgradeCard';

export default function AlbumDetailPage() {
  const params = useParams<{ albumId: string }>();
  const router = useRouter();
  const { profile } = useAuth();
  const { family } = useFamily();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [album, setAlbum] = useState<Album | null>(null);
  const [photos, setPhotos] = useState<AlbumPhoto[]>([]);
  const [subAlbums, setSubAlbums] = useState<Album[]>([]);
  const [photoCount, setPhotoCount] = useState<number>(0);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  const albumId = params?.albumId;
  const plan = resolvePlan(family?.plan);
  const limits = getLimits(plan);
  const isParent = profile?.role === 'parent';

  // Load the album doc once + check visibility before subscribing
  // to nested collections. Bouncing here on denied access avoids the
  // confusing "loading forever" state when rules say no.
  useEffect(() => {
    if (!profile?.familyId || !albumId) return;
    let cancelled = false;
    void getAlbum(profile.familyId, albumId).then((a) => {
      if (cancelled) return;
      if (!a) {
        setDenied(true);
        setLoaded(true);
        return;
      }
      if (!canViewAlbum(a, profile.uid, isParent)) {
        setDenied(true);
        setLoaded(true);
        return;
      }
      setAlbum(a);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [profile?.familyId, profile?.uid, albumId, isParent]);

  useEffect(() => {
    if (!profile?.familyId || !albumId || denied) return;
    const unsubPhotos = subscribeToAlbumPhotos(profile.familyId, albumId, setPhotos);
    const unsubSubs = subscribeToSubAlbums(profile.familyId, albumId, setSubAlbums);
    return () => { unsubPhotos(); unsubSubs(); };
  }, [profile?.familyId, albumId, denied]);

  useEffect(() => {
    if (!profile?.familyId) return;
    void getFamilyPhotoCount(profile.familyId).then(setPhotoCount);
  }, [profile?.familyId, photos.length]);

  const handlePickPhotos = () => {
    setUploadError(null);
    fileInputRef.current?.click();
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !profile?.familyId || !profile.uid || !album) return;

    const gate = canAddPhoto(plan, photoCount + files.length);
    if (!gate.allowed) {
      setUploadError(gate.reason || 'Photo limit reached.');
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const processed = await processPhotoForUpload(file);
        const newPhoto = await uploadAlbumPhoto(profile.familyId, album.id, profile.uid, processed);
        // First photo doubles as the album cover (only if none set).
        if (!album.coverThumbUrl) {
          await setAlbumCover(profile.familyId, album.id, newPhoto);
          setAlbum((prev) => prev ? { ...prev, coverThumbUrl: newPhoto.thumbUrl, coverPhotoId: newPhoto.id } : prev);
        }
      }
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!loaded) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <BackButton />
        <div className="text-center py-12">
          <p className="text-3xl mb-2">⏳</p>
          <p className="text-kaya-sand text-sm">Loading album…</p>
        </div>
      </div>
    );
  }

  if (denied || !album) {
    return (
      <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
        <BackButton />
        <div className="bg-white border border-kaya-warm-dark rounded-kaya p-8 text-center">
          <p className="text-5xl mb-3">🔒</p>
          <p className="font-display font-black text-lg mb-1">No access to this album</p>
          <p className="text-kaya-sand text-sm mb-4">It might be private to other family members.</p>
          <button
            onClick={() => router.push('/moments/albums')}
            className="h-11 px-5 bg-kaya-gold text-white rounded-kaya font-bold text-sm hover:bg-kaya-gold-dark transition-colors"
          >
            Back to Albums
          </button>
        </div>
      </div>
    );
  }

  const subAlbumGate = canCreateSubAlbum(plan);
  const isParentsOnly = album.accessMode === 'custom' && album.accessList.length <= 2;
  const accessLabel = album.accessMode === 'all_family'
    ? '👨‍👩‍👧 Whole family'
    : isParentsOnly ? '🔒 Parents only' : `+${album.accessList.length} members`;

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32 relative">
      <div className="flex items-center justify-between mb-3">
        <BackButton />
        <div className="flex items-center gap-2">
          <Link
            href={`/moments/albums/${album.id}/settings`}
            className="h-9 w-9 rounded-full bg-white border border-kaya-warm-dark flex items-center justify-center hover:border-kaya-chocolate transition-colors"
            aria-label="Settings"
          >
            ⚙
          </Link>
        </div>
      </div>

      {/* Hero */}
      <div className="relative rounded-kaya overflow-hidden h-40 lg:h-56 border border-kaya-warm-dark mb-4">
        {album.coverThumbUrl ? (
          <img src={album.coverThumbUrl} alt="" className="absolute inset-0 w-full h-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-amber-300 via-amber-600 to-amber-900" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
        <span className="absolute top-3 right-3 text-[10px] font-display font-black px-2.5 py-1 rounded-md bg-white/95 text-kaya-chocolate flex items-center gap-1">
          {accessLabel}
        </span>
        <div className="absolute left-4 bottom-3 text-white">
          <h1 className="font-display font-black text-xl lg:text-2xl leading-tight">{album.name}</h1>
          <p className="text-xs opacity-90 mt-1 font-bold">
            {album.photoCount} {album.photoCount === 1 ? 'photo' : 'photos'}
            {album.description && ` · ${album.description}`}
          </p>
        </div>
      </div>

      {/* Sub-album strip */}
      {(subAlbums.length > 0 || subAlbumGate.allowed) && (
        <div className="mb-4">
          <div className="flex items-baseline justify-between mb-2">
            <p className="font-display font-black text-sm">Sub-albums · {subAlbums.length}</p>
            {!subAlbumGate.allowed && (
              <span className="text-[10px] font-display font-bold text-kaya-gold-dark uppercase tracking-wide">Family plan</span>
            )}
          </div>
          <SubAlbumStrip
            parentAlbumId={album.id}
            subAlbums={subAlbums}
            canAddSubAlbum={subAlbumGate.allowed}
          />
        </div>
      )}

      {/* Photos */}
      <div className="flex items-baseline justify-between mb-2">
        <p className="font-display font-black text-sm">Photos · {photos.length}</p>
        <button
          onClick={handlePickPhotos}
          disabled={uploading}
          className="text-[11px] font-display font-bold text-kaya-gold-dark uppercase tracking-wide hover:text-kaya-chocolate disabled:opacity-50"
        >
          {uploading ? 'Uploading…' : '+ Add photos'}
        </button>
      </div>

      {uploadError && (
        <div className="bg-red-50 border border-red-300 text-red-800 text-xs rounded-md p-3 mb-3">{uploadError}</div>
      )}

      <AlbumPhotoGrid photos={photos} />

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {/* Floating add button on mobile */}
      <button
        onClick={handlePickPhotos}
        disabled={uploading}
        className="lg:hidden fixed bottom-24 right-5 w-14 h-14 rounded-2xl bg-kaya-gold text-white text-2xl font-black flex items-center justify-center shadow-lg hover:bg-kaya-gold-dark transition-colors disabled:opacity-50 z-10"
        aria-label="Add photos"
      >
        +
      </button>

      {plan === 'free' && photoCount >= limits.maxPhotosTotal * 0.8 && (
        <div className="mt-6">
          <UpgradeCard
            reason="You're close to the free-tier photo cap. Family plan removes the limit."
            ctaMode="notify"
            usage={{ current: photoCount, max: limits.maxPhotosTotal, label: `${photoCount} of ${limits.maxPhotosTotal} photos used` }}
            onNotify={() => alert('We\'ll email you when Family plan launches.')}
          />
        </div>
      )}
    </div>
  );
}
