// Kaya Pulse · parent "generate today's tasks" (server, Admin SDK).
//
// Materialises today's pulseTasks for one family on demand. The daily cron does
// this automatically at 00:05 EAT; this is the one-tap button in Task setup for
// initial setup + testing. Idempotent (deterministic ids), and harmless to
// re-run — it only creates tasks from already-configured templates.
//
// Phase 1: open (no auth) like the other /api fan-out routes; it exposes no data
// and only materialises configured tasks. ID-token verification is a follow-up.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { generateForFamily, todayKey } from '@/lib/pulseGenerate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

async function run(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });

  let body: { familyId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  if (!body.familyId) return NextResponse.json({ error: 'missing-familyId' }, { status: 400 });

  const dayKey = todayKey();
  try {
    const r = await generateForFamily(db.collection('families').doc(body.familyId), dayKey);
    return NextResponse.json({ ok: true, dayKey, ...r });
  } catch (e) {
    return NextResponse.json({ error: 'generate-failed', detail: String(e) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return run(req);
}
