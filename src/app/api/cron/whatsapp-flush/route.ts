// 📲 WhatsApp Alerts — the 30-minute flush (approved 15-Oct-2026, PR1).
//
//   (1) quiet-hours outbox (R8): held alerts whose time has come are
//       re-checked (rating fixed? reflection written? deduction removed?
//       parent switched off?) — then sent or dropped, and the 📜 trace says why.
//   (2) numbers saved before Kaya's Twilio keys existed get their T0 test.
// No-op until the keys are set. Secured by CRON_SECRET when set.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { flushWa, waConfigured } from '@/lib/whatsapp.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });
  if (!waConfigured()) return NextResponse.json({ skipped: true, reason: 'whatsapp-not-configured' });
  const result = await flushWa(db);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
