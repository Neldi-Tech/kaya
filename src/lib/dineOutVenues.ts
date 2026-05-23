// Dine Out venues (2026-05-23) — a per-family record of the places you
// eat out, built from Dine Out logs. Powers "Places to go" (re-select +
// filter) and the Diamond recommendation: when BOTH parents rate a venue
// Diamond it earns a family Diamond (above the star average).
//
// Designed to roll up beyond one family later — store per-parent ratings
// + the family Diamond now; a future cross-family aggregation can derive
// network "Diamond Status" (see project_kaya_diamond_venues memory).
'use client';

import {
  collection, doc, getDoc, setDoc, onSnapshot, query, orderBy, limit,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import {
  getDownloadURL, ref as storageRef, uploadBytes,
} from 'firebase/storage';
import { db, storage } from './firebase';
import { isGuestActive } from './mockFamily';
import type { PhotoRef } from './moments';

export interface VenueRating { stars: number; diamond: boolean }

export interface Venue {
  id: string;            // slug of the name
  name: string;
  emoji: string;         // sub-tag emoji or 🍽️
  subTag?: string;       // last DineOutCategory id used
  count: number;         // visits logged
  totalSpentCents: number;
  /** Per-parent latest rating, keyed by parent uid. */
  ratings: Record<string, VenueRating>;
  /** Average of all parents' star ratings (0 = none yet). */
  avgStars: number;
  /** Family Diamond — true when 2+ parents rated it Diamond. */
  diamond: boolean;
  /** Accumulated 1–2 word highlight tags (deduped). */
  highlights: string[];
  /** Photos taken at this place — newest last, capped. Reuses the
   *  Moments PhotoRef shape so the same lightbox/feed renderers paint
   *  them. Stored under a venue-specific Storage path (see
   *  uploadVenuePhoto). Optionally also shared to the Moments feed. */
  photos?: PhotoRef[];
  lastVisitAt?: Timestamp;
}

/** Max photos kept on a venue doc (keeps the doc small + the strip tidy). */
const MAX_VENUE_PHOTOS = 30;

const venuesCol = (familyId: string) =>
  collection(db, 'families', familyId, 'venues');

/** Stable doc id for a venue — slug of the name, so re-logging the same
 *  place dedupes onto one record. */
export function venueId(name: string): string {
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'venue';
}

/** Live list of the family's venues, most-visited first. */
export function subscribeToVenues(familyId: string, cb: (v: Venue[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(venuesCol(familyId), orderBy('count', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Venue))),
    () => cb([]),
  );
}

// ── Venue photos ─────────────────────────────────────────────────
// Stored at families/{f}/venues/{venueId}/{photoId}/{size}.jpg — a
// venue-scoped mirror of the Moments post path so the same client-side
// resizer (processPhotoForUpload) + PhotoRef shape work unchanged. The
// venue doc holds the resulting PhotoRefs; the same refs can also be
// posted to Moments (a download URL is path-independent).

function venuePhotoPath(familyId: string, venueId: string, photoId: string, size: 'thumb' | 'feed' | 'full') {
  return `families/${familyId}/venues/${venueId}/${photoId}/${size}.jpg`;
}

/** Upload one photo's three variants under the venue path and return a
 *  PhotoRef ready to store on the venue (and optionally on a Moments
 *  post). Caller runs `processPhotoForUpload` first to get the blobs. */
export async function uploadVenuePhoto(
  familyId: string,
  venueDocId: string,
  blobs: { thumbBlob: Blob; feedBlob: Blob; fullBlob: Blob; width: number; height: number },
): Promise<PhotoRef> {
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const refThumb = storageRef(storage, venuePhotoPath(familyId, venueDocId, photoId, 'thumb'));
  const refFeed = storageRef(storage, venuePhotoPath(familyId, venueDocId, photoId, 'feed'));
  const refFull = storageRef(storage, venuePhotoPath(familyId, venueDocId, photoId, 'full'));
  await Promise.all([
    uploadBytes(refThumb, blobs.thumbBlob, { contentType: 'image/jpeg' }),
    uploadBytes(refFeed, blobs.feedBlob, { contentType: 'image/jpeg' }),
    uploadBytes(refFull, blobs.fullBlob, { contentType: 'image/jpeg' }),
  ]);
  const [thumbUrl, feedUrl, fullUrl] = await Promise.all([
    getDownloadURL(refThumb),
    getDownloadURL(refFeed),
    getDownloadURL(refFull),
  ]);
  return { id: photoId, thumbUrl, feedUrl, fullUrl, width: blobs.width, height: blobs.height };
}

/** Record a Dine Out visit against a venue: bump count + spend, set this
 *  parent's rating, recompute the star average + family Diamond, merge
 *  highlights, append any new photos. Read-modify-write (a meal log is
 *  low-frequency). NOTE: this does a full setDoc, so existing photos are
 *  preserved by reading them back in — never write this doc without
 *  carrying `photos` forward. */
export async function recordVenueVisit(
  familyId: string,
  args: {
    name: string;
    parentUid: string;
    stars: number;          // 0–5 (0 = no star rating given)
    diamond: boolean;
    highlights?: string[];
    spentCents?: number;
    subTag?: string;
    emoji?: string;
    newPhotos?: PhotoRef[];
  },
): Promise<void> {
  if (isGuestActive()) return;
  const name = args.name.trim();
  if (!name) return;
  const id = venueId(name);
  const ref = doc(venuesCol(familyId), id);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? (snap.data() as Venue) : null;

  const ratings: Record<string, VenueRating> = { ...(prev?.ratings ?? {}) };
  ratings[args.parentUid] = {
    stars: Math.max(0, Math.min(5, Math.round(args.stars || 0))),
    diamond: !!args.diamond,
  };
  const starVals = Object.values(ratings).map((r) => r.stars).filter((s) => s > 0);
  const avgStars = starVals.length
    ? Math.round((starVals.reduce((a, b) => a + b, 0) / starVals.length) * 10) / 10
    : 0;
  // Family Diamond = both parents (2+) marked it Diamond.
  const diamond = Object.values(ratings).filter((r) => r.diamond).length >= 2;
  const highlights = Array.from(new Set([
    ...(prev?.highlights ?? []),
    ...(args.highlights ?? []).map((h) => h.trim()).filter(Boolean),
  ])).slice(0, 16);

  // Carry existing photos forward (full setDoc would otherwise drop them)
  // and append any new ones, capping to the newest MAX_VENUE_PHOTOS.
  const photos = [
    ...(prev?.photos ?? []),
    ...(args.newPhotos ?? []),
  ].slice(-MAX_VENUE_PHOTOS);

  const subTag = args.subTag ?? prev?.subTag;
  await setDoc(ref, {
    id,
    name,
    emoji: args.emoji ?? prev?.emoji ?? '🍽️',
    ...(subTag ? { subTag } : {}),
    count: (prev?.count ?? 0) + 1,
    totalSpentCents: (prev?.totalSpentCents ?? 0) + Math.max(0, args.spentCents ?? 0),
    ratings,
    avgStars,
    diamond,
    highlights,
    ...(photos.length ? { photos } : {}),
    lastVisitAt: serverTimestamp(),
  });
}
