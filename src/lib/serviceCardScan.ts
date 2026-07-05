// Drivers v2.2 — client wrapper for the service-card/sticker scan
// (2026-07-05). Reuses the receipt pipeline's auto-frame + downscale
// (fileToScanImage) and mirrors scanReceipt's contract: null when the
// AI route is unconfigured (graceful fallback to manual typing),
// throws on a real error. The result only PRE-FILLS the 🎯 fields —
// a human always reviews and taps Save.

import { fileToScanImage } from './receiptScan';

export interface ServiceCardScanResult {
  /** Next-service odometer as printed (in the sticker's own unit). */
  nextServiceOdo: number | null;
  /** 'km' | 'mi' when the sticker states it, else null. */
  odoUnit: 'km' | 'mi' | null;
  /** Next-service date, YYYY-MM-DD. */
  nextServiceDate: string | null;
  /** Odometer at the service just done, when printed. */
  serviceDoneOdo: number | null;
}

export async function scanServiceCard(file: File): Promise<ServiceCardScanResult | null> {
  const { base64, mediaType } = await fileToScanImage(file);
  const res = await fetch('/api/drivers/service-card-scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mediaType }),
  });
  const data = await res.json();
  if (data?.skipped) return null;
  if (!res.ok) throw new Error(data?.error || 'Service-card scan failed');
  const odo = Math.round(Number(data?.nextServiceOdo) || 0);
  const done = Math.round(Number(data?.serviceDoneOdo) || 0);
  const date = String(data?.nextServiceDate || '');
  return {
    nextServiceOdo: odo > 0 ? odo : null,
    odoUnit: data?.odoUnit === 'km' || data?.odoUnit === 'mi' ? data.odoUnit : null,
    nextServiceDate: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
    serviceDoneOdo: done > 0 ? done : null,
  };
}
