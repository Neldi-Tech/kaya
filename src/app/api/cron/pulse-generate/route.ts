// Kaya Pulse · daily task-instance generator (server cron).
//
// Runs daily just after local midnight (see vercel.json — 21:05 UTC = 00:05
// EAT). For each family, for each ACTIVE pulseTemplate due today, it creates a
// pulseTask for the current owner (the fixed owner, or the rotation's current
// member). Idempotent: the task doc id is `${templateId}_${dayKey}`, written
// with .create() so a re-run is a clean no-op. No-ops without admin creds.
//
// Phase-1 timezone is Africa/Dar_es_Salaam (the Tim family). Per-family tz
// (from family.location) is a later refinement — keep PULSE_TZ in sync with
// the client (src/app/(app)/pulse/today).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { dayKeyInTZ } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const PULSE_TZ = 'Africa/Dar_es_Salaam';
const PULSE_TZ_OFFSET = '+03:00'; // EAT, no DST — keep aligned with PULSE_TZ

// 0=Sun..6=Sat for the given local date (treated as UTC midnight for weekday).
function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay();
}
function weekIndex(dayKey: string): number {
  return Math.floor(Date.parse(`${dayKey}T00:00:00Z`) / (7 * 86_400_000));
}
function isDueToday(tpl: { cadence?: string; cadenceN?: number }, dayKey: string): boolean {
  const dow = weekdayOf(dayKey);
  switch (tpl.cadence) {
    case 'daily':
      return true;
    case 'weekly':
      return dow === 1; // Monday
    case 'everyNWeeks':
      return dow === 1 && weekIndex(dayKey) % Math.max(2, tpl.cadenceN ?? 2) === 0;
    default:
      return false; // 'custom' has no generator UI yet
  }
}

async function run(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const dayKey = dayKeyInTZ(new Date(), PULSE_TZ);

  let families;
  try {
    families = await db.collection('families').get();
  } catch (e) {
    return NextResponse.json({ error: 'families-read-failed', detail: String(e) }, { status: 500 });
  }

  let scanned = 0;
  let created = 0;
  for (const fam of families.docs) {
    let tplSnap;
    try {
      tplSnap = await fam.ref.collection('pulseTemplates').where('active', '==', true).get();
    } catch {
      continue;
    }

    for (const tplDoc of tplSnap.docs) {
      scanned++;
      const tpl = tplDoc.data() as {
        cadence?: string; cadenceN?: number; trackableId?: string; trackableSource?: string;
        ownerKind?: string; ownerType?: string; ownerId?: string;
        rotationCurrent?: string; rotationPool?: string[];
        pointsValue?: number; dueTimeLocal?: string;
      };
      if (!isDueToday(tpl, dayKey) || !tpl.trackableId) continue;

      const ownerId = tpl.ownerType === 'fixed' ? tpl.ownerId : tpl.rotationCurrent || tpl.rotationPool?.[0];
      if (!ownerId) continue;

      const dueTime = tpl.dueTimeLocal && /^\d{2}:\d{2}$/.test(tpl.dueTimeLocal) ? tpl.dueTimeLocal : '20:00';
      const dueAt = new Date(`${dayKey}T${dueTime}:00${PULSE_TZ_OFFSET}`);
      const taskId = `${tplDoc.id}_${dayKey}`;

      try {
        await fam.ref.collection('pulseTasks').doc(taskId).create({
          templateId: tplDoc.id,
          trackableId: tpl.trackableId,
          trackableSource: tpl.trackableSource ?? 'meter',
          ownerKind: tpl.ownerKind ?? 'kid',
          ownerId,
          dayKey,
          dueAt,
          status: 'pending',
          pointsValue: Number(tpl.pointsValue ?? 0),
        });
        created++;
      } catch {
        // ALREADY_EXISTS → idempotent no-op (task already generated today).
      }
    }
  }

  return NextResponse.json({ ok: true, dayKey, scanned, created });
}

export async function GET(req: NextRequest) {
  return run(req);
}
export async function POST(req: NextRequest) {
  return run(req);
}
