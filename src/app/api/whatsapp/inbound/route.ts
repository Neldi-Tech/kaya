// 📲 WhatsApp Alerts — incoming messages (approved 15-Oct-2026, PR1).
//
// Set as the WhatsApp sender's "A message comes in" webhook in Twilio:
//   https://www.ourkaya.com/api/whatsapp/inbound
// R11: a parent replying STOP turns WhatsApp off for that parent only.
// No auto-reply — Kaya only ever sends the approved templates (R3).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { applyWaInbound, verifyTwilioSignature, webhookUrls } from '@/lib/whatsapp.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  if (!verifyTwilioSignature(webhookUrls('/api/whatsapp/inbound', req.nextUrl.search), params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'bad-signature' }, { status: 403 });
  }
  try { await applyWaInbound(db, params); } catch { /* best-effort */ }
  return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
