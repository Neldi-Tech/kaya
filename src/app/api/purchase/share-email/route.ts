// Share an approved purchase's printable form by EMAIL (2026-07-04).
//
// Admin-SDK route — verifies the caller's Firebase ID token, confirms they
// belong to the family that owns the request, renders the basket as an
// inline HTML document (mode-aware), and sends it via Resend to the chosen
// recipients (family + outside addresses like a supplier). Mirrors the
// blessed /api/notify Resend pattern.
//
// Safety:
//   • If RESEND_API_KEY is unset the route no-ops ({ skipped: true }) so it
//     never hard-fails in an unconfigured environment.
//   • The parent-only budget CAP is never included in the email (Elia #3).
//   • Sender name leads the From ("Elia via Kaya"); reply-to is the sender
//     so a supplier's reply reaches the real person, not noreply@.

import { NextRequest, NextResponse } from 'next/server';
import { Resend } from 'resend';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { currencyDecimals } from '@/lib/hive';
import {
  MODULE_LABEL, MODULE_EMOJI, formatRequestSeq, type PurchaseRequest,
} from '@/lib/purchase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const apiKey = process.env.RESEND_API_KEY;
const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SHAREABLE = ['approved', 'reconciling', 'pending_close', 'closed'];
type Mode = 'shop' | 'quote' | 'record';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function money(cents: number | undefined, currency: string): string {
  const dec = currencyDecimals(currency);
  const amt = (cents ?? 0) / 100;
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: dec === 0 || amt % 1 === 0 ? 0 : 2,
    maximumFractionDigits: dec === 0 ? 0 : 2,
  }).format(amt);
}

const KIND: Record<Mode, string> = { shop: 'Shopping List', quote: 'Request for Quote', record: 'Approved Order' };

function renderRows(req: PurchaseRequest, mode: Mode, currency: string): string {
  const showEst = mode !== 'quote';
  return (req.items || []).map((it, i) => {
    const estTotal = (it.estimatedCents ?? 0) * (it.qty ?? 0);
    const actual = (it.actualCents != null && it.actualQty != null) ? it.actualCents * it.actualQty : undefined;
    const priceCell = mode === 'record'
      ? (actual != null ? money(actual, currency) : '—')
      : '<span style="color:#b9ac8b">____________</span>';
    return `<tr>
      <td style="padding:8px 6px;border-bottom:1px solid #EEE7D6;color:#9B8A72;font-size:13px">${i + 1}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #EEE7D6;font-size:14px"><b>${esc(it.name)}</b>${it.name2 ? `<br><span style="color:#9B8A72;font-style:italic;font-size:12px">${esc(it.name2)}</span>` : ''}</td>
      <td style="padding:8px 6px;border-bottom:1px solid #EEE7D6;text-align:right;font-size:14px;font-weight:700">${esc(it.qty)}×</td>
      ${showEst ? `<td style="padding:8px 6px;border-bottom:1px solid #EEE7D6;text-align:right;font-size:14px;font-weight:700">${money(it.estimatedCents, currency)}</td>` : ''}
      ${showEst ? `<td style="padding:8px 6px;border-bottom:1px solid #EEE7D6;text-align:right;font-size:14px;font-weight:700">${money(estTotal, currency)}</td>` : ''}
      <td style="padding:8px 6px;border-bottom:1px solid #EEE7D6;text-align:right;font-size:14px;font-weight:700">${priceCell}</td>
    </tr>`;
  }).join('');
}

function renderEmail(req: PurchaseRequest, mode: Mode, currency: string, familyName: string, senderName: string, note: string): string {
  const showEst = mode !== 'quote';
  const kind = KIND[mode];
  const ref = typeof req.seq === 'number' ? formatRequestSeq(req.module, req.seq) : req.name;
  const priceHead = mode === 'quote' ? 'Your quote' : 'Actual';
  const total = showEst ? money(req.estimatedTotalCents, currency) : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#FDFBF7;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:#1A1412">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FDFBF7"><tr><td align="center" style="padding:28px 14px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background:#fff;border:1px solid #E8E0D4;border-radius:16px;overflow:hidden">
      <tr><td style="background:#17223C;color:#fff;padding:20px 24px">
        <table role="presentation" width="100%"><tr>
          <td style="vertical-align:middle"><span style="display:inline-block;width:34px;height:34px;background:#D2A63E;color:#2a2205;border-radius:9px;font-weight:800;text-align:center;line-height:34px;font-size:18px">K</span>
            <span style="font-weight:800;font-size:17px;padding-left:8px;vertical-align:middle">Kaya</span></td>
          <td style="text-align:right;color:#c7cfdd;font-size:12px">${esc(familyName)} · ${MODULE_EMOJI[req.module]} ${esc(MODULE_LABEL[req.module])}</td>
        </tr></table>
        <div style="font-size:22px;font-weight:800;margin-top:12px">${esc(kind)}</div>
        <div style="color:#c7cfdd;font-size:13px">${esc(ref)} · shared by ${esc(senderName)}</div>
      </td></tr>
      <tr><td style="padding:18px 24px">
        <p style="margin:0 0 12px;font-size:14px">${mode === 'quote'
          ? 'Please quote your best price per item below and send it back. Thank you! 🙏'
          : 'Here’s the shopping list. Write the real price next to each item and keep the receipt. 🙏'}</p>
        ${note ? `<p style="margin:0 0 12px;font-size:14px;background:#FFF8EC;border:1px solid #E8DEC9;border-radius:10px;padding:10px 12px"><b>Note:</b> ${esc(note)}</p>` : ''}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:4px">
          <thead><tr style="text-align:left">
            <th style="padding:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9B8A72;border-bottom:2px solid #E4DAC3">#</th>
            <th style="padding:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9B8A72;border-bottom:2px solid #E4DAC3">Item</th>
            <th style="padding:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9B8A72;border-bottom:2px solid #E4DAC3;text-align:right">Qty</th>
            ${showEst ? `<th style="padding:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9B8A72;border-bottom:2px solid #E4DAC3;text-align:right">Est. unit (${esc(currency)})</th>` : ''}
            ${showEst ? `<th style="padding:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9B8A72;border-bottom:2px solid #E4DAC3;text-align:right">Est. total (${esc(currency)})</th>` : ''}
            <th style="padding:6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:#9B8A72;border-bottom:2px solid #E4DAC3;text-align:right">${priceHead} (${esc(currency)})</th>
          </tr></thead>
          <tbody>${renderRows(req, mode, currency)}</tbody>
        </table>
        ${showEst ? `<p style="text-align:right;margin:14px 2px 0;font-size:15px"><span style="color:#9B8A72;font-size:11px;text-transform:uppercase;letter-spacing:.5px">Estimated total · ${esc(currency)}</span><br><b style="font-size:20px">${total}</b></p>` : ''}
      </td></tr>
      <tr><td style="padding:14px 24px;background:#FDFBF7;border-top:1px solid #E8E0D4;font-size:12px;color:#9B8A72;text-align:center">
        Generated by Kaya · <a href="${APP_URL}" style="color:#D4A017;text-decoration:none;font-weight:600">ourkaya.com</a> · Made with love, by a family.
      </td></tr>
    </table>
  </td></tr></table></body></html>`;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { requestId?: string; mode?: string; currency?: string; recipients?: unknown; senderName?: string; senderEmail?: string; note?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const mode: Mode = (['shop', 'quote', 'record'] as const).includes(body.mode as Mode) ? (body.mode as Mode) : 'shop';
  const currency = (typeof body.currency === 'string' && body.currency.length <= 5) ? body.currency : 'USD';
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : '';
  const senderName = (typeof body.senderName === 'string' && body.senderName.trim()) ? body.senderName.trim().slice(0, 80) : 'A family member';
  const senderEmail = (typeof body.senderEmail === 'string' && EMAIL_RE.test(body.senderEmail)) ? body.senderEmail : undefined;

  const recipients = Array.isArray(body.recipients)
    ? Array.from(new Set((body.recipients as unknown[])
        .map((e) => String(e).trim().toLowerCase())
        .filter((e) => EMAIL_RE.test(e)))).slice(0, 15)
    : [];
  if (!requestId || recipients.length === 0) return NextResponse.json({ error: 'requestId + recipients required' }, { status: 400 });

  // Caller must belong to the family that owns the request.
  const userSnap = await db.collection('users').doc(uid).get();
  const familyId = (userSnap.data() as { familyId?: string } | undefined)?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const reqSnap = await db.collection('families').doc(familyId).collection('purchaseRequests').doc(requestId).get();
  if (!reqSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const purchase = { id: reqSnap.id, ...reqSnap.data() } as PurchaseRequest;
  if (!SHAREABLE.includes(purchase.status)) return NextResponse.json({ error: 'not-shareable' }, { status: 400 });

  const famSnap = await db.collection('families').doc(familyId).get();
  const familyName = (famSnap.data() as { name?: string } | undefined)?.name || 'Kaya Family';

  if (!apiKey) return NextResponse.json({ skipped: true, reason: 'RESEND_API_KEY not set', wouldSend: recipients.length });

  const resend = new Resend(apiKey);
  const kind = KIND[mode];
  const ref = typeof purchase.seq === 'number' ? formatRequestSeq(purchase.module, purchase.seq) : purchase.name;
  try {
    const result = await resend.emails.send({
      from: `${senderName} via Kaya <${FROM.replace(/^.*<|>.*$/g, '') || 'noreply@ourkaya.com'}>`,
      to: recipients,
      ...(senderEmail ? { replyTo: senderEmail } : {}),
      subject: `🧾 ${kind} from ${senderName} · ${ref}`,
      html: renderEmail(purchase, mode, currency, familyName, senderName, note),
    });
    return NextResponse.json({ sent: recipients.length, id: result.data?.id });
  } catch (e) {
    return NextResponse.json({ error: (e as { message?: string })?.message || 'send-failed' }, { status: 500 });
  }
}
