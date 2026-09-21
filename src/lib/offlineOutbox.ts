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

const DB_NAME = 'kaya-outbox';
const DB_VERSION = 1;
const STORE = 'photos';

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

async function idbAll(): Promise<OutboxPhoto[]> {
  const d = await openDb();
  try {
    return await new Promise<OutboxPhoto[]>((resolve, reject) => {
      const req = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as OutboxPhoto[]) || []);
      req.onerror = () => reject(req.error);
    });
  } finally { d.close(); }
}

async function idbPut(entry: OutboxPhoto): Promise<void> {
  const d = await openDb();
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(entry);
    await txDone(tx);
  } finally { d.close(); }
}

async function idbDelete(id: string): Promise<void> {
  const d = await openDb();
  try {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
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
    const all = await idbAll();
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
  const all = await idbAll();
  const bytes = all.reduce((s, e) => s + (e.blob?.size || 0), 0);
  if (all.length >= OUTBOX_MAX_PHOTOS || bytes + blob.size > OUTBOX_MAX_BYTES) {
    throw new Error('The photo outbox is full — connect to the internet so the waiting photos can fly up first. 📤');
  }
  const id = `ob-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await idbPut({ id, familyId, businessId, date, blob, createdAt: Date.now(), tries: 0 });
  notify();
  return id;
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
    const queue = (await idbAll()).sort((a, b) => a.createdAt - b.createdAt);
    for (const entry of queue) {
      try {
        // 1 · Upload under the deterministic id (retry = overwrite, no dupes).
        const url = await uploadPreparedBusinessPhoto(entry.familyId, entry.businessId, entry.id, entry.blob);
        if (!url) { await idbDelete(entry.id); notify(); continue; } // guest — drop
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
        await idbDelete(entry.id);
        notify();
      } catch (e) {
        // Offline mid-run (or storage hiccup): record the try and stop —
        // the next wake retries from the oldest entry.
        try {
          await idbPut({ ...entry, tries: entry.tries + 1, lastError: e instanceof Error ? e.message : String(e) });
        } catch { /* keep the original entry */ }
        if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
        break; // network-ish failure — don't burn tries on the rest this run
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
