// Kaya Wealth · document scan + enhance engine (canvas-only · 2026-06-01).
//
// Turns a phone photo of a document into a clean, official-looking scan —
// "not just a photo" (Non-Negotiable #18): de-shadow, contrast, sharpen.
//
// Pure canvas — fast and reliable, NO external CV libraries. (The earlier
// build lazy-loaded OpenCV.js + jscanify from CDN for auto edge-crop +
// perspective flatten, but that load could hang the scan for many seconds and
// made it feel broken. Reliable enhancement matters more than auto-crop, which
// can come back later as an opt-in once it's robust.)

const MAX_EDGE = 1500;
const JPEG_Q = 0.9;

export interface ScanResult { blob: Blob; dataUrl: string; autoCropped: boolean }

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
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
  const scale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * scale));
  c.height = Math.max(1, Math.round(img.naturalHeight * scale));
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

/** De-shadow (local background normalisation) + contrast + a fast unsharp.
 *  All O(n) plus one GPU blur — quick even on a phone. Keeps colour. */
function enhance(src: HTMLCanvasElement): HTMLCanvasElement {
  const w = src.width, h = src.height;
  const ctx = src.getContext('2d', { willReadFrequently: true })!;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;

  // 1. De-shadow — estimate paper-white background on a coarse grid (brightest
  //    sample per cell ≈ paper), blur it, then scale each pixel so its local
  //    background maps near white. Removes uneven lighting + shadows.
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
  const C = 1.16;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / cellH));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor(x / cellW));
      const scale = TARGET / (bg[gy * gw + gx] || 1);
      const i = (y * w + x) * 4;
      // de-shadow scale, then contrast around the midpoint, in one pass.
      d[i]     = clamp255((clamp255(d[i]     * scale) - 128) * C + 128);
      d[i + 1] = clamp255((clamp255(d[i + 1] * scale) - 128) * C + 128);
      d[i + 2] = clamp255((clamp255(d[i + 2] * scale) - 128) * C + 128);
    }
  }
  ctx.putImageData(image, 0, 0);

  // 2. Fast unsharp — blur a copy on a temp canvas (GPU), combine in one O(n)
  //    pass. No per-pixel convolution, so it stays quick on large images.
  try {
    const blurC = document.createElement('canvas');
    blurC.width = w; blurC.height = h;
    const bctx = blurC.getContext('2d')!;
    bctx.filter = 'blur(1.1px)';
    bctx.drawImage(src, 0, 0);
    const blur = bctx.getImageData(0, 0, w, h).data;
    const sharp = ctx.getImageData(0, 0, w, h);
    const s = sharp.data;
    const amt = 0.7;
    for (let i = 0; i < s.length; i += 4) {
      s[i]     = clamp255(s[i]     + amt * (s[i]     - blur[i]));
      s[i + 1] = clamp255(s[i + 1] + amt * (s[i + 1] - blur[i + 1]));
      s[i + 2] = clamp255(s[i + 2] + amt * (s[i + 2] - blur[i + 2]));
    }
    ctx.putImageData(sharp, 0, 0);
  } catch { /* blur filter unsupported — de-shadow + contrast already applied */ }

  return src;
}

/** File → enhanced JPEG scan. Fast, never hangs. */
export async function scanDocument(file: File, opts?: { autoCrop?: boolean; onStage?: (s: string) => void }): Promise<ScanResult> {
  const onStage = opts?.onStage ?? (() => {});
  onStage('Reading photo…');
  const img = await loadImage(file);
  const canvas = downscale(img, MAX_EDGE);
  onStage('Enhancing…');
  const enhanced = enhance(canvas);
  const blob = await canvasToBlob(enhanced, JPEG_Q);
  const dataUrl = enhanced.toDataURL('image/jpeg', JPEG_Q);
  return { blob, dataUrl, autoCropped: false };
}
