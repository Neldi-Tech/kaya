// 📲 WhatsApp Alerts — Twilio status callback (approved 15-Oct-2026, PR1).
//
// Every send carries StatusCallback = <app>/api/whatsapp/status, so Twilio
// reports queued → sent → delivered → read · failed here. Signature-checked
// (X-Twilio-Signature). Feeds the Settings test tick (card B → C / D) and
// the 📜 Alert log "Who got it" list (R10).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { applyWaStatus, verifyTwilioSignature, webhookUrls } from '@/lib/whatsapp.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  const raw = await req.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());
  if (!verifyTwilioSignature(webhookUrls('/api/whatsapp/status', req.nextUrl.search), params, req.headers.get('x-twilio-signature'))) {
    return NextResponse.json({ error: 'bad-signature' }, { status: 403 });
  }
  try { await applyWaStatus(db, params); } catch { /* never make Twilio retry-storm */ }
  return new NextResponse('<Response></Response>', { status: 200, headers: { 'Content-Type': 'text/xml' } });
}
