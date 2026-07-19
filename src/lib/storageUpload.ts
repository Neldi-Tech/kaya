// 📦 Friendly Firebase-Storage uploads (STOR PR1, 2026-07-18).
//
// `storage/quota-exceeded` means KAYA's bucket is full — an infrastructure
// (Google plan) ceiling, nothing to do with the family's Kaya tier and
// nothing a kid can fix. Before this wrapper, kids saw the raw Firebase
// error string with a pricing URL (real screenshot from Elia's family).
//
// safeUploadBytes/safeUploadString are drop-ins for the firebase/storage
// functions across every upload path. On quota-exceeded they:
//   1. throw a warm, kid-readable message instead of the raw error, and
//   2. fire-and-forget /api/system/storage-alert so parents get an in-app
//      bell + email + a 📜 Alert-log entry (server dedupes to once/day).
// Every other error passes through untouched.

import {
  uploadBytes, uploadString,
  type StorageReference, type UploadMetadata, type UploadResult,
  type StringFormat,
} from 'firebase/storage';
import { auth } from './firebase';

export const STORAGE_FULL_MESSAGE =
  "📦 Kaya's photo box is full! This isn't your fault — your parents have been told and it'll be fixed soon. Your work is safe; try the photo again a bit later. 💛";

function isQuotaError(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? '';
  const msg = (e as { message?: string })?.message ?? '';
  return code === 'storage/quota-exceeded'
    || msg.includes('quota-exceeded')
    || msg.includes('Quota for bucket');
}

// One ping per session-hour is plenty — the server dedupes to once per day
// anyway; this just avoids hammering the route during a retry storm.
let lastPing = 0;
function pingStorageAlert() {
  const now = Date.now();
  if (now - lastPing < 60 * 60 * 1000) return;
  lastPing = now;
  auth.currentUser?.getIdToken()
    .then((token) => {
      void fetch('/api/system/storage-alert', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    })
    .catch(() => {});
}

function rethrow(e: unknown): never {
  if (isQuotaError(e)) {
    pingStorageAlert();
    throw new Error(STORAGE_FULL_MESSAGE);
  }
  throw e;
}

/** Drop-in for firebase/storage `uploadBytes` with the friendly quota path. */
export async function safeUploadBytes(
  ref: StorageReference,
  data: Blob | Uint8Array | ArrayBuffer,
  metadata?: UploadMetadata,
): Promise<UploadResult> {
  try { return await uploadBytes(ref, data, metadata); }
  catch (e) { rethrow(e); }
}

/** Drop-in for firebase/storage `uploadString` with the friendly quota path. */
export async function safeUploadString(
  ref: StorageReference,
  value: string,
  format?: StringFormat,
  metadata?: UploadMetadata,
): Promise<UploadResult> {
  try { return await uploadString(ref, value, format, metadata); }
  catch (e) { rethrow(e); }
}
