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

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

/** Resolve the owner's login uid (helper = the id itself; kid = the user whose
 *  childId matches) and drop a Pulse reminder into their feed + a push. Used by
 *  the generate cron (due) and the scan cron (missed). Best-effort — never throws. */
export async function notifyPulseOwner(
  famRef: FirebaseFirestore.DocumentReference,
  owner: { kind?: string; id: string },
  note: { type: string; title: string; message: string; link: string },
): Promise<void> {
  try {
    let uid: string | undefined;
    if (owner.kind === 'helper') {
      uid = owner.id;
    } else {
      const us = await famRef.firestore
        .collection('users')
        .where('familyId', '==', famRef.id)
        .where('childId', '==', owner.id)
        .get();
      uid = us.docs[0]?.id;
    }
    if (!uid) return; // kid with no login → nothing to notify
    await famRef.collection('notifications').add({
      type: note.type,
      title: note.title,
      message: note.message,
      read: false,
      forUserId: uid,
      link: note.link,
      createdAt: new Date(),
    });
    void fetch(`${APP_URL}/api/push`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ uid, title: note.title, body: note.message, url: note.link, tag: note.type }),
    }).catch(() => {});
  } catch {
    /* best-effort */
  }
}

/** Notify every PARENT in the family (feed + push). Used by the scan cron to
 *  flag missed readings so a parent can step in + log on the reader's behalf.
 *  Best-effort — never throws. */
export async function notifyFamilyParents(
  famRef: FirebaseFirestore.DocumentReference,
  note: { type: string; title: string; message: string; link: string },
): Promise<void> {
  try {
    // Single-field query (auto-indexed) + filter role in code → no composite index.
    const us = await famRef.firestore.collection('users').where('familyId', '==', famRef.id).get();
    const parents = us.docs.filter((d) => (d.data() as { role?: string }).role === 'parent');
    for (const p of parents) {
      await famRef.collection('notifications').add({
        type: note.type,
        title: note.title,
        message: note.message,
        read: false,
        forUserId: p.id,
        link: note.link,
        createdAt: new Date(),
      });
      void fetch(`${APP_URL}/api/push`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: p.id, title: note.title, body: note.message, url: note.link, tag: note.type }),
      }).catch(() => {});
    }
  } catch {
    /* best-effort */
  }
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
      await notifyPulseOwner(famRef, { kind: tpl.ownerKind, id: ownerId }, {
        type: 'pulse-reading-due',
        title: '📈 Reading to log',
        message: 'You have a meter reading to log today.',
        link: `/pulse/log/${tplDoc.id}_${dayKey}`,
      });
    } catch {
      // ALREADY_EXISTS → today's task is already there. Reconcile it to the
      // template's CURRENT reader so a reassignment actually takes effect: if
      // an OPEN task's owner drifted from the template (parent changed the
      // reader after generation), re-point + un-miss it so the new person can
      // still log. A logged/closed/review task is left alone (never disturb a
      // completed or in-approval reading). This is what makes "Update reader"
      // move today's task to whoever is now assigned.
      try {
        const taskRef = famRef.collection('pulseTasks').doc(`${tplDoc.id}_${dayKey}`);
        const existing = await taskRef.get();
        const d = existing.data() as { ownerId?: string; ownerKind?: string; status?: string } | undefined;
        if (d && (d.status === 'pending' || d.status === 'missed')) {
          const desiredKind = tpl.ownerKind ?? 'kid';
          const ownerChanged = d.ownerId !== ownerId || (d.ownerKind ?? 'kid') !== desiredKind;
          if (ownerChanged) {
            await taskRef.update({ ownerId, ownerKind: desiredKind, status: 'pending', missedAt: null });
            await notifyPulseOwner(famRef, { kind: desiredKind, id: ownerId }, {
              type: 'pulse-reading-due',
              title: '📈 Reading to log',
              message: 'A meter reading was assigned to you today.',
              link: `/pulse/log/${tplDoc.id}_${dayKey}`,
            });
          }
        }
      } catch {
        /* best-effort reconcile */
      }
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
