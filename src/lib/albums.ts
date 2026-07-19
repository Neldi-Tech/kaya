// Keepsake — family photo Albums.
//
// Two nested Firestore collections under each family:
//   albums/{albumId}                — the album doc (mode, access list, etc.)
//   albums/{albumId}/photos/{pId}   — one doc per photo
//
// Photos live in Firebase Storage at
//   families/{f}/albums/{aId}/{pId}/{size}.jpg
// with `size` in { thumb | feed | full } — same shape as posts so the
// `photoUpload.processPhotoForUpload` pipeline can be reused as-is.
//
// Access model:
//   accessMode: 'all_family' — every family member can read/upload
//   accessMode: 'custom'     — only `accessList` (userIds) can read/upload
// Sub-albums inherit-then-narrow: a sub-album's accessList must be a
// SUBSET of the parent album's effective access list. The constraint is
// enforced both client-side (UI greys out members not in parent) and at
// the Firestore rule layer on write.

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  onSnapshot, orderBy, query, serverTimestamp, Timestamp,
  updateDoc, where, writeBatch, increment, limit,
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, ref as storageRef,
} from 'firebase/storage';
import { safeUploadBytes } from '@/lib/storageUpload';
import { db, storage } from './firebase';
import type { ProcessedPhoto } from './photoUpload';

// ── Types ────────────────────────────────────────────────────────

export type AlbumAccessMode = 'all_family' | 'custom';

export interface Album {
  id: string;
  /** null for top-level. Sub-albums point at their parent for the
   *  hierarchy strip on detail pages and for the inheritance rule. */
  parentAlbumId: string | null;
  name: string;
  description?: string;
  /** Photo id of the cover. Optional — UI falls back to the first
   *  photo when missing. We also denormalise `coverThumbUrl` so the
   *  grid can render without an extra fetch per card. */
  coverPhotoId?: string;
  coverThumbUrl?: string;
  accessMode: AlbumAccessMode;
  /** userIds (from `users/{uid}`) when accessMode === 'custom'. Empty
   *  array when 'all_family' (the path scopes to family anyway). */
  accessList: string[];
  /** Denormalised counters bumped via `increment()` so the grid can
   *  render without N sub-collection counts. */
  photoCount: number;
  /** Reserve-then-finalise mirrors the Moments post flow: we create
   *  the doc with pending=true, upload the cover, then patch in the
   *  rest. The feed query filters `pending == false`. */
  pending: boolean;
  createdBy: string;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface AlbumPhoto {
  id: string;
  thumbUrl: string;
  feedUrl: string;
  fullUrl: string;
  /** Original photo dimensions — drives the lightbox aspect ratio. */
  width: number;
  height: number;
  uploadedBy: string;
  uploadedAt: Timestamp;
  /** Manual sort order. Defaults to uploadedAt epoch so the grid sorts
   *  by date until a v1.5 drag-drop reorder lands. */
  displayOrder: number;
}

// ── Firestore paths ──────────────────────────────────────────────

const albumsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'albums');
const albumDoc = (familyId: string, albumId: string) =>
  doc(db, 'families', familyId, 'albums', albumId);
const albumPhotosCol = (familyId: string, albumId: string) =>
  collection(db, 'families', familyId, 'albums', albumId, 'photos');
const albumPhotoDoc = (familyId: string, albumId: string, photoId: string) =>
  doc(db, 'families', familyId, 'albums', albumId, 'photos', photoId);

// ── Storage path ─────────────────────────────────────────────────

function albumPhotoStoragePath(
  familyId: string,
  albumId: string,
  photoId: string,
  size: 'thumb' | 'feed' | 'full',
) {
  return `families/${familyId}/albums/${albumId}/${photoId}/${size}.jpg`;
}

// ── Access helpers ───────────────────────────────────────────────

/** Client-side visibility predicate. Mirrors what the Firestore rule
 *  enforces server-side — used for the albums grid filter so we don't
 *  show cards the user couldn't open anyway. Parents in the family see
 *  every album in their family regardless of accessList (they own the
 *  data) — this matches the existing pattern where parents can delete
 *  any post in the family. */
export function canViewAlbum(
  album: Pick<Album, 'accessMode' | 'accessList'>,
  userId: string,
  isParent: boolean,
): boolean {
  if (isParent) return true;
  if (album.accessMode === 'all_family') return true;
  return album.accessList.includes(userId);
}

/** Returns the userIds NOT permitted to be added to a sub-album because
 *  they're not in the parent album's effective audience. UI uses this
 *  to grey-out + tooltip those rows in the access picker. */
export function disallowedForSubAlbum(
  parent: Pick<Album, 'accessMode' | 'accessList'> | null,
  allFamilyMemberUids: string[],
): Set<string> {
  if (!parent) return new Set();
  if (parent.accessMode === 'all_family') return new Set();
  // 'custom' parent — anyone NOT in parent.accessList is disallowed.
  const allowed = new Set(parent.accessList);
  return new Set(allFamilyMemberUids.filter((u) => !allowed.has(u)));
}

// ── Album CRUD ───────────────────────────────────────────────────

/** Reserve an album doc id BEFORE the user finishes the create flow,
 *  so the cover upload (when used) can nest its Storage path under
 *  the eventual album id. Matches `reservePost` in moments.ts. */
export async function reserveAlbum(
  familyId: string,
  createdBy: string,
  parentAlbumId: string | null,
): Promise<string> {
  const ref = await addDoc(albumsCol(familyId), {
    pending: true,
    createdBy,
    parentAlbumId,
    name: '',
    accessMode: 'all_family' as AlbumAccessMode,
    accessList: [],
    photoCount: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function finalizeAlbum(
  familyId: string,
  albumId: string,
  data: Pick<
    Album,
    'name' | 'description' | 'parentAlbumId' | 'accessMode' | 'accessList' | 'coverPhotoId' | 'coverThumbUrl' | 'createdBy'
  >,
): Promise<void> {
  await updateDoc(albumDoc(familyId, albumId), {
    ...data,
    description: data.description || '',
    coverPhotoId: data.coverPhotoId || null,
    coverThumbUrl: data.coverThumbUrl || null,
    pending: false,
    updatedAt: serverTimestamp(),
  });
}

/** Single-shot create — for callers that don't need the
 *  reserve/finalise dance (e.g. when there's no cover at creation
 *  time). Returns the new album id. */
export async function createAlbum(
  familyId: string,
  data: Pick<
    Album,
    'name' | 'description' | 'parentAlbumId' | 'accessMode' | 'accessList' | 'createdBy'
  >,
): Promise<string> {
  const ref = await addDoc(albumsCol(familyId), {
    ...data,
    description: data.description || '',
    coverPhotoId: null,
    coverThumbUrl: null,
    photoCount: 0,
    pending: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getAlbum(
  familyId: string,
  albumId: string,
): Promise<Album | null> {
  const snap = await getDoc(albumDoc(familyId, albumId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Album) : null;
}

export async function updateAlbumMeta(
  familyId: string,
  albumId: string,
  patch: Partial<Pick<Album, 'name' | 'description' | 'coverPhotoId' | 'coverThumbUrl'>>,
): Promise<void> {
  await updateDoc(albumDoc(familyId, albumId), {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function updateAlbumAccess(
  familyId: string,
  albumId: string,
  accessMode: AlbumAccessMode,
  accessList: string[],
): Promise<void> {
  await updateDoc(albumDoc(familyId, albumId), {
    accessMode,
    accessList: accessMode === 'custom' ? accessList : [],
    updatedAt: serverTimestamp(),
  });
}

/** Live subscription to all (non-pending) top-level albums in a family.
 *  Caller filters by visibility client-side via `canViewAlbum` — the
 *  family scale (tens of albums, not thousands) makes this cheap and
 *  avoids the array-contains / OR-query gymnastics. */
export function subscribeToTopLevelAlbums(
  familyId: string,
  cb: (albums: Album[]) => void,
): () => void {
  const q = query(
    albumsCol(familyId),
    where('pending', '==', false),
    where('parentAlbumId', '==', null),
    orderBy('updatedAt', 'desc'),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Album))),
    () => cb([]),
  );
}

/** Live subscription to direct sub-albums of a parent. */
export function subscribeToSubAlbums(
  familyId: string,
  parentAlbumId: string,
  cb: (albums: Album[]) => void,
): () => void {
  const q = query(
    albumsCol(familyId),
    where('pending', '==', false),
    where('parentAlbumId', '==', parentAlbumId),
    orderBy('createdAt', 'asc'),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Album))),
    () => cb([]),
  );
}

/** Total photo count across all the family's albums. Used by the
 *  free-tier 200-photo cap. We sum the denormalised counters instead
 *  of counting the photo docs themselves to keep it O(albums). */
export async function getFamilyPhotoCount(familyId: string): Promise<number> {
  const snap = await getDocs(
    query(albumsCol(familyId), where('pending', '==', false)),
  );
  return snap.docs.reduce((acc, d) => acc + ((d.data().photoCount as number) || 0), 0);
}

/** Cascade delete: photos sub-collection, sub-albums (recursive), the
 *  album doc, and best-effort Storage cleanup for every photo. */
export async function deleteAlbum(
  familyId: string,
  album: Album,
): Promise<void> {
  // 1. Recurse into sub-albums first (depth-first).
  const subs = await getDocs(
    query(albumsCol(familyId), where('parentAlbumId', '==', album.id)),
  );
  for (const subSnap of subs.docs) {
    await deleteAlbum(familyId, { id: subSnap.id, ...subSnap.data() } as Album);
  }
  // 2. Delete photo docs + storage objects.
  const photos = await getDocs(albumPhotosCol(familyId, album.id));
  const batch = writeBatch(db);
  photos.docs.forEach((p) => batch.delete(p.ref));
  batch.delete(albumDoc(familyId, album.id));
  await batch.commit();
  for (const p of photos.docs) {
    const id = p.id;
    void deleteObject(storageRef(storage, albumPhotoStoragePath(familyId, album.id, id, 'thumb'))).catch(() => {});
    void deleteObject(storageRef(storage, albumPhotoStoragePath(familyId, album.id, id, 'feed'))).catch(() => {});
    void deleteObject(storageRef(storage, albumPhotoStoragePath(familyId, album.id, id, 'full'))).catch(() => {});
  }
}

// ── Album photo CRUD ─────────────────────────────────────────────

/** Upload one processed photo into an album. Mirrors
 *  `uploadProcessedPhoto` in moments.ts but writes to the
 *  album-scoped Storage path and bumps the album's photoCount
 *  counter. Returns the AlbumPhoto so the caller can update local
 *  state immediately. */
export async function uploadAlbumPhoto(
  familyId: string,
  albumId: string,
  uploaderUid: string,
  blobs: ProcessedPhoto,
): Promise<AlbumPhoto> {
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const refThumb = storageRef(storage, albumPhotoStoragePath(familyId, albumId, photoId, 'thumb'));
  const refFeed = storageRef(storage, albumPhotoStoragePath(familyId, albumId, photoId, 'feed'));
  const refFull = storageRef(storage, albumPhotoStoragePath(familyId, albumId, photoId, 'full'));
  await Promise.all([
    safeUploadBytes(refThumb, blobs.thumbBlob, { contentType: 'image/jpeg' }),
    safeUploadBytes(refFeed, blobs.feedBlob, { contentType: 'image/jpeg' }),
    safeUploadBytes(refFull, blobs.fullBlob, { contentType: 'image/jpeg' }),
  ]);
  const [thumbUrl, feedUrl, fullUrl] = await Promise.all([
    getDownloadURL(refThumb),
    getDownloadURL(refFeed),
    getDownloadURL(refFull),
  ]);

  const displayOrder = Date.now();
  const photoData = {
    thumbUrl,
    feedUrl,
    fullUrl,
    width: blobs.width,
    height: blobs.height,
    uploadedBy: uploaderUid,
    uploadedAt: serverTimestamp(),
    displayOrder,
  };
  const batch = writeBatch(db);
  batch.set(albumPhotoDoc(familyId, albumId, photoId), photoData);
  batch.update(albumDoc(familyId, albumId), {
    photoCount: increment(1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();

  return {
    id: photoId,
    ...photoData,
    uploadedAt: Timestamp.now(),
  };
}

export function subscribeToAlbumPhotos(
  familyId: string,
  albumId: string,
  cb: (photos: AlbumPhoto[]) => void,
): () => void {
  const q = query(
    albumPhotosCol(familyId, albumId),
    orderBy('displayOrder', 'desc'),
    limit(200),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AlbumPhoto))),
    () => cb([]),
  );
}

export async function deleteAlbumPhoto(
  familyId: string,
  albumId: string,
  photoId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(albumPhotoDoc(familyId, albumId, photoId));
  batch.update(albumDoc(familyId, albumId), {
    photoCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  void deleteObject(storageRef(storage, albumPhotoStoragePath(familyId, albumId, photoId, 'thumb'))).catch(() => {});
  void deleteObject(storageRef(storage, albumPhotoStoragePath(familyId, albumId, photoId, 'feed'))).catch(() => {});
  void deleteObject(storageRef(storage, albumPhotoStoragePath(familyId, albumId, photoId, 'full'))).catch(() => {});
}

/** Set an album's cover to a specific photo. Convenience wrapper that
 *  also denormalises the thumbUrl onto the album for grid rendering. */
export async function setAlbumCover(
  familyId: string,
  albumId: string,
  photo: Pick<AlbumPhoto, 'id' | 'thumbUrl'>,
): Promise<void> {
  await updateAlbumMeta(familyId, albumId, {
    coverPhotoId: photo.id,
    coverThumbUrl: photo.thumbUrl,
  });
}
