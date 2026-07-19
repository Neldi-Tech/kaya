// Proof media upload for the Kids' Workplan "proof for points" flow
// (2026-05-23). A kid attaches one media — a PHOTO or a short VIDEO —
// to a proof-required task as "show your work".
//
// Two paths, mirroring receiptUpload.ts for the image case:
//   • Image → downscale to a single ~1600px long-edge JPEG (canvas), so
//     a phone snap doesn't bloat Storage. Same approach as receipts.
//   • Video → upload the RAW file (no canvas), keep its contentType,
//     capped at ~60 MB so a clip stays reasonable.
//
// Storage path (one folder per task per day):
//   families/{familyId}/children/{childId}/workplanProofs/{date}_{itemId}/{photoId}.<ext>
//
// The kid client uploads here directly, then calls /api/workplan/proof
// with the returned download URL — the server (Admin SDK) writes the
// proof doc + awards points (kids can't write awards under the rules).

import {
  ref as storageRef, getDownloadURL,
} from 'firebase/storage';
import { safeUploadBytes } from '@/lib/storageUpload';
import { storage } from './firebase';
import type { WorkplanProofMediaType } from './kidWorkplan';

const MAX_IMAGE_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB raw cap (pre-downscale)
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;       // 60 MB cap for the raw clip
const PROOF_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/** Single-variant downscale + JPEG encode (same as receiptUpload). */
async function processImage(file: File): Promise<Blob> {
  if (file.size > MAX_IMAGE_INPUT_BYTES) {
    throw new Error('Photo is too large — please pick something under 25 MB.');
  }
  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > PROOF_EDGE ? PROOF_EDGE / longEdge : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode photo.')), 'image/jpeg', JPEG_QUALITY);
  });
  return blob;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

/** Best-effort file extension from a contentType (falls back to bin). */
function extFromType(contentType: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'video/x-matroska': 'mkv', 'video/3gpp': '3gp', 'video/ogg': 'ogv',
  };
  if (map[contentType]) return map[contentType];
  const sub = contentType.split('/')[1];
  return sub ? sub.replace(/[^a-z0-9]/gi, '') || 'bin' : 'bin';
}

function proofFolder(familyId: string, childId: string, date: string, itemId: string): string {
  return `families/${familyId}/children/${childId}/workplanProofs/${date}_${itemId}`;
}

/** Upload one proof media. Image → downscaled JPEG; video → raw (capped).
 *  Returns the download URL + which kind it was, so the caller can pass
 *  mediaType straight into submitKidWorkplanProof. */
export async function uploadWorkplanProofMedia(args: {
  familyId: string;
  childId: string;
  itemId: string;
  date: string;       // YYYY-MM-DD
  file: File;
}): Promise<{ url: string; mediaType: WorkplanProofMediaType }> {
  const { familyId, childId, itemId, date, file } = args;
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const folder = proofFolder(familyId, childId, date, itemId);

  if (file.type.startsWith('image/')) {
    const blob = await processImage(file);
    const ref = storageRef(storage, `${folder}/${photoId}.jpg`);
    await safeUploadBytes(ref, blob, { contentType: 'image/jpeg' });
    const url = await getDownloadURL(ref);
    return { url, mediaType: 'photo' };
  }

  if (file.type.startsWith('video/')) {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new Error('Video is too large — please keep it under 60 MB.');
    }
    const ext = extFromType(file.type);
    const ref = storageRef(storage, `${folder}/${photoId}.${ext}`);
    await safeUploadBytes(ref, file, { contentType: file.type });
    const url = await getDownloadURL(ref);
    return { url, mediaType: 'video' };
  }

  throw new Error('Please attach a photo or a video.');
}
