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

// ── Scanning 2.0 — AI auto-frame (detect → reshape → zoom) ──────────
//
// The old enhanceScan only *cleans*. These functions add the missing
// geometric step: an AI vision pass (/api/scan/frame) returns the page's
// four corners, then we perspective-warp the page flat + crop the
// background out, and only then clean it. The OCR pass downstream now
// sees a square, tight document → far better reads of the questions.
//
// Everything degrades safely: if no clear page is found (or the AI call is
// unavailable), autoFrameScan falls back to enhanceScan — never worse than
// before.

export interface NormPoint { x: number; y: number }
export interface DocCorners {
  topLeft: NormPoint; topRight: NormPoint; bottomRight: NormPoint; bottomLeft: NormPoint;
}

const MIN_FRAME_CONFIDENCE = 0.45;
const MIN_FRAME_AREA = 0.12; // reject quads smaller than 12% of the image

/** Downscale a File to a small JPEG + return raw base64 (no data: prefix)
 *  for the corner-detection call — small = fast + cheap; corners are
 *  resolution-independent fractions so quality isn't lost. */
async function fileToDownscaledBase64(file: File, maxLongSide = 1100): Promise<{ base64: string; mediaType: 'image/jpeg' }> {
  const img = await loadImage(file);
  const { canvas } = drawToCanvas(img, maxLongSide);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' };
}

function clampPoint(p: unknown): NormPoint | null {
  const o = p as { x?: unknown; y?: unknown } | null;
  const x = typeof o?.x === 'number' && isFinite(o.x) ? o.x : null;
  const y = typeof o?.y === 'number' && isFinite(o.y) ? o.y : null;
  if (x === null || y === null) return null;
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function clampCorners(c: unknown): DocCorners | null {
  const o = c as Record<string, unknown> | null;
  if (!o) return null;
  const tl = clampPoint(o.topLeft), tr = clampPoint(o.topRight);
  const br = clampPoint(o.bottomRight), bl = clampPoint(o.bottomLeft);
  if (!tl || !tr || !br || !bl) return null;
  return { topLeft: tl, topRight: tr, bottomRight: br, bottomLeft: bl };
}

/** Fraction (0..1) of the image area covered by the quad (shoelace). */
function quadAreaFraction(c: DocCorners): number {
  const p = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  let a = 0;
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += p[i].x * p[j].y - p[j].x * p[i].y; }
  return Math.abs(a) / 2;
}

/** Ask the AI where the page is. Returns validated corners, or null when
 *  there's no clear/large-enough page (caller falls back to clean-only). */
export async function detectDocumentCorners(
  file: File,
  opts: { minConfidence?: number; signal?: AbortSignal } = {},
): Promise<DocCorners | null> {
  try {
    const { base64, mediaType } = await fileToDownscaledBase64(file);
    const res = await fetch('/api/scan/frame', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mediaType }),
      signal: opts.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!json || json.skipped || !json.isDocument) return null;
    const conf = typeof json.confidence === 'number' ? json.confidence : 0;
    if (conf < (opts.minConfidence ?? MIN_FRAME_CONFIDENCE)) return null;
    const corners = clampCorners(json.corners);
    if (!corners) return null;
    if (quadAreaFraction(corners) < MIN_FRAME_AREA) return null;
    return corners;
  } catch {
    return null;
  }
}

// ── Perspective warp (pure canvas, no wasm) ────────────────────────

/** Solve a square linear system A·x = b by Gaussian elimination with
 *  partial pivoting. Returns null if singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-9) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n);
  for (let i = 0; i < n; i++) x[i] = M[i][n] / M[i][i];
  return x;
}

type Pt = { x: number; y: number };

/** Homography (row-major 3×3, length 9) mapping from[i] → to[i] for the
 *  four corner pairs (TL, TR, BR, BL). */
function computeHomography(from: Pt[], to: Pt[]): number[] | null {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: X, y: Y } = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
  }
  const h = solveLinear(A, b);
  if (!h) return null;
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Warp the page bounded by `corners` (normalised) to a flat, cropped
 *  rectangle. Output dimensions follow the detected edge lengths so the
 *  page keeps its aspect. Returns null on a degenerate quad. */
export function warpToDocument(
  img: HTMLImageElement, corners: DocCorners, maxLongSide = 1700,
): HTMLCanvasElement | null {
  const { canvas: srcCanvas, ctx: srcCtx } = drawToCanvas(img, 2600);
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const s = {
    tl: { x: corners.topLeft.x * sw, y: corners.topLeft.y * sh },
    tr: { x: corners.topRight.x * sw, y: corners.topRight.y * sh },
    br: { x: corners.bottomRight.x * sw, y: corners.bottomRight.y * sh },
    bl: { x: corners.bottomLeft.x * sw, y: corners.bottomLeft.y * sh },
  };
  const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.round(Math.max(dist(s.tl, s.tr), dist(s.bl, s.br)));
  let H = Math.round(Math.max(dist(s.tl, s.bl), dist(s.tr, s.br)));
  if (W < 16 || H < 16) return null;
  const long = Math.max(W, H);
  if (long > maxLongSide) { const k = maxLongSide / long; W = Math.round(W * k); H = Math.round(H * k); }

  // Map dest rect → src quad so each dest pixel samples from the source.
  const Hm = computeHomography(
    [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }],
    [s.tl, s.tr, s.br, s.bl],
  );
  if (!Hm) return null;

  const sdata = srcCtx.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const octx = out.getContext('2d', { willReadFrequently: true });
  if (!octx) return null;
  const odata = octx.createImageData(W, H);
  const od = odata.data;
  const h0 = Hm[0], h1 = Hm[1], h2 = Hm[2], h3 = Hm[3], h4 = Hm[4], h5 = Hm[5], h6 = Hm[6], h7 = Hm[7], h8 = Hm[8];

  for (let v = 0; v < H; v++) {
    for (let u = 0; u < W; u++) {
      const ux = u + 0.5, vy = v + 0.5;
      const d = h6 * ux + h7 * vy + h8;
      const sx = (h0 * ux + h1 * vy + h2) / d;
      const sy = (h3 * ux + h4 * vy + h5) / d;
      const o = (v * W + u) * 4;
      if (sx < 0 || sy < 0 || sx >= sw - 1 || sy >= sh - 1) {
        od[o] = 255; od[o + 1] = 255; od[o + 2] = 255; od[o + 3] = 255; // outside the page → white
        continue;
      }
      const x0 = sx | 0, y0 = sy | 0;
      const fx = sx - x0, fy = sy - y0;
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      for (let k = 0; k < 3; k++) {
        const top = sdata[i00 + k] * (1 - fx) + sdata[i10 + k] * fx;
        const bot = sdata[i01 + k] * (1 - fx) + sdata[i11 + k] * fx;
        od[o + k] = (top * (1 - fy) + bot * fy) | 0;
      }
      od[o + 3] = 255;
    }
  }
  octx.putImageData(odata, 0, 0);
  return out;
}

export interface AutoFrameResult {
  file: File;
  previewUrl: string;
  width: number;
  height: number;
  /** true when a page was detected + reshaped; false = clean-only fallback. */
  framed: boolean;
}

/** Scanning 2.0 entry point: detect the page → warp flat + crop → clean.
 *  Falls back to enhanceScan (clean-only) when no clear page is found or
 *  the AI framing is unavailable. Drop-in replacement for enhanceScan
 *  (same output shape + a `framed` flag). */
export async function autoFrameScan(
  source: File,
  options: EnhanceOptions & { minConfidence?: number; signal?: AbortSignal } = {},
): Promise<AutoFrameResult> {
  try {
    const corners = await detectDocumentCorners(source, {
      minConfidence: options.minConfidence, signal: options.signal,
    });
    if (corners) {
      const img = await loadImage(source);
      const warped = warpToDocument(img, corners, options.maxLongSide ?? 1700);
      if (warped) {
        const ctx = warped.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          const data = ctx.getImageData(0, 0, warped.width, warped.height);
          autoLevels(data, 1.5, 98.5);
          ctx.putImageData(data, 0, 0);
          lightSharpen(warped, ctx, 0.6);
          const file = await canvasToFile(warped, options.fileName ?? 'scan.jpg', options.quality ?? 0.92);
          const previewUrl = warped.toDataURL('image/jpeg', options.quality ?? 0.92);
          return { file, previewUrl, width: warped.width, height: warped.height, framed: true };
        }
      }
    }
  } catch {
    // fall through to clean-only
  }
  const cleaned = await enhanceScan(source, options);
  return { ...cleaned, framed: false };
}

/** Rotate a File 90° clockwise → a new JPEG File. Lets the crop editor fix
 *  a sideways capture (common when a landscape page is shot in portrait). */
export async function rotateFile90(file: File): Promise<File> {
  const img = await loadImage(file);
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = h; canvas.height = w; // dimensions swap on a 90° turn
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.translate(h / 2, w / 2);
  ctx.rotate(Math.PI / 2);
  ctx.drawImage(img, -w / 2, -h / 2);
  return new Promise((resolve) => {
    canvas.toBlob(
      (b) => resolve(b ? new File([b], file.name || 'rotated.jpg', { type: 'image/jpeg' }) : file),
      'image/jpeg', 0.95,
    );
  });
}

// ── Stronger document clean (CS-Scanner-style) ─────────────────────
// De-shadow (local paper-white normalisation) + contrast + unsharp, so a
// glare-y, shadowed phone photo comes out crisp + evenly white — not "just
// a photo". Keeps colour (so logos/diagrams survive).

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

function boxBlur1D(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h), win = r * 2 + 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let k = -r; k <= r; k++) s += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
    tmp[y * w + x] = s / win;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; for (let k = -r; k <= r; k++) s += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
    out[y * w + x] = s / win;
  }
  return out;
}

/** In-place CS-Scanner-style clean of a canvas (de-shadow + contrast + unsharp). */
export function documentClean(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  // 1. De-shadow: brightest sample per coarse cell ≈ local paper white.
  const gw = Math.max(2, Math.round(w / 24)), gh = Math.max(2, Math.round(h / 24));
  const cellW = w / gw, cellH = h / gh;
  const grid = new Float32Array(gw * gh);
  for (let by = 0; by < gh; by++) for (let bx = 0; bx < gw; bx++) {
    const x0 = Math.floor(bx * cellW), x1 = Math.floor((bx + 1) * cellW);
    const y0 = Math.floor(by * cellH), y1 = Math.floor((by + 1) * cellH);
    const sx = Math.max(1, Math.floor((x1 - x0) / 5)), sy = Math.max(1, Math.floor((y1 - y0) / 5));
    let maxL = 1;
    for (let y = y0; y < y1; y += sy) for (let x = x0; x < x1; x += sx) {
      const i = (y * w + x) * 4; const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (l > maxL) maxL = l;
    }
    grid[by * gw + bx] = maxL;
  }
  const bg = boxBlur1D(grid, gw, gh, 2);
  const TARGET = 245, C = 1.22;
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor(y / cellH));
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor(x / cellW));
      const scale = TARGET / (bg[gy * gw + gx] || 1);
      const i = (y * w + x) * 4;
      d[i]     = clamp255((clamp255(d[i]     * scale) - 128) * C + 128);
      d[i + 1] = clamp255((clamp255(d[i + 1] * scale) - 128) * C + 128);
      d[i + 2] = clamp255((clamp255(d[i + 2] * scale) - 128) * C + 128);
    }
  }
  ctx.putImageData(image, 0, 0);
  // 2. Unsharp via a single GPU blur (fast on large images).
  try {
    const blurC = document.createElement('canvas');
    blurC.width = w; blurC.height = h;
    const bctx = blurC.getContext('2d');
    if (bctx) {
      bctx.filter = 'blur(1.1px)';
      bctx.drawImage(canvas, 0, 0);
      const blur = bctx.getImageData(0, 0, w, h).data;
      const sharp = ctx.getImageData(0, 0, w, h);
      const s = sharp.data; const amt = 0.7;
      for (let i = 0; i < s.length; i += 4) {
        s[i]     = clamp255(s[i]     + amt * (s[i]     - blur[i]));
        s[i + 1] = clamp255(s[i + 1] + amt * (s[i + 1] - blur[i + 1]));
        s[i + 2] = clamp255(s[i + 2] + amt * (s[i + 2] - blur[i + 2]));
      }
      ctx.putImageData(sharp, 0, 0);
    }
  } catch { /* blur filter unsupported — de-shadow + contrast already applied */ }
}

/** Rotate a File 90° CW → { file, previewUrl } for a one-tap manual rotate
 *  on a scan result (keeps the same data-URL preview shape the UI expects). */
export async function rotateFile90WithPreview(
  file: File, options: EnhanceOptions = {},
): Promise<{ file: File; previewUrl: string }> {
  const img = await loadImage(file);
  const { canvas } = drawToCanvas(img, options.maxLongSide ?? 1700);
  const rotated = rotateCanvasDegrees(canvas, 90);
  const out = await canvasToFile(rotated, options.fileName ?? 'scan.jpg', options.quality ?? 0.92);
  return { file: out, previewUrl: rotated.toDataURL('image/jpeg', options.quality ?? 0.92) };
}

/** Rotate a canvas 0/90/180/270° clockwise → a NEW canvas. */
export function rotateCanvasDegrees(src: HTMLCanvasElement, deg: 0 | 90 | 180 | 270): HTMLCanvasElement {
  if (deg === 0) return src;
  const w = src.width, h = src.height;
  const out = document.createElement('canvas');
  const ctx = out.getContext('2d', { willReadFrequently: true });
  if (!ctx) return src;
  if (deg === 180) { out.width = w; out.height = h; ctx.translate(w, h); ctx.rotate(Math.PI); }
  else {
    out.width = h; out.height = w;
    if (deg === 90) { ctx.translate(h, 0); ctx.rotate(Math.PI / 2); }
    else { ctx.translate(0, w); ctx.rotate(-Math.PI / 2); }
  }
  ctx.drawImage(src, 0, 0);
  return out;
}

/** Ask the AI which way is up (post-crop). Returns the clockwise degrees to
 *  make the text upright; 0 on any failure (best-effort). */
export async function detectUprightRotation(
  canvas: HTMLCanvasElement, opts: { signal?: AbortSignal } = {},
): Promise<0 | 90 | 180 | 270> {
  try {
    const long = Math.max(canvas.width, canvas.height);
    const scale = long > 1000 ? 1000 / long : 1;
    let src: HTMLCanvasElement = canvas;
    if (scale < 1) {
      const c = document.createElement('canvas');
      c.width = Math.round(canvas.width * scale); c.height = Math.round(canvas.height * scale);
      const cc = c.getContext('2d'); if (!cc) return 0;
      cc.drawImage(canvas, 0, 0, c.width, c.height); src = c;
    }
    const dataUrl = src.toDataURL('image/jpeg', 0.8);
    const res = await fetch('/api/scan/orient', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: dataUrl.split(',')[1] ?? '', mediaType: 'image/jpeg' }),
      signal: opts.signal,
    });
    if (!res.ok) return 0;
    const json = await res.json();
    const r = json?.rotate;
    return (r === 90 || r === 180 || r === 270) ? r : 0;
  } catch { return 0; }
}

/** Warp an image to EXACTLY the given corners, then clean it — the confirm
 *  step of the manual crop editor (the user has already set orientation via
 *  the editor's Rotate, so this does NOT auto-rotate). Null on a bad quad. */
export async function cropCleanScan(
  img: HTMLImageElement,
  corners: DocCorners,
  options: EnhanceOptions = {},
): Promise<{ file: File; previewUrl: string; width: number; height: number } | null> {
  const warped = warpToDocument(img, corners, options.maxLongSide ?? 1700);
  if (!warped) return null;
  documentClean(warped);
  const file = await canvasToFile(warped, options.fileName ?? 'scan.jpg', options.quality ?? 0.92);
  const previewUrl = warped.toDataURL('image/jpeg', options.quality ?? 0.92);
  return { file, previewUrl, width: warped.width, height: warped.height };
}

/** Auto scan (no prompt): detect the page with the supplied detector (CV →
 *  AI), warp it flat + crop, auto-rotate upright, then clean — the bulk
 *  flow. Falls back to clean-only when no clear page is found. The detector
 *  is injected so this module needn't import the CV layer (avoids a cycle). */
export async function autoScanWithDetector(
  source: File,
  detect: (f: File) => Promise<DocCorners | null>,
  options: EnhanceOptions & { autoRotate?: boolean } = {},
): Promise<AutoFrameResult> {
  try {
    const corners = await detect(source);
    if (corners) {
      const img = await loadImage(source);
      const warped = warpToDocument(img, corners, options.maxLongSide ?? 1700);
      if (warped) {
        let out = warped;
        if (options.autoRotate !== false) {
          const rot = await detectUprightRotation(warped);
          out = rotateCanvasDegrees(warped, rot);
        }
        documentClean(out);
        const file = await canvasToFile(out, options.fileName ?? 'scan.jpg', options.quality ?? 0.92);
        const previewUrl = out.toDataURL('image/jpeg', options.quality ?? 0.92);
        return { file, previewUrl, width: out.width, height: out.height, framed: true };
      }
    }
  } catch { /* fall through to clean-only */ }
  const cleaned = await enhanceScan(source, options);
  return { ...cleaned, framed: false };
}
