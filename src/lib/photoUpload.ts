// Client-side photo processing for the Moments feed. Unlike
// `imageUpload.ts` (which centre-crops to a square for avatars), this
// resizer preserves aspect ratio so portraits stay portrait and panos
// stay pano. Each picked photo is turned into three variants:
//
//   thumb (300px long-edge)  · grid + profile strips, ~10-30 KB
//   feed  (1080px long-edge) · the main viewer, ~80-200 KB
//   full  (2400px long-edge) · the lightbox / download, ~300-800 KB
//
// Three sizes keeps the Storage bill predictable AND saves bandwidth on
// the feed (a phone shouldn't pull a 4K original to render a 360px-wide
// card). The originals from the camera roll are NOT stored — by design,
// to keep costs sane and avoid an accidental privacy footgun.

export const MAX_PHOTO_BYTES = 25 * 1024 * 1024; // 25 MB hard cap on input
const THUMB_EDGE = 300;
const FEED_EDGE = 1080;
const FULL_EDGE = 2400;
const JPEG_QUALITY = 0.85;

// ── Video (2026-05-21) ─────────────────────────────────────────────
// Stored as-is (no transcoding); a poster frame is grabbed in-browser so
// the feed paints a still instantly. Caps keep Storage cost + upload time
// bounded — a minute of phone video is ~50-100× a photo.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_VIDEO_SECONDS = 60;
export const ALLOWED_VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

export interface ProcessedPhoto {
  thumbBlob: Blob;
  feedBlob: Blob;
  fullBlob: Blob;
  /** Aspect ratio metadata we persist on the post so the feed can
   *  reserve the right space before the image loads — no layout shift. */
  width: number;
  height: number;
}

export async function processPhotoForUpload(file: File): Promise<ProcessedPhoto> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That doesn’t look like an image file.');
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('Photo is too large — please pick something under 25 MB.');
  }

  const img = await loadImage(file);
  // Original dimensions get persisted on the Photo doc so the feed can
  // render with the correct aspect ratio placeholder.
  const width = img.naturalWidth;
  const height = img.naturalHeight;

  const [thumbBlob, feedBlob, fullBlob] = await Promise.all([
    resizeToBlob(img, THUMB_EDGE),
    resizeToBlob(img, FEED_EDGE),
    resizeToBlob(img, FULL_EDGE),
  ]);

  return { thumbBlob, feedBlob, fullBlob, width, height };
}

export interface ProcessedVideo {
  videoBlob: Blob;
  contentType: string;
  durationSec: number;
  /** Poster still (3 variants + dimensions) — same shape as a photo so
   *  the existing upload + render paths paint it with zero changes. */
  poster: ProcessedPhoto;
}

/** Validate a video + grab a poster frame, all client-side. The clip
 *  itself is returned untouched (no transcoding in v1). Throws a
 *  friendly message if the file is the wrong type / too big / too long. */
export async function processVideoForUpload(file: File): Promise<ProcessedVideo> {
  if (!file.type.startsWith('video/')) {
    throw new Error('That doesn’t look like a video file.');
  }
  if (file.size > MAX_VIDEO_BYTES) {
    throw new Error(`Video is too large — please keep it under ${Math.round(MAX_VIDEO_BYTES / 1024 / 1024)} MB.`);
  }

  const { video, url } = await loadVideo(file);
  try {
    const duration = video.duration;
    if (isFinite(duration) && duration > MAX_VIDEO_SECONDS + 0.5) {
      throw new Error(`Video is too long — please keep it under ${MAX_VIDEO_SECONDS} seconds.`);
    }
    const posterImg = await capturePosterImage(video);
    const [thumbBlob, feedBlob, fullBlob] = await Promise.all([
      resizeToBlob(posterImg, THUMB_EDGE),
      resizeToBlob(posterImg, FEED_EDGE),
      resizeToBlob(posterImg, FULL_EDGE),
    ]);
    return {
      videoBlob: file,
      contentType: file.type || 'video/mp4',
      durationSec: isFinite(duration) ? Math.round(duration) : 0,
      poster: {
        thumbBlob, feedBlob, fullBlob,
        width: posterImg.naturalWidth,
        height: posterImg.naturalHeight,
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadVideo(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve({ video, url });
    video.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read that video.')); };
    video.src = url;
  });
}

// Draw an early frame to a canvas → JPEG → HTMLImageElement we can feed
// to the same resizer photos use. Falls back to a dark still if the
// browser can't decode the frame (e.g. some iPhone HEVC clips elsewhere).
async function capturePosterImage(video: HTMLVideoElement): Promise<HTMLImageElement> {
  const seekTo = Math.min(0.1, (isFinite(video.duration) ? video.duration : 1) / 2);
  await seekVideo(video, seekTo);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 720;
  canvas.height = video.videoHeight || 1280;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not read a video frame in this browser.');
  try {
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  } catch {
    ctx.fillStyle = '#1E120B';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return loadImageFromUrl(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (settled) return; settled = true; video.removeEventListener('seeked', done); resolve(); };
    video.addEventListener('seeked', done);
    try { video.currentTime = time; } catch { done(); }
    // Safety net — some browsers won't fire 'seeked' on a metadata-only load.
    setTimeout(done, 1500);
  });
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not build the video poster.'));
    img.src = url;
  });
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

// Long-edge resize preserving aspect ratio. Skips upscaling — if the
// original is already smaller than the target, we emit the original
// dimensions so we don't blur a low-res photo.
async function resizeToBlob(img: HTMLImageElement, maxEdge: number): Promise<Blob> {
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image in this browser.');
  // High-quality smoothing for the downscale.
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Image encode failed.'))),
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}
