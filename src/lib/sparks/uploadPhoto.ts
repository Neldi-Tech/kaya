// Kaya Sparks · photo upload helper.
//
// Wraps the canonical `processPhotoForUpload` (3 sizes: thumb/feed/full)
// + writes blobs under `families/{f}/sparks/{itemId}/{photoId}/{size}.jpg`,
// matching the storage.rules path added by Slice 2 (2026-05-27).
//
// Returns the three download URLs so the caller can persist them on a
// sparks_items doc and render any size from there.

'use client';

import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes,
} from 'firebase/storage';
import { storage } from '../firebase';
import { processPhotoForUpload, type ProcessedPhoto } from '../photoUpload';

export interface SparksPhotoUrls {
  /** Stored at `families/{f}/sparks/{itemId}/{photoId}/{size}.jpg`. */
  photoId: string;
  thumbUrl: string;
  feedUrl: string;
  fullUrl: string;
  width: number;
  height: number;
}

function path(familyId: string, itemId: string, photoId: string, size: 'thumb' | 'feed' | 'full') {
  return `families/${familyId}/sparks/${itemId}/${photoId}/${size}.jpg`;
}

/** Process + upload one photo into a sparks item. Returns the three
 *  download URLs and the photoId so the caller can persist them on the
 *  sparks_items doc.
 *
 *  The caller picks the `itemId` — typically you reserve it client-side
 *  via `crypto.randomUUID()` (or `Date.now()`-based id), upload the
 *  photo, then write the Firestore doc with the resulting URLs. That
 *  ordering avoids orphan rows when the upload fails mid-way. */
export async function uploadSparksPhoto(
  familyId: string,
  itemId: string,
  file: File,
): Promise<SparksPhotoUrls> {
  const blobs: ProcessedPhoto = await processPhotoForUpload(file);
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const refThumb = storageRef(storage, path(familyId, itemId, photoId, 'thumb'));
  const refFeed  = storageRef(storage, path(familyId, itemId, photoId, 'feed'));
  const refFull  = storageRef(storage, path(familyId, itemId, photoId, 'full'));

  await Promise.all([
    uploadBytes(refThumb, blobs.thumbBlob, { contentType: 'image/jpeg' }),
    uploadBytes(refFeed,  blobs.feedBlob,  { contentType: 'image/jpeg' }),
    uploadBytes(refFull,  blobs.fullBlob,  { contentType: 'image/jpeg' }),
  ]);

  const [thumbUrl, feedUrl, fullUrl] = await Promise.all([
    getDownloadURL(refThumb),
    getDownloadURL(refFeed),
    getDownloadURL(refFull),
  ]);

  return { photoId, thumbUrl, feedUrl, fullUrl, width: blobs.width, height: blobs.height };
}

/** Best-effort deletion of all three sizes for one photo. Failures are
 *  swallowed — the Firestore doc is the source of truth. */
export async function deleteSparksPhoto(
  familyId: string,
  itemId: string,
  photoId: string,
): Promise<void> {
  await Promise.all([
    deleteObject(storageRef(storage, path(familyId, itemId, photoId, 'thumb'))).catch(() => {}),
    deleteObject(storageRef(storage, path(familyId, itemId, photoId, 'feed'))).catch(() => {}),
    deleteObject(storageRef(storage, path(familyId, itemId, photoId, 'full'))).catch(() => {}),
  ]);
}

/** Pull the photoId out of a Storage download URL.
 *  URLs look like `…/o/families%2F{f}%2Fsparks%2F{itemId}%2F{photoId}%2F…`. */
export function photoIdFromUrl(url: string): string | null {
  const decoded = decodeURIComponent(url);
  const m = decoded.match(/\/sparks\/[^/]+\/([^/]+)\//);
  return m ? m[1] : null;
}
