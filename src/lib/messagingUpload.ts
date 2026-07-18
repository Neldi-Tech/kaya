// Kaya · messaging attachment uploads.
//
// Storage path (family-scoped, see storage.rules):
//   families/{familyId}/messages/{threadId}/{fileId}.{ext}
//
// Photos downscale to a 1280px JPEG (mirrors businessPhoto.ts). Videos, voice
// notes, and documents upload as-is, each size-capped to match the rule.

import { ref as storageRef, getDownloadURL } from 'firebase/storage';
import { safeUploadBytes } from '@/lib/storageUpload';
import { storage } from './firebase';
import { isGuestActive } from './mockFamily';
import type { Attachment } from './messaging';

const LONG_EDGE = 1280;
const JPEG_QUALITY = 0.85;
const MAX_IMAGE_INPUT = 25 * 1024 * 1024;  // pre-resize guard
const MAX_VIDEO = 50 * 1024 * 1024;        // matches storage.rules
const MAX_VOICE = 25 * 1024 * 1024;
const MAX_DOC = 25 * 1024 * 1024;

// Kid-safe document allowlist (mime → label). Anything else is rejected.
const DOC_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'text/csv',
]);

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const safeExt = (name: string, fallback: string) =>
  (name.split('.').pop() || fallback).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) || fallback;

const attPath = (familyId: string, threadId: string, id: string, ext: string) =>
  `families/${familyId}/messages/${threadId}/${id}.${ext}`;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that image.')); };
    img.src = url;
  });
}

async function downscale(file: Blob): Promise<Blob> {
  if (file.size > MAX_IMAGE_INPUT) throw new Error('Photo is too large — pick something under 25 MB.');
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

/** Downscale + upload a photo. */
export async function uploadMessagePhoto(familyId: string, threadId: string, file: File): Promise<Attachment> {
  if (isGuestActive()) return { kind: 'photo', url: '' };
  if (!file.type.startsWith('image/')) throw new Error("That doesn't look like an image.");
  const blob = await downscale(file);
  const ref = storageRef(storage, attPath(familyId, threadId, newId(), 'jpg'));
  await safeUploadBytes(ref, blob, { contentType: 'image/jpeg' });
  return { kind: 'photo', url: await getDownloadURL(ref), mime: 'image/jpeg', sizeBytes: blob.size };
}

/** Upload a video clip as-is. */
export async function uploadMessageVideo(familyId: string, threadId: string, file: File): Promise<Attachment> {
  if (isGuestActive()) return { kind: 'video', url: '' };
  if (!file.type.startsWith('video/')) throw new Error("That doesn't look like a video.");
  if (file.size > MAX_VIDEO) throw new Error('Video is too big — keep it under ~50 MB.');
  const ref = storageRef(storage, attPath(familyId, threadId, newId(), safeExt(file.name, 'mp4')));
  await safeUploadBytes(ref, file, { contentType: file.type });
  return { kind: 'video', url: await getDownloadURL(ref), mime: file.type, sizeBytes: file.size };
}

/** Upload a document (kid-safe allowlist). */
export async function uploadMessageDocument(familyId: string, threadId: string, file: File): Promise<Attachment> {
  if (isGuestActive()) return { kind: 'document', url: '' };
  if (!DOC_TYPES.has(file.type)) throw new Error('That file type isn’t allowed. Try a PDF, doc, sheet, or text file.');
  if (file.size > MAX_DOC) throw new Error('Document is too big — keep it under 25 MB.');
  const ref = storageRef(storage, attPath(familyId, threadId, newId(), safeExt(file.name, 'bin')));
  await safeUploadBytes(ref, file, { contentType: file.type });
  return { kind: 'document', url: await getDownloadURL(ref), name: file.name, mime: file.type, sizeBytes: file.size };
}

/** Upload a recorded voice note (audio Blob from MediaRecorder). */
export async function uploadMessageVoice(familyId: string, threadId: string, blob: Blob, durationSec: number): Promise<Attachment> {
  if (isGuestActive()) return { kind: 'voice', url: '' };
  if (blob.size > MAX_VOICE) throw new Error('Voice note is too long.');
  const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
  const ref = storageRef(storage, attPath(familyId, threadId, newId(), ext));
  await safeUploadBytes(ref, blob, { contentType: blob.type || 'audio/webm' });
  return { kind: 'voice', url: await getDownloadURL(ref), mime: blob.type, sizeBytes: blob.size, durationSec: Math.round(durationSec) };
}
