// Kaya Business · render a sale/cost ledger entry as a shareable RECEIPT image.
//
// Draws on a <canvas> (no extra deps, retina-crisp) → a PNG Blob the kid can
// Copy as image, Save, or Send via Kaya. Amount strings are passed in already
// formatted (the caller has the business currency formatter), so this file
// stays formatting-agnostic.

export interface ReceiptData {
  businessName: string;
  businessEmoji?: string;
  refNo: string;            // "SALE-0042"
  dateLabel: string;        // "3 Jun 2026 · 2:14 PM"
  heading: string;          // "SALE RECEIPT" | "COST RECEIPT"
  item: string;
  qtyPriceStr?: string;     // "3 × TZS 33,333"
  customerLabel?: string;
  paymentLabel?: string;    // "Cash · paid ✓" | "IOU · unpaid"
  totalStr: string;         // "TZS 100,000"
  totalIsCost?: boolean;
  potLabel: string;         // "Went to 🍯 Pot" | "To 🍯 Pot when paid" | "From 🍯 Pot"
  potStr: string;           // "TZS 100,000"
  potTone: 'in' | 'pending' | 'out';
  loggedByName?: string;
}

const NAVY = '#1F2D3D';
const NAVY2 = '#33485f';
const MUTED = '#5C6975';
const LINE = '#E8DEC9';
const GREEN = '#2F7D32';
const GREEN_SOFT = '#E1F3E8';
const HONEY = '#D17F1A';
const HONEY_SOFT = '#FBEBCF';
const ROSE = '#B5403F';
const ROSE_SOFT = '#FBE2E2';

/** Build the receipt as a PNG Blob (transparent-free, white card). */
export async function renderReceiptPng(d: ReceiptData): Promise<Blob> {
  const scale = 2; // retina
  const W = 680;
  // Lines in the body block.
  const rows: Array<[string, string]> = [];
  rows.push(['Item', d.item]);
  if (d.qtyPriceStr) rows.push(['Qty × price', d.qtyPriceStr]);
  if (d.customerLabel) rows.push(['Customer', d.customerLabel]);
  if (d.paymentLabel) rows.push(['Payment', d.paymentLabel]);

  const headerH = 132;
  const rowsH = rows.length * 40 + 14;     // rows + rule gap
  const totalH = 56;
  const potH = 78;
  const footH = 54;
  const H = headerH + rowsH + totalH + potH + footH;

  const canvas = document.createElement('canvas');
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.scale(scale, scale);

  // White card
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Header band (navy gradient)
  const grad = ctx.createLinearGradient(0, 0, W, headerH);
  grad.addColorStop(0, NAVY); grad.addColorStop(1, NAVY2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, headerH);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 30px Nunito, system-ui, sans-serif';
  ctx.fillText(`${d.businessEmoji ? d.businessEmoji + ' ' : ''}${d.businessName}`.slice(0, 40), W / 2, 52);
  ctx.font = '800 14px Nunito, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(d.heading, W / 2, 78);
  ctx.font = '700 12px Nunito, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(`No. ${d.refNo} · ${d.dateLabel}`, W / 2, 104);

  // Body rows
  let y = headerH + 30;
  ctx.font = '700 18px Nunito, system-ui, sans-serif';
  for (const [k, v] of rows) {
    ctx.textAlign = 'left';
    ctx.fillStyle = MUTED;
    ctx.fillText(k, 28, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = NAVY;
    ctx.font = '800 18px Nunito, system-ui, sans-serif';
    ctx.fillText(v.slice(0, 38), W - 28, y);
    ctx.font = '700 18px Nunito, system-ui, sans-serif';
    y += 40;
  }

  // Rule
  ctx.strokeStyle = LINE; ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(28, y - 12); ctx.lineTo(W - 28, y - 12); ctx.stroke();
  ctx.setLineDash([]);

  // Total
  ctx.textAlign = 'left';
  ctx.fillStyle = NAVY;
  ctx.font = '900 24px Nunito, system-ui, sans-serif';
  ctx.fillText('Total', 28, y + 22);
  ctx.textAlign = 'right';
  ctx.fillStyle = d.totalIsCost ? ROSE : NAVY;
  ctx.fillText(`${d.totalIsCost ? '− ' : ''}${d.totalStr}`, W - 28, y + 22);
  y += totalH;

  // Pot band
  const potBg = d.potTone === 'in' ? GREEN_SOFT : d.potTone === 'pending' ? HONEY_SOFT : ROSE_SOFT;
  const potFg = d.potTone === 'in' ? GREEN : d.potTone === 'pending' ? HONEY : ROSE;
  ctx.fillStyle = potBg;
  roundRect(ctx, 20, y, W - 40, 54, 12); ctx.fill();
  ctx.textAlign = 'left';
  ctx.fillStyle = potFg;
  ctx.font = '900 17px Nunito, system-ui, sans-serif';
  ctx.fillText(d.potLabel, 36, y + 33);
  ctx.textAlign = 'right';
  ctx.font = '900 20px Nunito, system-ui, sans-serif';
  ctx.fillText(d.potStr, W - 36, y + 33);
  y += potH;

  // Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = MUTED;
  ctx.font = '700 12px Nunito, system-ui, sans-serif';
  ctx.fillText(`${d.loggedByName ? 'Logged by ' + d.loggedByName + ' · ' : ''}Kaya Business`, W / 2, y + 16);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Plain-text version for "Send as text". */
export function receiptText(d: ReceiptData): string {
  const lines = [
    `🧾 ${d.heading === 'COST RECEIPT' ? 'Cost' : 'Sale'} · ${d.businessName}`,
    `${d.item}${d.qtyPriceStr ? ` — ${d.qtyPriceStr}` : ''}`,
    `Total: ${d.totalIsCost ? '−' : ''}${d.totalStr}`,
  ];
  if (d.customerLabel) lines.push(`Customer: ${d.customerLabel}`);
  lines.push(`${d.potLabel}: ${d.potStr}`);
  lines.push(`— via Kaya Business`);
  return lines.join('\n');
}
