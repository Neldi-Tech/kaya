// Kaya Pulse · rotation flip (server cron).
//
// Runs weekly, Sunday 20:55 UTC = 23:55 EAT — just before the Monday 00:05 EAT
// generate run, so Monday's task is created for the NEW owner. For each active
// rotating template that's due (rotationNextFlipAt <= now), advances
// rotationCurrent to the next member in the pool and re-arms the timer. A
// template with no timer yet is initialised to a full period (no early flip).
// No-ops cleanly without admin creds.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function periodDays(period?: string): number {
  return period === 'biweekly' ? 14 : period === 'monthly' ? 30 : 7;
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const now = Date.now();
  let families;
  try {
    families = await db.collection('families').get();
  } catch (e) {
    return NextResponse.json({ error: 'families-read-failed', detail: String(e) }, { status: 500 });
  }

  let flipped = 0;
  let armed = 0;
  for (const fam of families.docs) {
    let tplSnap;
    try {
      tplSnap = await fam.ref.collection('pulseTemplates').where('active', '==', true).get();
    } catch {
      continue;
    }
    for (const tplDoc of tplSnap.docs) {
      const tpl = tplDoc.data() as {
        ownerType?: string; rotationPool?: string[]; rotationCurrent?: string;
        rotationPeriod?: string; rotationNextFlipAt?: FirebaseFirestore.Timestamp;
      };
      if (tpl.ownerType !== 'rotating') continue;
      const pool = tpl.rotationPool;
      if (!pool || pool.length < 2) continue;

      const days = periodDays(tpl.rotationPeriod);
      const nextFlip = tpl.rotationNextFlipAt?.toMillis?.();

      if (nextFlip == null) {
        // First run after creation — give the current owner a full period.
        try {
          await tplDoc.ref.update({ rotationNextFlipAt: new Date(now + days * 86_400_000) });
          armed++;
        } catch { /* skip */ }
        continue;
      }
      if (nextFlip > now) continue; // not due yet

      const curIdx = Math.max(0, pool.indexOf(tpl.rotationCurrent ?? pool[0]));
      const newCurrent = pool[(curIdx + 1) % pool.length];
      try {
        await tplDoc.ref.update({
          rotationCurrent: newCurrent,
          rotationNextFlipAt: new Date(now + days * 86_400_000),
        });
        flipped++;
      } catch { /* skip */ }
    }
  }

  return NextResponse.json({ ok: true, flipped, armed });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
