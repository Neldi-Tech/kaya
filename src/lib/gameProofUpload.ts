'use client';

// Real-World challenge proof: downscale the kid's chosen photo to ~1600px
// JPEG and upload it under the family's gameProofs tree (mirrors the workplan
// "proof for points" media path). Returns the download URL, which the kid's
// client then hands to /api/games/challenge.

import { storage } from '@/lib/firebase';
import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { safeUploadBytes } from '@/lib/storageUpload';

async function downscale(file: File, maxEdge = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no-canvas');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob-failed'))), 'image/jpeg', quality),
  );
}

export async function uploadGameProof(
  familyId: string, childSeg: string, gameId: string, file: File,
): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('not-an-image');
  const blob = await downscale(file);
  const photoId = `${Date.now()}_${Math.round(Math.random() * 1e6)}`;
  const path = `families/${familyId}/children/${childSeg}/gameProofs/${gameId}/${photoId}.jpg`;
  const r = storageRef(storage, path);
  await safeUploadBytes(r, blob, { contentType: 'image/jpeg' });
  return await getDownloadURL(r);
}
