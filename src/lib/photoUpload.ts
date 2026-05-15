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
