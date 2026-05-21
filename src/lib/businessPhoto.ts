// Kaya Business · photo upload (stock-take + product/project photos).
//
// Mirrors receiptUpload.ts: client-side downscale → single JPEG → Storage,
// returns the download URL for the caller to store on the relevant doc.
//
// Storage path:
//   families/{familyId}/businesses/{businessId}/photos/{photoId}.jpg
// Family-scoped (see storage.rules). Product photos are visual (not text),
// so a 1280px long edge is plenty.

import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage';
import { storage } from './firebase';
import { isGuestActive } from './mockFamily';

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB raw cap (pre-resize)
const LONG_EDGE = 1280;
const JPEG_QUALITY = 0.85;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

async function processPhoto(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error("That doesn't look like an image file.");
  if (file.size > MAX_INPUT_BYTES) throw new Error('Photo is too large — please pick something under 25 MB.');
  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > LONG_EDGE ? LONG_EDGE / longEdge : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode photo.')), 'image/jpeg', JPEG_QUALITY);
  });
}

const photosPath = (familyId: string, businessId: string, photoId: string) =>
  `families/${familyId}/businesses/${businessId}/photos/${photoId}.jpg`;

/** Downscale + upload a business photo; returns the download URL. */
export async function uploadBusinessPhoto(familyId: string, businessId: string, file: File): Promise<string> {
  if (isGuestActive()) return '';
  const blob = await processPhoto(file);
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ref = storageRef(storage, photosPath(familyId, businessId, photoId));
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
  return getDownloadURL(ref);
}

/** Best-effort delete by download URL (cleanup; failures swallowed). */
export async function deleteBusinessPhoto(downloadUrl: string): Promise<void> {
  if (!downloadUrl) return;
  try {
    const u = new URL(downloadUrl);
    const m = u.pathname.match(/\/o\/(.+)$/);
    if (!m) return;
    const path = decodeURIComponent(m[1]);
    await deleteObject(storageRef(storage, path));
  } catch {
    /* swallow — cleanup is best-effort */
  }
}
