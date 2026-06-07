'use client';

// Kaya Sparks · capture-draft persistence (Slice 7j · 2026-06-07).
//
// IndexedDB-backed store for in-progress multi-page scans. localStorage
// can't hold File blobs (only strings); IDB can hold structured-clone-
// compatible types natively, including File. Keyed by family + kid +
// surface so different kids / different captures never collide.
//
// Lifecycle on a RevisionFlow capture:
//   · Kid taps Scan → adds 1 page → we saveCaptureDraft.
//   · Kid taps Back → photos still in IDB.
//   · Kid reopens RevisionFlow → loadCaptureDraft hits → "Resume / Start fresh".
//   · Kid submits OR taps Start fresh → clearCaptureDraft.
//   · 7-day TTL means abandoned drafts self-clean on next open.
//
// All public functions resolve to null / void on storage failures
// (private mode, quota, no IDB). Capture flow falls back to today's
// behaviour (empty batch) — never blocks the user.

const DB_NAME = 'kaya-sparks-capture';
const DB_VERSION = 1;
const STORE = 'drafts';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CaptureSurface = 'revision';

/** Stable key for a single draft slot. One draft per (family, kid,
 *  surface) — the next capture overwrites the prior unsent one. */
export function captureDraftKey(parts: {
  familyId: string; kidId: string; surface: CaptureSurface;
}): string {
  return `${parts.surface}:${parts.familyId}:${parts.kidId}`;
}

export interface CaptureDraftMeta {
  mode?: 'answers' | 'questions';
  /** Free-form extras (e.g. confirmed subject draft) — JSON-safe. */
  extras?: Record<string, unknown>;
}

export interface CaptureDraft {
  photos: File[];
  meta: CaptureDraftMeta;
  savedAt: number; // ms epoch
}

interface StoredDraft {
  key: string;
  photos: File[];
  meta: CaptureDraftMeta;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return new Promise((resolve) => {
    let request: IDBRequest<T>;
    try {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      request = op(store);
    } catch {
      resolve(null);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
  });
}

/** Save (or replace) the draft for `key`. Photos are written as-is —
 *  IndexedDB structured-clones them so the File handle survives. */
export async function saveCaptureDraft(
  key: string,
  photos: File[],
  meta: CaptureDraftMeta = {},
): Promise<void> {
  const db = await openDb();
  if (!db) return;
  const payload: StoredDraft = {
    key,
    photos: photos.slice(0, 12),
    meta,
    savedAt: Date.now(),
  };
  try {
    await tx(db, 'readwrite', (s) => s.put(payload));
  } finally {
    db.close();
  }
}

/** Load the draft for `key`. Returns null when missing, expired
 *  (>TTL), or on any storage error. Expired drafts are best-effort
 *  cleaned up on the same call. */
export async function loadCaptureDraft(key: string): Promise<CaptureDraft | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const stored = await tx<StoredDraft | undefined>(db, 'readonly', (s) => s.get(key) as IDBRequest<StoredDraft | undefined>);
    if (!stored) return null;
    if (Date.now() - stored.savedAt > TTL_MS) {
      // expired — drop it
      await tx(db, 'readwrite', (s) => s.delete(key));
      return null;
    }
    return {
      photos: Array.isArray(stored.photos) ? stored.photos.filter((f): f is File => f instanceof File) : [],
      meta: stored.meta ?? {},
      savedAt: stored.savedAt,
    };
  } finally {
    db.close();
  }
}

/** Drop the draft (after submit, or on "Start fresh"). */
export async function clearCaptureDraft(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    await tx(db, 'readwrite', (s) => s.delete(key));
  } finally {
    db.close();
  }
}
