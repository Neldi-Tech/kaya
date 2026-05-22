// Kaya Pulse · daily task generation (server-only, Admin SDK).
//
// Shared by the daily cron (/api/cron/pulse-generate) and the parent
// "generate now" route (/api/pulse/generate) so the rule lives in one place.
// Pure date logic + Admin SDK reads/writes only — no firebase CLIENT imports,
// so it's safe to import from any server route.
//
// Phase-1 timezone is Africa/Dar_es_Salaam. Per-family tz (from family.location)
// is a later refinement — keep PULSE_TZ in sync with the client (pulse/today).

import { dayKeyInTZ } from './dates';

export const PULSE_TZ = 'Africa/Dar_es_Salaam';
const PULSE_TZ_OFFSET = '+03:00'; // EAT, no DST — keep aligned with PULSE_TZ

export function todayKey(): string {
  return dayKeyInTZ(new Date(), PULSE_TZ);
}

function weekdayOf(dayKey: string): number {
  return new Date(`${dayKey}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
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

type TemplateData = {
  cadence?: string; cadenceN?: number; trackableId?: string; trackableSource?: string;
  ownerKind?: string; ownerType?: string; ownerId?: string;
  rotationCurrent?: string; rotationPool?: string[];
  pointsValue?: number; dueTimeLocal?: string;
};

/** Materialise today's tasks for ONE family from its active templates.
 *  Idempotent: deterministic task id (`templateId_dayKey`) + .create(). */
export async function generateForFamily(
  famRef: FirebaseFirestore.DocumentReference,
  dayKey: string,
): Promise<{ scanned: number; created: number }> {
  let scanned = 0;
  let created = 0;
  let tplSnap;
  try {
    tplSnap = await famRef.collection('pulseTemplates').where('active', '==', true).get();
  } catch {
    return { scanned, created };
  }
  for (const tplDoc of tplSnap.docs) {
    scanned++;
    const tpl = tplDoc.data() as TemplateData;
    if (!isDueToday(tpl, dayKey) || !tpl.trackableId) continue;
    const ownerId = tpl.ownerType === 'fixed' ? tpl.ownerId : tpl.rotationCurrent || tpl.rotationPool?.[0];
    if (!ownerId) continue;
    const dueTime = tpl.dueTimeLocal && /^\d{2}:\d{2}$/.test(tpl.dueTimeLocal) ? tpl.dueTimeLocal : '20:00';
    const dueAt = new Date(`${dayKey}T${dueTime}:00${PULSE_TZ_OFFSET}`);
    try {
      await famRef.collection('pulseTasks').doc(`${tplDoc.id}_${dayKey}`).create({
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
      // ALREADY_EXISTS → idempotent no-op (already generated today).
    }
  }
  return { scanned, created };
}

/** Materialise today's tasks for EVERY family (the daily cron path). */
export async function generateForAllFamilies(
  db: FirebaseFirestore.Firestore,
  dayKey: string,
): Promise<{ families: number; scanned: number; created: number }> {
  const families = await db.collection('families').get();
  let scanned = 0;
  let created = 0;
  for (const fam of families.docs) {
    const r = await generateForFamily(fam.ref, dayKey);
    scanned += r.scanned;
    created += r.created;
  }
  return { families: families.size, scanned, created };
}
