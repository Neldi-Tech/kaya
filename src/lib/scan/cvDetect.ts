// Kaya · Scanning 2.0 — on-device CV edge detection (PR 6b).
//
// Lazy-loads OpenCV.js + jscanify from a CDN ONLY the first time a scan
// needs them, with a HARD timeout + safe fallback, so it can never hang the
// UI like the earlier always-on attempt. Used to pre-place the crop
// editor's corners at CS-Scanner accuracy. On ANY failure (no network,
// slow load, no document found) it returns null and the caller falls back
// to the AI corner-detect, then the manual box — so a scan is never blocked.

import type { DocCorners } from '@/lib/photoEnhance';
import { loadImage, detectDocumentCorners } from '@/lib/photoEnhance';

// Pinned versions — the official global-`cv` build + jscanify UMD.
const OPENCV_URL = 'https://docs.opencv.org/4.10.0/opencv.js';
const JSCANIFY_URL = 'https://cdn.jsdelivr.net/npm/jscanify@1.3.0/dist/jscanify.min.js';

const DEFAULT_TIMEOUT = 9000;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Win = Window & { cv?: any; jscanify?: any };

let scannerPromise: Promise<any | null> | null = null;

function injectScript(src: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-kaya-cv="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.async = true; s.dataset.kayaCv = src;
    const timer = setTimeout(() => reject(new Error('script load timeout')), timeoutMs);
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => { clearTimeout(timer); reject(new Error('script load error')); };
    document.head.appendChild(s);
  });
}

/** Wait for OpenCV's WASM runtime to be ready (handles both the
 *  onRuntimeInitialized hook and the already-initialised race). */
function waitForCv(w: Win, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('cv runtime timeout')), timeoutMs);
    const done = () => { clearTimeout(timer); resolve(); };
    const poll = () => {
      if (w.cv && w.cv.Mat) return done();
      setTimeout(poll, 120);
    };
    if (w.cv && typeof w.cv === 'object') {
      try { w.cv.onRuntimeInitialized = done; } catch { /* ignore */ }
    }
    poll();
  });
}

/** Lazy-load + cache a jscanify scanner instance (or null on failure). */
async function getScanner(timeoutMs = DEFAULT_TIMEOUT): Promise<any | null> {
  if (typeof window === 'undefined') return null;
  if (scannerPromise) return scannerPromise;
  scannerPromise = (async () => {
    const w = window as Win;
    try {
      if (!(w.cv && w.cv.Mat)) {
        await injectScript(OPENCV_URL, timeoutMs);
        await waitForCv(w, timeoutMs);
      }
      if (!w.jscanify) await injectScript(JSCANIFY_URL, timeoutMs);
      if (!w.jscanify) return null;
      return new w.jscanify();
    } catch {
      scannerPromise = null; // allow a retry on the next scan
      return null;
    }
  })();
  return scannerPromise;
}

function clamp01(v: number): number { return v < 0 ? 0 : v > 1 ? 1 : v; }
function normPt(p: { x: number; y: number }, w: number, h: number) {
  return { x: clamp01(p.x / w), y: clamp01(p.y / h) };
}
function quadAreaFraction(c: DocCorners): number {
  const p = [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  let a = 0;
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; a += p[i].x * p[j].y - p[j].x * p[i].y; }
  return Math.abs(a) / 2;
}

/** Detect the page's 4 corners with OpenCV/jscanify. Returns normalised
 *  DocCorners, or null if the lib can't load / no clear page is found. */
export async function detectCornersCV(file: File, timeoutMs = DEFAULT_TIMEOUT): Promise<DocCorners | null> {
  try {
    const scanner = await getScanner(timeoutMs);
    if (!scanner) return null;
    const w = window as Win;
    const img = await loadImage(file);
    const maxEdge = 1200;
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight, 1));
    const cw = Math.max(1, Math.round(img.naturalWidth * scale));
    const ch = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);

    const mat = w.cv.imread(canvas);
    let raw: { topLeftCorner?: { x: number; y: number }; topRightCorner?: { x: number; y: number }; bottomLeftCorner?: { x: number; y: number }; bottomRightCorner?: { x: number; y: number } } | null = null;
    try { raw = scanner.getCornerPoints(mat); } finally { try { mat.delete(); } catch { /* ignore */ } }
    const tl = raw?.topLeftCorner, tr = raw?.topRightCorner, bl = raw?.bottomLeftCorner, br = raw?.bottomRightCorner;
    if (!tl || !tr || !bl || !br) return null;

    const corners: DocCorners = {
      topLeft: normPt(tl, cw, ch), topRight: normPt(tr, cw, ch),
      bottomRight: normPt(br, cw, ch), bottomLeft: normPt(bl, cw, ch),
    };
    // Reject a degenerate / tiny / full-frame detection (jscanify returns the
    // image border when it finds nothing useful).
    const area = quadAreaFraction(corners);
    if (area < 0.12 || area > 0.999) return null;
    return corners;
  } catch {
    return null;
  }
}

/** Best-available corner detection for the crop editor: try on-device CV
 *  first (CS-Scanner-grade), fall back to the AI corner-detect, then the
 *  caller's default box. Never throws. */
export async function detectCornersBest(file: File): Promise<DocCorners | null> {
  const cv = await detectCornersCV(file);
  if (cv) return cv;
  try { return await detectDocumentCorners(file); } catch { return null; }
}
