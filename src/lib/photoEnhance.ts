// photoEnhance — client-side image enhancement for chat captures (2026-05-27).
//
// Two paths use this:
//   • "Take photo" in chat: applies auto-levels + sharpen to give a quick
//     "look great" preview before sending.
//   • "Scan" in chat: same enhance pipeline per captured page so document
//     scans come out crisper without an external library / Anthropic call.
//
// Pure browser canvas — no network, no WebAssembly. Designed for kid-friendly
// latency (< 250ms on a mid-range phone for a 2400×3200 capture).

/** Load a File or data-URL into an HTMLImageElement, downscaled to fit the
 *  target longest-side (default 2400px) so very large captures stay snappy. */
export async function loadImage(source: File | Blob | string, maxLongSide = 2400): Promise<HTMLImageElement> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source);
  const img = new Image();
  img.decoding = 'async';
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Could not read the image.'));
    img.src = url;
  });
  if (typeof source !== 'string') URL.revokeObjectURL(url);
  // Caller decides whether to draw onto a downscaled canvas — return raw.
  void maxLongSide;
  return img;
}

/** Draw the image onto a canvas with an optional maxLongSide downscale.
 *  Returns the canvas + its 2D context for the caller to mutate. */
function drawToCanvas(img: HTMLImageElement, maxLongSide = 2400): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const longSide = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longSide > maxLongSide ? maxLongSide / longSide : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D not available.');
  ctx.drawImage(img, 0, 0, w, h);
  return { canvas, ctx };
}

/** Auto-levels: stretches the histogram so the darkest pixels go to ~0 and
 *  the brightest go to ~255 using percentile clipping (so a stray hot spot
 *  doesn't blow out the whole image). Adds a touch of contrast at the same
 *  time — kids' phone photos almost always benefit from this. */
function autoLevels(imageData: ImageData, lowPct = 0.5, highPct = 99.5): void {
  const data = imageData.data;
  // Build a luminance histogram.
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i += 4) {
    const l = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) | 0;
    hist[l]++;
  }
  const total = (data.length / 4) | 0;
  const lowCount = (total * lowPct) / 100;
  const highCount = (total * highPct) / 100;
  let lo = 0, hi = 255, acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= lowCount) { lo = i; break; } }
  acc = 0;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= highCount) { hi = i; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < data.length; i += 4) {
    data[i]     = Math.max(0, Math.min(255, ((data[i] - lo) * 255) / range)) | 0;
    data[i + 1] = Math.max(0, Math.min(255, ((data[i + 1] - lo) * 255) / range)) | 0;
    data[i + 2] = Math.max(0, Math.min(255, ((data[i + 2] - lo) * 255) / range)) | 0;
  }
}

/** Light unsharp mask — boosts edges by subtracting a slight blur and
 *  re-adding the difference. Cheap on canvas using a single 3×3 pass. */
function lightSharpen(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, amount = 0.35): void {
  const w = canvas.width;
  const h = canvas.height;
  const src = ctx.getImageData(0, 0, w, h);
  const dst = ctx.createImageData(w, h);
  const s = src.data;
  const d = dst.data;
  // 3×3 sharpen kernel: centre 1 + 4*amount, edges -amount each.
  const c = 1 + 4 * amount;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const o = (y * w + x) * 4;
      const up = ((y - 1) * w + x) * 4;
      const dn = ((y + 1) * w + x) * 4;
      const lf = (y * w + (x - 1)) * 4;
      const rt = (y * w + (x + 1)) * 4;
      for (let k = 0; k < 3; k++) {
        const v = s[o + k] * c - amount * (s[up + k] + s[dn + k] + s[lf + k] + s[rt + k]);
        d[o + k] = Math.max(0, Math.min(255, v));
      }
      d[o + 3] = 255;
    }
  }
  // Copy edges as-is so the output is the same size + has no transparent border.
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) {
      d[i] = s[i]; d[i + 1] = s[i + 1]; d[i + 2] = s[i + 2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(dst, 0, 0);
}

/** Convert a canvas to a JPEG File so it can ride the existing upload path. */
function canvasToFile(canvas: HTMLCanvasElement, name: string, quality = 0.9): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode the image.'));
      resolve(new File([blob], name, { type: 'image/jpeg' }));
    }, 'image/jpeg', quality);
  });
}

export type EnhanceOptions = {
  /** Cap on the longest side after enhancement. Defaults to 2400px — small
   *  enough for fast uploads, big enough for a sharp printable scan. */
  maxLongSide?: number;
  /** JPEG quality, 0–1. Default 0.9. */
  quality?: number;
  /** Output file name. Default "enhanced.jpg". */
  fileName?: string;
};

/** Run the full enhance pipeline on a captured image: load → downscale →
 *  auto-levels → light sharpen → JPEG. Returns both the enhanced File AND a
 *  data URL preview so the caller can show a side-by-side Original vs AI. */
export async function enhancePhoto(source: File, options: EnhanceOptions = {}): Promise<{
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}> {
  const img = await loadImage(source);
  const { canvas, ctx } = drawToCanvas(img, options.maxLongSide ?? 2400);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  autoLevels(data);
  ctx.putImageData(data, 0, 0);
  lightSharpen(canvas, ctx, 0.3);
  const file = await canvasToFile(canvas, options.fileName ?? 'enhanced.jpg', options.quality ?? 0.9);
  const previewUrl = canvas.toDataURL('image/jpeg', options.quality ?? 0.9);
  return { file, previewUrl, width: canvas.width, height: canvas.height };
}

/** Document-scan flavour — same pipeline as enhancePhoto but with stronger
 *  contrast and aggressive sharpen so text reads cleanly. Same output shape. */
export async function enhanceScan(source: File, options: EnhanceOptions = {}): Promise<{
  file: File;
  previewUrl: string;
  width: number;
  height: number;
}> {
  const img = await loadImage(source);
  const { canvas, ctx } = drawToCanvas(img, options.maxLongSide ?? 2400);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  // Tighter percentile clipping for scans — text-heavy images benefit from
  // pushing whites to true white and blacks to true black.
  autoLevels(data, 1.5, 98.5);
  ctx.putImageData(data, 0, 0);
  lightSharpen(canvas, ctx, 0.6);
  const file = await canvasToFile(canvas, options.fileName ?? 'scan.jpg', options.quality ?? 0.92);
  const previewUrl = canvas.toDataURL('image/jpeg', options.quality ?? 0.92);
  return { file, previewUrl, width: canvas.width, height: canvas.height };
}
