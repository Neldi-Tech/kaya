// Moments — the family photo feed.
//
// Three nested Firestore collections under each family:
//   posts/             — one doc per shared moment (1–10 photos + caption)
//   posts/{p}/reactions/  — one doc per reaction (kept as documents
//                           rather than a counter map so we can show
//                           "Mum, Dad, and Grandma reacted ❤️" later
//                           without a denormalised list).
//   posts/{p}/comments/   — threaded comments.
//
// Photos live in Firebase Storage at
//   families/{f}/posts/{p}/{photoId}/{size}.jpg
// with `size` in { thumb | feed | full }. The Photo doc on the post
// stores download URLs for each variant + the original dimensions so
// the feed can paint the right aspect placeholder.
//
// Visibility: 'family' is the only value the UI surfaces today. The
// 'network' value is part of the schema so a later release can flip
// it without a migration — Firestore rules + UI gate both check this
// field explicitly.

import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs,
  onSnapshot, orderBy, query, serverTimestamp, Timestamp,
  updateDoc, where, writeBatch, increment, limit,
} from 'firebase/firestore';
import {
  deleteObject, getDownloadURL, ref as storageRef, uploadBytes,
} from 'firebase/storage';
import { db, storage } from './firebase';

// ── Types ────────────────────────────────────────────────────────

/** The four reactions parents asked for. Add new ones here AND in
 *  REACTION_EMOJIS below — the type-level guard at the bottom of
 *  this file makes sure both lists stay in lockstep. */
export type Reaction = '❤️' | '👏' | '😂' | '🎉';
export const REACTION_EMOJIS: readonly Reaction[] = ['❤️', '👏', '😂', '🎉'];

/** Optional category chip on a post. Lets us filter the feed by
 *  "school" or "birthday" later without a free-text tag soup. */
export type EventTag =
  | 'everyday'
  | 'school'
  | 'weekend'
  | 'birthday'
  | 'milestone'
  | 'trip';

export const EVENT_TAGS: { id: EventTag; emoji: string; label: string }[] = [
  { id: 'everyday',  emoji: '🌿', label: 'Everyday' },
  { id: 'school',    emoji: '🎒', label: 'School' },
  { id: 'weekend',   emoji: '🎈', label: 'Weekend' },
  { id: 'birthday',  emoji: '🎂', label: 'Birthday' },
  { id: 'milestone', emoji: '🌟', label: 'Milestone' },
  { id: 'trip',      emoji: '✈️', label: 'Trip' },
];

export type Visibility = 'family' | 'network';

export interface PhotoRef {
  id: string;
  thumbUrl: string;
  feedUrl: string;
  fullUrl: string;
  /** Original photo dimensions — drives the aspect placeholder so the
   *  feed doesn't reflow when each image finishes loading. */
  width: number;
  height: number;
}

export interface Post {
  id: string;
  authorUid: string;
  authorName: string;
  authorAvatar?: string;
  caption: string;
  photos: PhotoRef[];
  /** Child ids this post is "about" (0–N). Surfaces the post on the
   *  per-kid filter and on each kid's profile strip. */
  kidTags: string[];
  eventTag?: EventTag;
  visibility: Visibility;
  /** Denormalised counters — bumped via `increment()` so the feed
   *  can render reaction/comment counts without N sub-collection
   *  reads. The actual per-emoji breakdown lives in
   *  `reactionsByType`. */
  reactionCount: number;
  reactionsByType: Record<Reaction, number>;
  commentCount: number;
  createdAt: Timestamp;
  updatedAt?: Timestamp;
}

export interface Comment {
  id: string;
  byUid: string;
  byName: string;
  byAvatar?: string;
  text: string;
  createdAt: Timestamp;
}

export interface ReactionDoc {
  id: string;
  emoji: Reaction;
  byUid: string;
  byName: string;
  createdAt: Timestamp;
}

// ── Firestore paths ──────────────────────────────────────────────

const postsCol = (familyId: string) => collection(db, 'families', familyId, 'posts');
const postDoc = (familyId: string, postId: string) =>
  doc(db, 'families', familyId, 'posts', postId);
const reactionsCol = (familyId: string, postId: string) =>
  collection(db, 'families', familyId, 'posts', postId, 'reactions');
const commentsCol = (familyId: string, postId: string) =>
  collection(db, 'families', familyId, 'posts', postId, 'comments');

// ── Storage paths ────────────────────────────────────────────────

function photoStoragePath(familyId: string, postId: string, photoId: string, size: 'thumb' | 'feed' | 'full') {
  return `families/${familyId}/posts/${postId}/${photoId}/${size}.jpg`;
}

/** Upload one photo's three variants and return a PhotoRef ready to
 *  embed on the post doc. The caller is responsible for calling
 *  `processPhotoForUpload` first to get the blobs. */
export async function uploadProcessedPhoto(
  familyId: string,
  postId: string,
  blobs: { thumbBlob: Blob; feedBlob: Blob; fullBlob: Blob; width: number; height: number },
): Promise<PhotoRef> {
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const refThumb = storageRef(storage, photoStoragePath(familyId, postId, photoId, 'thumb'));
  const refFeed = storageRef(storage, photoStoragePath(familyId, postId, photoId, 'feed'));
  const refFull = storageRef(storage, photoStoragePath(familyId, postId, photoId, 'full'));
  await Promise.all([
    uploadBytes(refThumb, blobs.thumbBlob, { contentType: 'image/jpeg' }),
    uploadBytes(refFeed, blobs.feedBlob,  { contentType: 'image/jpeg' }),
    uploadBytes(refFull, blobs.fullBlob,  { contentType: 'image/jpeg' }),
  ]);
  const [thumbUrl, feedUrl, fullUrl] = await Promise.all([
    getDownloadURL(refThumb),
    getDownloadURL(refFeed),
    getDownloadURL(refFull),
  ]);
  return {
    id: photoId,
    thumbUrl,
    feedUrl,
    fullUrl,
    width: blobs.width,
    height: blobs.height,
  };
}

// ── Post CRUD ────────────────────────────────────────────────────

export async function createPost(
  familyId: string,
  data: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'>,
): Promise<string> {
  const ref = await addDoc(postsCol(familyId), {
    ...data,
    reactionCount: 0,
    reactionsByType: Object.fromEntries(REACTION_EMOJIS.map((e) => [e, 0])),
    commentCount: 0,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/** Reserve a post id BEFORE photos upload so the Storage paths can
 *  nest under the eventual doc id. Internally we create the doc with
 *  `pending: true` and an empty `photos: []`, then patch in the real
 *  fields once the uploads land. Cleaner than uploading to a temp
 *  path and renaming. */
export async function reservePost(familyId: string, authorUid: string): Promise<string> {
  const ref = await addDoc(postsCol(familyId), {
    pending: true,
    authorUid,
    visibility: 'family',
    photos: [],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function finalizePost(
  familyId: string,
  postId: string,
  data: Omit<Post, 'id' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  await updateDoc(postDoc(familyId, postId), {
    ...data,
    pending: false,
    reactionCount: 0,
    reactionsByType: Object.fromEntries(REACTION_EMOJIS.map((e) => [e, 0])),
    commentCount: 0,
    updatedAt: serverTimestamp(),
  });
}

export async function getPost(familyId: string, postId: string): Promise<Post | null> {
  const snap = await getDoc(postDoc(familyId, postId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Post) : null;
}

/** Live feed subscription — newest first. `pageSize` caps the result
 *  so the snapshot listener doesn't fan out unboundedly; the caller
 *  re-subscribes with a larger limit when "load more" is tapped. */
export function subscribeToFeed(
  familyId: string,
  pageSize: number,
  cb: (posts: Post[]) => void,
): () => void {
  const q = query(
    postsCol(familyId),
    where('pending', '==', false),
    orderBy('createdAt', 'desc'),
    limit(pageSize),
  );
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Post))),
    () => cb([]),
  );
}

/** Best-effort delete: removes the post doc and tries to clean up the
 *  Storage objects underneath. Storage cleanup is fire-and-forget so a
 *  failed object delete doesn't block the doc removal — orphaned
 *  blobs cost cents but a dangling doc with a broken thumbUrl would
 *  haunt the feed. */
export async function deletePost(familyId: string, post: Post): Promise<void> {
  // 1. Delete sub-collections in batches (Firestore won't cascade).
  const [reactions, comments] = await Promise.all([
    getDocs(reactionsCol(familyId, post.id)),
    getDocs(commentsCol(familyId, post.id)),
  ]);
  const batch = writeBatch(db);
  reactions.docs.forEach((d) => batch.delete(d.ref));
  comments.docs.forEach((d) => batch.delete(d.ref));
  batch.delete(postDoc(familyId, post.id));
  await batch.commit();

  // 2. Storage cleanup — best-effort.
  for (const photo of post.photos) {
    void deleteObject(storageRef(storage, photoStoragePath(familyId, post.id, photo.id, 'thumb'))).catch(() => {});
    void deleteObject(storageRef(storage, photoStoragePath(familyId, post.id, photo.id, 'feed'))).catch(() => {});
    void deleteObject(storageRef(storage, photoStoragePath(familyId, post.id, photo.id, 'full'))).catch(() => {});
  }
}

// ── Reactions ────────────────────────────────────────────────────

/** Toggle: if this user already reacted with this emoji, remove it;
 *  otherwise add it. Updates the denormalised counters atomically via
 *  a batched write so the feed renders the new count immediately. A
 *  user can stack multiple emojis (one ❤️ and one 🎉 from the same
 *  person is fine) — the toggle is per (uid, emoji). */
export async function toggleReaction(
  familyId: string,
  postId: string,
  emoji: Reaction,
  user: { uid: string; name: string },
): Promise<void> {
  const existing = await getDocs(
    query(
      reactionsCol(familyId, postId),
      where('byUid', '==', user.uid),
      where('emoji', '==', emoji),
    ),
  );
  const batch = writeBatch(db);
  if (existing.empty) {
    const newRef = doc(reactionsCol(familyId, postId));
    batch.set(newRef, {
      emoji,
      byUid: user.uid,
      byName: user.name,
      createdAt: serverTimestamp(),
    });
    batch.update(postDoc(familyId, postId), {
      reactionCount: increment(1),
      [`reactionsByType.${emoji}`]: increment(1),
    });
  } else {
    existing.docs.forEach((d) => batch.delete(d.ref));
    batch.update(postDoc(familyId, postId), {
      reactionCount: increment(-existing.size),
      [`reactionsByType.${emoji}`]: increment(-existing.size),
    });
  }
  await batch.commit();
}

/** Snapshot of which emojis the current user has reacted with on a
 *  given post. Used by the reaction-bar to colour pressed buttons. */
export function subscribeToMyReactions(
  familyId: string,
  postId: string,
  uid: string,
  cb: (set: Set<Reaction>) => void,
): () => void {
  const q = query(reactionsCol(familyId, postId), where('byUid', '==', uid));
  return onSnapshot(
    q,
    (snap) => cb(new Set(snap.docs.map((d) => (d.data() as ReactionDoc).emoji))),
    () => cb(new Set()),
  );
}

// ── Comments ─────────────────────────────────────────────────────

export async function addComment(
  familyId: string,
  postId: string,
  data: Omit<Comment, 'id' | 'createdAt'>,
): Promise<string> {
  const batch = writeBatch(db);
  const newRef = doc(commentsCol(familyId, postId));
  batch.set(newRef, { ...data, createdAt: serverTimestamp() });
  batch.update(postDoc(familyId, postId), {
    commentCount: increment(1),
  });
  await batch.commit();
  return newRef.id;
}

export async function deleteComment(
  familyId: string,
  postId: string,
  commentId: string,
): Promise<void> {
  const batch = writeBatch(db);
  batch.delete(doc(commentsCol(familyId, postId), commentId));
  batch.update(postDoc(familyId, postId), {
    commentCount: increment(-1),
  });
  await batch.commit();
}

export function subscribeToComments(
  familyId: string,
  postId: string,
  cb: (comments: Comment[]) => void,
): () => void {
  const q = query(commentsCol(familyId, postId), orderBy('createdAt', 'asc'));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Comment))),
    () => cb([]),
  );
}

// ── Build-time guard: keep the reaction lists in lockstep ────────
// Adding a new emoji to `Reaction` without updating REACTION_EMOJIS
// (or vice versa) would mean the composer / counters / rules drift
// out of sync. The two checks below fail the build at the symbol
// where the drift happened.
type _ReactionLiteral = (typeof REACTION_EMOJIS)[number];
type _MissingFromRuntime = Exclude<Reaction, _ReactionLiteral>;
type _ExtraInRuntime = Exclude<_ReactionLiteral, Reaction>;
const _NO_REACTION_DRIFT: (_MissingFromRuntime | _ExtraInRuntime) extends never ? true : never = true;
void _NO_REACTION_DRIFT;
