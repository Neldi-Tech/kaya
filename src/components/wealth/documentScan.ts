// Kaya Wealth · document scan + enhance engine (PR3 · 2026-06-01).
//
// Turns a phone photo of a document into a clean, official-looking scan —
// "not just a photo" (Non-Negotiable #18: crop, flatten, de-shadow, sharpen).
//
// Two stages:
//   1. Crop + flatten — jscanify (auto paper-edge detection + perspective
//      warp), which runs on OpenCV.js. Both are heavy + client-only, so we
//      lazy-load them from CDN the first time the scanner opens. Neither is
//      bundled (jscanify's npm build drags in node-canvas — a native Vercel
//      build risk — so we load the prebuilt browser bundles instead).
//   2. De-shadow + contrast + sharpen — a pure-canvas pass that always runs.
//
// Graceful fallback: if OpenCV/jscanify fail to load or find no document,
// we skip the crop and still return the enhanced full image, so a scan
// never hard-fails.

/* eslint-disable @typescript-eslint/no-explicit-any */

const OPENCV_SRC = 'https://docs.opencv.org/4.10.0/opencv.js';
const JSCANIFY_SRC = 'https://cdn.jsdelivr.net/npm/jscanify@1.4.2/dist/jscanify.min.js';
const MAX_EDGE = 1800;
const JPEG_Q = 0.9;

export interface ScanResult { blob: Blob; dataUrl: string; autoCropped: boolean }

function loadScript(id: string, src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) { resolve(); return; }
    const s = document.createElement('script');
    s.id = id; s.src = src; s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error(`script-failed:${id}`)); };
    document.body.appendChild(s);
  });
}

let openCvReady: Promise<any> | null = null;
function loadOpenCv(): Promise<any> {
  if (openCvReady) return openCvReady;
  openCvReady = (async () => {
    await loadScript('kw-opencv-js', OPENCV_SRC);
    const w = window as any;
    const cv = w.cv;
    if (cv && typeof cv.then === 'function') { const real = await cv; w.cv = real; return real; }
    if (cv && cv.Mat) return cv;
    await new Promise<void>((res, rej) => {
      const t = setTimeout(() => rej(new Error('opencv-init-timeout')), 25000);
      w.cv = w.cv || {};
      w.cv.onRuntimeInitialized = () => { clearTimeout(t); res(); };
    });
    return w.cv;
  })().catch((e) => { openCvReady = null; throw e; });
  return openCvReady;
}

let jscanifyReady: Promise<any> | null = null;
function loadJscanify(): Promise<any> {
  if (jscanifyReady) return jscanifyReady;
  jscanifyReady = (async () => {
    await loadScript('kw-jscanify-js', JSCANIFY_SRC);
    const ctor = (window as any).jscanify;
    if (!ctor) throw new Error('jscanify-missing');
    return ctor;
  })().catch((e) => { jscanifyReady = null; throw e; });
  return jscanifyReady;
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

function downscale(img: HTMLImageElement, maxEdge: number): HTMLCanvasElement {
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

function canvasToBlob(c: HTMLCanvasElement, q: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode the scan.')), 'image/jpeg', q);
  });
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = sum / win;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = sum / win;
    }
  }
  return out;
}

/** De-shadow (local background normalisation) + contrast + unsharp sharpen.
 *  Keeps colour so stamps/signatures survive. Pure canvas — always runs. */
function enhance(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  // 1. Estimate paper-white background on a coarse grid (brightest sample per
  //    cell ≈ paper), blur it, then scale each pixel so its local background
  //    maps to near-white — this removes uneven lighting + shadows.
  const gw = Math.max(2, Math.round(w / 24)), gh = Math.max(2, Math.round(h / 24));
  const cellW = w / gw, cellH = h / gh;
  const grid = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) {
      const x0 = Math.floor(bx * cellW), x1 = Math.floor((bx + 1) * cellW);
      const y0 = Math.floor(by * cellH), y1 = Math.floor((by + 1) * cellH);
      const sx = Math.max(1, Math.floor((x1 - x0) / 5)), sy = Math.max(1, Math.floor((y1 - y0) / 5));
      let maxL = 1;
      for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) {
        const i = (y * w + x) * 4;
        const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        if (l > maxL) maxL = l;
      }
      grid[by * gw + bx] = maxL;
    }
  }
  const bg = boxBlur(grid, gw, gh, 2);
  const TARGET = 244;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / cellH));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor(x / cellW));
      const scale = TARGET / (bg[gy * gw + gx] || 1);
      const i = (y * w + x) * 4;
      d[i] = clamp255(d[i] * scale);
      d[i + 1] = clamp255(d[i + 1] * scale);
      d[i + 2] = clamp255(d[i + 2] * scale);
    }
  }

  // 2. Contrast around the midpoint (crisp blacks, clean whites).
  const C = 1.16;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = clamp255((d[i] - 128) * C + 128);
    d[i + 1] = clamp255((d[i + 1] - 128) * C + 128);
    d[i + 2] = clamp255((d[i + 2] - 128) * C + 128);
  }

  // 3. Unsharp sharpen via a 3×3 convolution on a copy of the de-shadowed data.
  const out = ctx.createImageData(w, h);
  const o = out.data;
  const a = 0.45, centre = 1 + 4 * a;
  const at = (x: number, y: number, ch: number) =>
    d[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + ch];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        o[i + ch] = clamp255(centre * at(x, y, ch) - a * (at(x - 1, y, ch) + at(x + 1, y, ch) + at(x, y - 1, ch) + at(x, y + 1, ch)));
      }
      o[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return src;
}

/** Main entry: File → cropped + enhanced JPEG scan. Stages are reported via
 *  `onStage` so the UI can show progress. Never throws on CV failure — it
 *  falls back to enhance-only. */
export async function scanDocument(file: File, opts?: { autoCrop?: boolean; onStage?: (s: string) => void }): Promise<ScanResult> {
  const onStage = opts?.onStage ?? (() => {});
  const wantCrop = opts?.autoCrop !== false;
  onStage('Reading photo…');
  const img = await loadImage(file);
  let working = downscale(img, MAX_EDGE);
  let autoCropped = false;

  if (wantCrop) {
    try {
      onStage('Loading scanner…');
      await loadOpenCv();
      const Jscanify = await loadJscanify();
      onStage('Finding the document…');
      const scanner = new Jscanify();
      const paper: HTMLCanvasElement = scanner.extractPaper(working, working.width, working.height);
      if (paper && paper.width > 40 && paper.height > 40) { working = paper; autoCropped = true; }
    } catch {
      autoCropped = false; // fall back to enhance-only
    }
  }

  onStage('Enhancing…');
  const enhanced = enhance(working);
  const blob = await canvasToBlob(enhanced, JPEG_Q);
  const dataUrl = enhanced.toDataURL('image/jpeg', JPEG_Q);
  return { blob, dataUrl, autoCropped };
}
