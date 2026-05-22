// Kaya Pulse · daily task-instance generator (server cron).
//
// Runs daily just after local midnight (see vercel.json — 21:05 UTC = 00:05
// EAT). Delegates to the shared generator in lib/pulseGenerate so the parent
// "generate now" route stays in sync. No-ops cleanly without admin creds.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateForAllFamilies, todayKey } from '@/lib/pulseGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const dayKey = todayKey();
  try {
    const r = await generateForAllFamilies(db, dayKey);
    return NextResponse.json({ ok: true, dayKey, ...r });
  } catch (e) {
    return NextResponse.json({ error: 'generate-failed', detail: String(e) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
