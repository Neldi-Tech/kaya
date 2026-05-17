#!/usr/bin/env tsx
/**
 * scripts/add-helper-fallback-2026-05-16-17.ts
 *
 * One-off: house helpers Jacky (2026-05-16 evening) and Mage (2026-05-17
 * morning) filled the old Google Form instead of using Kaya. This script
 * writes those 6 ratings (3 kids × 2 sessions) into Kaya using delta-aware
 * upsert semantics matching `importRating()` — so re-running is a no-op,
 * and if a parent already entered partial ratings for those slots, the
 * helper's spreadsheet data overwrites and the child totals adjust by
 * just the delta (no double-count).
 *
 * Data is hardcoded from spreadsheet rows 149 (evening) + 150 (morning)
 * of "ED House Point System (Responses) (3).xlsx". All 3 kids received
 * identical ratings per session.
 *
 * USAGE
 *   FAMILY_ID=... ELIA_UID=... DIANA_UID=... \
 *     GOOGLE_APPLICATION_CREDENTIALS=~/.../sa.json \
 *     npx tsx scripts/add-helper-fallback-2026-05-16-17.ts          # dry-run
 *     npx tsx scripts/add-helper-fallback-2026-05-16-17.ts --commit  # write
 */

import * as admin from 'firebase-admin';

const FAMILY_ID = process.env.FAMILY_ID;
const ELIA_UID = process.env.ELIA_UID;
const DIANA_UID = process.env.DIANA_UID;
const IMPORT_SOURCE = 'excel-form2-helper-fallback-2026-05';
const commitMode = process.argv.includes('--commit');

if (!FAMILY_ID || !ELIA_UID || !DIANA_UID) {
  console.error('Set FAMILY_ID, ELIA_UID, DIANA_UID env vars.');
  process.exit(1);
}

// ── Data ──────────────────────────────────────────────────────────────
type RatingValue = 'excellent' | 'good' | 'bad';
interface Entry {
  kidName: 'Earlnathan' | 'Diella' | 'Daniella';
  date: string;
  period: 'morning' | 'evening';
  ratedByName: string;
  ratings: Record<string, RatingValue>;
  totalPoints: number;
  comment?: string;
  // Synthetic createdAt — middle of the session window so the entry
  // sorts naturally in date-ordered queries.
  createdAt: Date;
}

// Evening 2026-05-16 (Jacky): 3 Good + 9 Excellent = 3·1 + 9·2 = 21 pts/kid
const EVENING_RATINGS: Record<string, RatingValue> = {
  homework:           'good',
  'playing-outside':  'excellent',
  reading:            'good',
  writing:            'good',
  'home-chores':      'excellent',
  'room-evening':     'excellent',
  dinner:             'excellent',
  'evening-prayer':   'excellent',
  'sleeping-time':    'excellent',
  tablets:            'excellent',
  slippers:           'excellent',
  'behavior-evening': 'excellent',
};

// Morning 2026-05-17 (Mage): 8 Excellent = 8·2 = 16 pts/kid
const MORNING_RATINGS: Record<string, RatingValue> = {
  bed:       'excellent',
  teeth:     'excellent',
  bath:      'excellent',
  timely:    'excellent',
  breakfast: 'excellent',
  room:      'excellent',
  prayer:    'excellent',
  behavior:  'excellent',
};

const KIDS = ['Earlnathan', 'Diella', 'Daniella'] as const;

const ENTRIES: Entry[] = [
  ...KIDS.map((k): Entry => ({
    kidName: k,
    date: '2026-05-16',
    period: 'evening',
    ratedByName: 'Jacky',
    ratings: EVENING_RATINGS,
    totalPoints: 21,
    comment: 'Anafanya vizuri',
    createdAt: new Date('2026-05-16T20:25:00+03:00'), // matches spreadsheet timestamp
  })),
  ...KIDS.map((k): Entry => ({
    kidName: k,
    date: '2026-05-17',
    period: 'morning',
    ratedByName: 'Mage',
    ratings: MORNING_RATINGS,
    totalPoints: 16,
    comment: 'Anafanya vizuri',
    createdAt: new Date('2026-05-17T11:39:00+03:00'), // matches spreadsheet timestamp
  })),
];

// ── Helpers ───────────────────────────────────────────────────────────
function isInCurrentWeek(dateStr: string): boolean {
  // Mirrors firestore.ts:isInCurrentWeek — Monday-start ISO week, local TZ.
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  const startOfWeek = (x: Date) => {
    const c = new Date(x);
    const dow = (c.getDay() + 6) % 7;
    c.setHours(0, 0, 0, 0);
    c.setDate(c.getDate() - dow);
    return c;
  };
  return startOfWeek(d).getTime() === startOfWeek(today).getTime();
}

// ── Main ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`Mode: ${commitMode ? 'COMMIT' : 'DRY-RUN'}`);
  console.log(`Family: ${FAMILY_ID}`);
  console.log(`Entries to process: ${ENTRIES.length}\n`);

  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId: process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463',
      });
    } catch (e) {
      console.error('Credential init failed. Set GOOGLE_APPLICATION_CREDENTIALS or run `gcloud auth application-default login`.');
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  const db = admin.firestore();

  // Resolve kid name → child doc ID (with first-name fallback).
  const childrenSnap = await db.collection('families').doc(FAMILY_ID!).collection('children').get();
  const childIdByName = new Map<string, string>();
  childrenSnap.forEach((d) => {
    const data = d.data() as { name?: string };
    if (!data.name) return;
    childIdByName.set(data.name, d.id);
    const first = data.name.split(/\s+/)[0];
    if (first && first !== data.name && !childIdByName.has(first)) {
      childIdByName.set(first, d.id);
    }
  });
  for (const e of ENTRIES) {
    if (!childIdByName.has(e.kidName)) {
      console.error(`No child found for "${e.kidName}". Available: ${[...childIdByName.keys()].join(', ')}`);
      process.exit(1);
    }
  }

  // Read pointsPerHousePoint from live config.
  const famSnap = await db.collection('families').doc(FAMILY_ID!).get();
  const famData = famSnap.data() as any;
  const ppHP = Math.max(1, famData?.pointSystem?.routines?.pointsPerHousePoint ?? 100);
  console.log(`Live pointsPerHousePoint = ${ppHP}\n`);

  // Process each entry: query existing → compute delta → upsert → apply child delta.
  // Mirrors importRating() in src/lib/firestore.ts.
  const summary: Array<{ kid: string; action: string; delta: number; hpGained: number }> = [];

  for (const e of ENTRIES) {
    const childId = childIdByName.get(e.kidName)!;
    // Helpers Mage + Jacky map to Diana's UID per Phase 3 convention.
    const awarderUid = DIANA_UID!;

    const childRef = db.collection('families').doc(FAMILY_ID!).collection('children').doc(childId);
    const ratingsRef = db.collection('families').doc(FAMILY_ID!).collection('ratings');

    const existingQ = await ratingsRef
      .where('childId', '==', childId)
      .where('date', '==', e.date)
      .where('period', '==', e.period)
      .limit(1).get();
    const prior = existingQ.empty ? null : existingQ.docs[0];
    const priorPoints = prior ? (prior.data().totalPoints as number) || 0 : 0;
    const delta = e.totalPoints - priorPoints;
    const action = prior ? 'replace' : 'create';

    const childSnap = await childRef.get();
    const child = (childSnap.data() || {}) as { routinePoints?: number; totalPoints?: number; weeklyPoints?: number };
    const currentRP = child.routinePoints || 0;
    const nextRP = currentRP + delta;
    const hpGained = Math.floor(nextRP / ppHP) - Math.floor(currentRP / ppHP);

    console.log(`  · ${e.kidName.padEnd(12)} ${e.date} ${e.period.padEnd(7)}  pts=${e.totalPoints} prior=${priorPoints} Δ=${delta>=0?'+':''}${delta}  → ${action}${hpGained !== 0 ? `  (+${hpGained} HP)` : ''}`);

    summary.push({ kid: e.kidName, action, delta, hpGained });

    if (!commitMode) continue;

    // Build the rating doc payload.
    const payload: Record<string, unknown> = {
      childId,
      date: e.date,
      period: e.period,
      ratings: e.ratings,
      totalPoints: e.totalPoints,
      ratedBy: awarderUid,
      ratedByName: e.ratedByName,
      createdAt: admin.firestore.Timestamp.fromDate(e.createdAt),
      importSource: IMPORT_SOURCE,
    };
    if (e.comment) payload.comment = e.comment;

    if (prior) {
      await prior.ref.set(payload, { merge: false });
    } else {
      await ratingsRef.add(payload);
    }

    // Apply the delta through the routine-points accumulator. Skip if zero.
    if (delta !== 0) {
      const carryover = nextRP - Math.floor(nextRP / ppHP) * ppHP;
      const updates: Record<string, unknown> = { routinePoints: carryover };
      if (hpGained !== 0) {
        updates.totalPoints = (child.totalPoints || 0) + hpGained;
        if (isInCurrentWeek(e.date)) {
          updates.weeklyPoints = (child.weeklyPoints || 0) + hpGained;
        }
      }
      await childRef.update(updates);
    }
  }

  // Per-kid summary.
  const byKid = new Map<string, { entries: number; deltaSum: number; hpSum: number }>();
  for (const s of summary) {
    if (!byKid.has(s.kid)) byKid.set(s.kid, { entries: 0, deltaSum: 0, hpSum: 0 });
    const r = byKid.get(s.kid)!;
    r.entries += 1;
    r.deltaSum += s.delta;
    r.hpSum += s.hpGained;
  }
  console.log('\n── Summary ──────────────────────────────────────────');
  for (const [kid, r] of byKid) {
    console.log(`  ${kid.padEnd(12)}  ${r.entries} entries  ·  +${r.deltaSum} routine pts  ·  +${r.hpSum} HP`);
  }
  console.log('─────────────────────────────────────────────────────');

  if (!commitMode) {
    console.log('\n[DRY-RUN] No writes. Re-run with --commit to apply.');
  } else {
    console.log(`\n✅ Done. Tagged importSource="${IMPORT_SOURCE}". Query+delete to undo.`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
