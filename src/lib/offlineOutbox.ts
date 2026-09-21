// 📴 Kaya Offline · the Photo Outbox + sync engine (O1 · R2–R4, approved
// 22-Sep-2026).
//
// THE PROBLEM THIS SOLVES: kids do their stock-take / check-in where the
// business lives — the garden, the roadside stand — often with no signal.
// Before O1, a failed photo upload aborted the whole save AFTER the counts
// were applied: no record, no streak day, no House Point. The complaint.
//
// THE MODEL: capture and upload are now two separate moments.
//   1 · At save time the photo is downscaled and stored as a blob in
//       IndexedDB (this file), and the day's record saves IMMEDIATELY with
//       `pendingMedia: N` — streak, HP and celebration happen on the spot.
//   2 · The sync engine wakes on the browser's `online` event, on app
//       open/foreground, and every few minutes; it uploads queued photos
//       (deterministic ids → retries overwrite, never duplicate), MERGES
//       them into the day's `media[]` (arrayUnion — multi-device safe),
//       decrements `pendingMedia`, and only THEN deletes the outbox entry.
//       A crash between upload and doc-write just re-runs both — harmless.
//
// Caps (D4): ~40 photos / ~80 MB. Videos never queue (D2 — online only).
// Guest mode never enqueues. Zero Firestore/storage rules changes — the
// sync runs in the owner's own session on already-allowed paths.

import { doc, getDoc, setDoc, arrayUnion, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';
import { uploadPreparedBusinessPhoto } from './businessPhoto';
import type { Attachment, AttachmentKind, ThreadMember } from './messaging';
import type { Post, PhotoRef } from './moments';
import { reservePost, finalizePost, uploadProcessedPhoto, uploadProcessedVideo } from './moments';
import { sendMessage, messagePreview } from './messaging';
import {
  uploadMessagePhoto, uploadMessageVideo, uploadMessageDocument, uploadMessageVoice,
} from './messagingUpload';
import { notifyNewMessage } from './notify';

export interface OutboxPhoto {
  id: string;            // deterministic — doubles as the Storage object name
  familyId: string;
  businessId: string;
  date: string;          // the stock-take / check-in day (YYYY-MM-DD)
  blob: Blob;            // already-downscaled JPEG
  createdAt: number;
  tries: number;
  lastError?: string;
}

// ── O2 (approved 22-Sep-2026) — queued outgoing chat messages ─────
// A text-only message queues by ITSELF through Firestore's on-device cache.
// A message WITH attachments can't (attachments need Storage URLs before the
// doc is written, and messages are append-only by rules — no patching later),
// so the WHOLE outgoing message waits here: blobs + text + sender snapshot.
// The sync engine uploads the attachments, sends the message through the
// normal sendMessage, then fires the usual recipient notifications. Messages
// arrive late but intact — and rules stay untouched.

export interface OutboxMessageItem {
  kind: AttachmentKind;
  blob: Blob;            // File for photo/video/document, converted blob for voice
  name?: string;         // original filename (documents)
  durationSec?: number;  // voice
}

export interface OutboxMessage {
  id: string;
  familyId: string;
  threadId: string;
  text: string;
  items: OutboxMessageItem[];
  sender: ThreadMember;
  recipientUids: string[];
  isGroup: boolean;
  groupTitle?: string;
  createdAt: number;
  tries: number;
  lastError?: string;
}

// ── O2 · queued Moments posts ─────────────────────────────────────
// Same idea as messages: a post's photos need Storage URLs before the doc
// finalizes, so the whole post (processed blobs + caption + tags) waits here
// and posts itself on reconnect through the NORMAL reserve → upload →
// finalize pipeline. `postId` is persisted after the first successful
// reservation so a retry reuses it instead of littering reservations.

export interface OutboxPostItem {
  kind: 'photo' | 'video';
  processed: { thumbBlob: Blob; feedBlob: Blob; fullBlob: Blob; width: number; height: number };
  videoBlob?: Blob;
  videoType?: string;
  durationSec?: number;
}

export type OutboxPostData = Omit<Post, 'id' | 'photos' | 'reactionCount' | 'reactionsByType' | 'commentCount' | 'createdAt' | 'updatedAt'>;

export interface OutboxPost {
  id: string;
  familyId: string;
  postId?: string;       // reserved on the first sync attempt
  post: OutboxPostData;
  items: OutboxPostItem[];
  createdAt: number;
  tries: number;
  lastError?: string;
}

const DB_NAME = 'kaya-outbox';
const DB_VERSION = 3; // v2 adds 'messages' (O2) · v3 adds 'posts' (O2)
const STORE = 'photos';
const MSG_STORE = 'messages';
const POST_STORE = 'posts';
const OUTBOX_MAX_POSTS = 6;

export const OUTBOX_MAX_PHOTOS = 40;              // D4
export const OUTBOX_MAX_BYTES = 80 * 1024 * 1024; // D4

// ── Tiny IndexedDB layer (no dependency) ──────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('offline-storage-unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(MSG_STORE)) d.createObjectStore(MSG_STORE, { keyPath: 'id' });
      if (!d.objectStoreNames.contains(POST_STORE)) d.createObjectStore(POST_STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('offline-storage-unavailable'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('offline-storage-write-failed'));
    tx.onabort = () => reject(tx.error || new Error('offline-storage-write-failed'));
  });
}

async function idbAll<T>(store: string): Promise<T[]> {
  const d = await openDb();
  try {
    return await new Promise<T[]>((resolve, reject) => {
      const req = d.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result as T[]) || []);
      req.onerror = () => reject(req.error);
    });
  } finally { d.close(); }
}

async function idbPut(store: string, entry: unknown): Promise<void> {
  const d = await openDb();
  try {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put(entry);
    await txDone(tx);
  } finally { d.close(); }
}

async function idbDelete(store: string, id: string): Promise<void> {
  const d = await openDb();
  try {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    await txDone(tx);
  } finally { d.close(); }
}

// ── Change notifications (drives chips + the drain celebration) ───

const listeners = new Set<() => void>();
function notify() { listeners.forEach((l) => { try { l(); } catch { /* listener's problem */ } }); }

/** Subscribe to outbox changes; fires immediately and on every mutation.
 *  Read counts with {@link countQueuedPhotos} inside the callback. */
export function subscribeOutbox(cb: () => void): () => void {
  listeners.add(cb);
  try { cb(); } catch { /* first call is best-effort */ }
  return () => { listeners.delete(cb); };
}

export async function countQueuedPhotos(familyId?: string, businessId?: string): Promise<number> {
  try {
    const all = await idbAll<OutboxPhoto>(STORE);
    return all.filter((e) =>
      (!familyId || e.familyId === familyId) && (!businessId || e.businessId === businessId)).length;
  } catch { return 0; }
}

// ── Enqueue (called at save time, online or not) ──────────────────

/** Queue one already-downscaled photo for the given business day. Throws a
 *  kid-readable error when the outbox is full (D4). */
export async function enqueueBusinessPhoto(
  familyId: string, businessId: string, date: string, blob: Blob,
): Promise<string> {
  if (isGuestActive()) return '';
  const all = await idbAll<OutboxPhoto>(STORE);
  const bytes = all.reduce((s, e) => s + (e.blob?.size || 0), 0);
  if (all.length >= OUTBOX_MAX_PHOTOS || bytes + blob.size > OUTBOX_MAX_BYTES) {
    throw new Error('The photo outbox is full — connect to the internet so the waiting photos can fly up first. 📤');
  }
  const id = `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await idbPut(STORE, { id, familyId, businessId, date, blob, createdAt: Date.now(), tries: 0 } satisfies OutboxPhoto);
  notify();
  return id;
}

// ── O2 · queued outgoing messages ─────────────────────────────────

/** Queue a whole outgoing chat message (text + attachment blobs). */
export async function enqueueMessage(msg: Omit<OutboxMessage, 'id' | 'createdAt' | 'tries'>): Promise<string> {
  if (isGuestActive()) return '';
  const id = `om-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await idbPut(MSG_STORE, { ...msg, id, createdAt: Date.now(), tries: 0 } satisfies OutboxMessage);
  notify();
  return id;
}

export async function countQueuedMessages(familyId?: string, threadId?: string): Promise<number> {
  try {
    const all = await idbAll<OutboxMessage>(MSG_STORE);
    return all.filter((e) =>
      (!familyId || e.familyId === familyId) && (!threadId || e.threadId === threadId)).length;
  } catch { return 0; }
}

/** Queue a whole Moments post (processed blobs + caption + tags). */
export async function enqueuePost(familyId: string, post: OutboxPostData, items: OutboxPostItem[]): Promise<string> {
  if (isGuestActive()) return '';
  const all = await idbAll<OutboxPost>(POST_STORE);
  const bytes = all.reduce((s, e) => s + e.items.reduce((t, it) =>
    t + it.processed.thumbBlob.size + it.processed.feedBlob.size + it.processed.fullBlob.size + (it.videoBlob?.size || 0), 0), 0);
  const newBytes = items.reduce((t, it) =>
    t + it.processed.thumbBlob.size + it.processed.feedBlob.size + it.processed.fullBlob.size + (it.videoBlob?.size || 0), 0);
  if (all.length >= OUTBOX_MAX_POSTS || bytes + newBytes > OUTBOX_MAX_BYTES) {
    throw new Error('The post outbox is full — connect to the internet so the waiting posts can go up first. 📤');
  }
  const id = `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await idbPut(POST_STORE, { id, familyId, post, items, createdAt: Date.now(), tries: 0 } satisfies OutboxPost);
  notify();
  return id;
}

export async function countQueuedPosts(familyId?: string): Promise<number> {
  try {
    const all = await idbAll<OutboxPost>(POST_STORE);
    return all.filter((e) => !familyId || e.familyId === familyId).length;
  } catch { return 0; }
}

/** Post one queued Moments post through the normal pipeline. */
async function sendQueuedPost(entry: OutboxPost): Promise<void> {
  let postId = entry.postId;
  if (!postId) {
    postId = await reservePost(entry.familyId, entry.post.authorUid);
    // Persist the reservation so a retry reuses it (no reservation litter).
    await idbPut(POST_STORE, { ...entry, postId });
  }
  const uploaded: PhotoRef[] = [];
  for (const it of entry.items) {
    const ref = it.kind === 'video' && it.videoBlob
      ? await uploadProcessedVideo(entry.familyId, postId, {
          poster: it.processed, videoBlob: it.videoBlob,
          contentType: it.videoType || 'video/mp4', durationSec: it.durationSec || 0,
        })
      : await uploadProcessedPhoto(entry.familyId, postId, it.processed);
    uploaded.push(ref);
  }
  await finalizePost(entry.familyId, postId, { ...entry.post, photos: uploaded });
}

/** Upload one queued message's attachments through the normal helpers, then
 *  send it through the normal sendMessage. Throws on failure (caller retries). */
async function sendQueuedMessage(m: OutboxMessage): Promise<void> {
  const attachments: Attachment[] = [];
  for (const it of m.items) {
    const asFile = (fallback: string) =>
      it.blob instanceof File ? it.blob : new File([it.blob], it.name || fallback, { type: it.blob.type });
    let att: Attachment;
    if (it.kind === 'photo') att = await uploadMessagePhoto(m.familyId, m.threadId, asFile('photo.jpg'));
    else if (it.kind === 'video') att = await uploadMessageVideo(m.familyId, m.threadId, asFile('clip.mp4'));
    else if (it.kind === 'voice') att = await uploadMessageVoice(m.familyId, m.threadId, it.blob, it.durationSec || 1);
    else att = await uploadMessageDocument(m.familyId, m.threadId, asFile(it.name || 'document'));
    if (att.url) attachments.push(att);
  }
  await sendMessage(m.familyId, m.threadId, { text: m.text, attachments }, m.sender);
  notifyNewMessage({
    familyId: m.familyId, threadId: m.threadId,
    recipientUids: m.recipientUids,
    senderName: m.sender.name,
    preview: messagePreview(m.text, attachments),
    isGroup: m.isGroup,
    groupTitle: m.groupTitle,
  }).catch(() => {});
}

// ── The sync engine ───────────────────────────────────────────────

let syncing = false;
let booted = false;

/** Upload everything queued (oldest first). Safe to call any time — it
 *  no-ops while another run is in flight, bails early when offline, and
 *  never throws. */
export async function syncOutbox(): Promise<void> {
  if (syncing || isGuestActive()) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  syncing = true;
  try {
    const queue = (await idbAll<OutboxPhoto>(STORE)).sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of queue) {
      try {
        // 1 · Upload under the deterministic id (retry = overwrite, no dupes).
        const url = await uploadPreparedBusinessPhoto(entry.familyId, entry.businessId, entry.id, entry.blob);
        if (!url) { await idbDelete(STORE, entry.id); notify(); continue; } // guest — drop
        // 2 · Merge into the day's record: media + back-compat photoUrl +
        //     pendingMedia countdown. arrayUnion keeps multi-device merges safe.
        const dayRef = doc(db, 'families', entry.familyId, 'businesses', entry.businessId, 'stockTakes', entry.date);
        const snap = await getDoc(dayRef);
        const cur = snap.exists() ? snap.data() as { photoUrl?: string; pendingMedia?: number } : {};
        await setDoc(dayRef, {
          media: arrayUnion({ url, kind: 'photo' }),
          pendingMedia: Math.max(0, (cur.pendingMedia ?? 1) - 1),
          ...(cur.photoUrl ? {} : { photoUrl: url }),
          lastSyncedAt: serverTimestamp(),
        }, { merge: true });
        // 3 · Only now does the entry leave the phone.
        await idbDelete(STORE, entry.id);
        notify();
      } catch (e) {
        // Offline mid-run (or storage hiccup): record the try and stop —
        // the next wake retries from the oldest entry.
        try {
          await idbPut(STORE, { ...entry, tries: entry.tries + 1, lastError: e instanceof Error ? e.message : String(e) });
        } catch { /* keep the original entry */ }
        break; // network-ish failure — don't burn tries on the rest this run
      }
    }
    // O2 · queued Moments posts, oldest first.
    const posts = (await idbAll<OutboxPost>(POST_STORE)).sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of posts) {
      try {
        await sendQueuedPost(entry);
        await idbDelete(POST_STORE, entry.id);
        notify();
      } catch (e) {
        try {
          await idbPut(POST_STORE, { ...entry, tries: entry.tries + 1, lastError: e instanceof Error ? e.message : String(e) });
        } catch { /* keep the original entry */ }
        break;
      }
    }
    // O2 · queued chat messages, oldest first, same bail-on-failure shape.
    const msgs = (await idbAll<OutboxMessage>(MSG_STORE)).sort((a, b) => a.createdAt - b.createdAt);
    for (const m of msgs) {
      try {
        await sendQueuedMessage(m);
        await idbDelete(MSG_STORE, m.id);
        notify();
      } catch (e) {
        try {
          await idbPut(MSG_STORE, { ...m, tries: m.tries + 1, lastError: e instanceof Error ? e.message : String(e) });
        } catch { /* keep the original entry */ }
        break;
      }
    }
  } finally {
    syncing = false;
  }
}

/** Wire the wake-ups once per session: back-online, app foregrounded, a
 *  gentle interval, and right now. Idempotent. */
export function initOutboxSync(): void {
  if (booted || typeof window === 'undefined') return;
  booted = true;
  window.addEventListener('online', () => { void syncOutbox(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncOutbox();
  });
  setInterval(() => { void syncOutbox(); }, 3 * 60_000);
  void syncOutbox();
}
