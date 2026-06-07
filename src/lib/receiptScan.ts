// Client helpers for receipt scanning. Downscale a picked photo, send it
// to /api/receipt-scan, and convert the model's plain-number amounts into
// the cents Kaya stores. The family's currency governs storage — we only
// use the receipt's currency as a sanity hint.
//
// Scanning 2.0 (2026-06-07): fileToScanImage tries AI auto-framing first
// (detect the receipt → warp flat → crop) for cleaner line-item + total
// reads. Falls back to a plain downscale when no clear receipt is found.

import { detectDocumentCorners, warpToDocument } from './photoEnhance';

const MAX_EDGE = 1600; // receipts read fine at this size; keeps the upload light
const JPEG_QUALITY = 0.82;

export interface ScannedItem {
  name: string;
  qty: number;
  unitPriceCents: number;
}

export interface ScanResult {
  items: ScannedItem[];
  totalCents: number;
  /** ISO code the model thinks the receipt is in (hint only). */
  currency: string;
}

/** Auto-frame (when a receipt is detected) or downscale a File to a JPEG
 *  and return its base64 (no data: prefix). */
export async function fileToScanImage(file: File): Promise<{ base64: string; mediaType: string }> {
  if (!file.type.startsWith('image/')) {
    throw new Error('That doesn’t look like an image.');
  }
  // Scanning 2.0 — try AI auto-frame first: a flat, cropped receipt reads best.
  try {
    const corners = await detectDocumentCorners(file);
    if (corners) {
      const warpedImg = await loadImage(file);
      const warped = warpToDocument(warpedImg, corners, MAX_EDGE);
      if (warped) {
        const dataUrl = warped.toDataURL('image/jpeg', JPEG_QUALITY);
        return { base64: dataUrl.split(',')[1] || '', mediaType: 'image/jpeg' };
      }
    }
  } catch {
    // fall back to the plain downscale below
  }
  const img = await loadImage(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);
  const scale = longEdge > MAX_EDGE ? MAX_EDGE / longEdge : 1;
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image in this browser.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  const base64 = dataUrl.split(',')[1] || '';
  return { base64, mediaType: 'image/jpeg' };
}

/** Scan a receipt photo → structured result in cents. Returns null when
 *  the AI route is unconfigured (graceful no-op) so the caller can fall
 *  back to manual entry. Throws on a real error. */
export async function scanReceipt(file: File, currency?: string): Promise<ScanResult | null> {
  const { base64, mediaType } = await fileToScanImage(file);
  const res = await fetch('/api/receipt-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mediaType, currency }),
  });
  const data = await res.json();
  if (data?.skipped) return null;
  if (!res.ok) throw new Error(data?.error || 'Receipt scan failed');

  const items: ScannedItem[] = Array.isArray(data?.items)
    ? data.items.map((i: { name?: string; qty?: number; unitPrice?: number }) => {
        const q = Number(i?.qty);
        return {
          name: String(i?.name || '').slice(0, 60),
          // Preserve decimals (0.23 kg); fall back to 1, never force ≥1.
          qty: q > 0 ? Math.round(q * 1000) / 1000 : 1,
          unitPriceCents: Math.max(0, Math.round((Number(i?.unitPrice) || 0) * 100)),
        };
      }).filter((i: ScannedItem) => i.name)
    : [];
  return {
    items,
    totalCents: Math.max(0, Math.round((Number(data?.total) || 0) * 100)),
    currency: String(data?.currency || '').slice(0, 8),
  };
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
