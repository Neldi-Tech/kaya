// Receipt upload for purchase requests. (2026-05-19)
//
// Receipts are uploaded during reconcile so the parent has a paper-trail
// for any closed request. One variant — receipts are text-heavy
// (numbers + line items) so a single ~1600px long-edge JPEG keeps it
// legible without bloating Storage.
//
// Storage path:
//   families/{familyId}/purchaseRequests/{requestId}/receipt/{photoId}.jpg
//
// Path includes a photoId so re-uploads create a new blob (we update
// the request's receiptUrl to point at the latest one). The old blob
// is best-effort deleted when re-uploading — failures are swallowed
// since the new upload is what the user cares about.

import {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject,
} from 'firebase/storage';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db, storage } from './firebase';

const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB raw cap
const RECEIPT_EDGE = 1600;
const JPEG_QUALITY = 0.85;

/** Single-variant downscale + JPEG encode. Returns a Blob the caller
 *  can pipe straight to uploadBytes. */
async function processReceipt(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error("That doesn't look like an image file.");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('Receipt photo is too large — please pick something under 25 MB.');
  }
  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > RECEIPT_EDGE ? RECEIPT_EDGE / longEdge : 1;
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

function receiptPath(familyId: string, requestId: string, photoId: string): string {
  return `families/${familyId}/purchaseRequests/${requestId}/receipt/${photoId}.jpg`;
}

/** Best-effort delete of a previously-uploaded receipt. Pass the
 *  download URL stored on the request — we extract the storage path
 *  from it. Swallows errors (URL might be from a different storage
 *  generation or already gone). */
async function deleteByDownloadUrl(downloadUrl: string): Promise<void> {
  try {
    // Storage download URLs encode the path between /o/ and ?alt=
    const m = downloadUrl.match(/\/o\/([^?]+)/);
    if (!m) return;
    const path = decodeURIComponent(m[1]);
    await deleteObject(storageRef(storage, path));
  } catch {
    // swallow — not critical
  }
}

/** Upload a fresh receipt photo for a request, write the URL to the
 *  request doc, and best-effort delete any previous receipt blob.
 *  Returns the new download URL. */
export async function uploadReceipt(args: {
  familyId: string;
  requestId: string;
  file: File;
  previousUrl?: string;
}): Promise<string> {
  const blob = await processReceipt(args.file);
  const photoId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const ref = storageRef(storage, receiptPath(args.familyId, args.requestId, photoId));
  await uploadBytes(ref, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(ref);
  // Persist the URL on the request.
  await updateDoc(doc(db, 'families', args.familyId, 'purchaseRequests', args.requestId), {
    receiptUrl: url,
    updatedAt: serverTimestamp(),
  });
  // Best-effort cleanup of any previous blob to keep Storage tidy.
  if (args.previousUrl) {
    void deleteByDownloadUrl(args.previousUrl);
  }
  return url;
}

/** Clear the receipt — drops the URL from the request doc + best-
 *  effort deletes the Storage blob. Used by an "✕ Remove receipt"
 *  affordance on the request detail page. */
export async function clearReceipt(args: {
  familyId: string;
  requestId: string;
  previousUrl?: string;
}): Promise<void> {
  await updateDoc(doc(db, 'families', args.familyId, 'purchaseRequests', args.requestId), {
    receiptUrl: '',
    updatedAt: serverTimestamp(),
  });
  if (args.previousUrl) {
    void deleteByDownloadUrl(args.previousUrl);
  }
}
