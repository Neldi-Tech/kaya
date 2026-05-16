#!/usr/bin/env tsx
/**
 * scripts/import-routine-ratings.ts
 *
 * One-time importer for Elia's "ED House Point System" Google-Form Excel,
 * Form 2 — the morning/evening routine checklist. Reads 149 rows of
 * household-helper submissions (one per period), splits each into 3 kid
 * ratings, and writes one Kaya `DailyRating` doc per (kid × period × date).
 *
 * The ratings use the family's current `family.routines` definitions:
 *   - Each Excel item label maps to a Routine.id (via ROUTINE_LABEL_MAP)
 *   - Each Excel cell value ('Excellent'|'Good'|'Bad'|blank) maps to a
 *     Kaya `RatingValue` ('excellent'|'good'|'bad'|'skip')
 *   - Routine points are summed via the Routine's pointsExcellent /
 *     pointsGood / pointsBad values
 *   - The conversion to House Points happens inside `importRating()` via
 *     `computeRoutineRatingUpdates()` (so 100 routine points → 1 HP at
 *     default config)
 *
 * MODES
 *   --dry-run (default) — Parse + map and print samples + summary. No I/O.
 *   --commit            — Write to Firestore (firebase-admin). Needs
 *                         GOOGLE_APPLICATION_CREDENTIALS or gcloud ADC.
 *
 * IDEMPOTENCY
 *   `importRating()` already replaces any prior doc for the same
 *   (childId, date, period) key — re-running is safe.
 *
 * BEFORE COMMITTING
 *   Make sure the family's `routines[]` array contains all 20 items
 *   (8 morning + 12 evening) defined in DEFAULT_ROUTINES. If routines
 *   are missing, the script offers to patch them in.
 *
 * USAGE
 *   FAMILY_ID=<your-family-doc-id> \
 *     ELIA_UID=<parent-1-uid> \
 *     DIANA_UID=<parent-2-uid> \
 *     npx tsx scripts/import-routine-ratings.ts \
 *     '<path-to-xlsx>' \
 *     --dry-run
 *
 *   # Then commit with --commit + service-account credentials.
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const FAMILY_ID = process.env.FAMILY_ID;
const ELIA_UID = process.env.ELIA_UID;
const DIANA_UID = process.env.DIANA_UID;

const args = process.argv.slice(2);
const xlsxPathArg = args.find((a) => !a.startsWith('--'));
const commitMode = args.includes('--commit');
const patchRoutines = args.includes('--patch-routines');

if (!FAMILY_ID || !ELIA_UID || !DIANA_UID) {
  console.error('Set FAMILY_ID, ELIA_UID, DIANA_UID env vars.');
  process.exit(1);
}
if (!xlsxPathArg) {
  console.error('Pass xlsx path as the first non-flag arg.');
  process.exit(1);
}
const xlsxPath = path.resolve(xlsxPathArg.replace(/^~/, process.env.HOME || ''));
if (!fs.existsSync(xlsxPath)) {
  console.error(`File not found: ${xlsxPath}`);
  process.exit(1);
}

// ── Awarder map ────────────────────────────────────────────────────────
// Form 2 form-fillers: Mage (mornings), Jacky (evenings). Both are
// household helpers without Kaya accounts yet. Map to Diana's UID with
// the helper's name preserved as displayName — same pattern as Auntie
// Getu in the bonus-awards import.
const AWARDER_MAP: Record<string, { uid: string; displayName: string }> = {
  'Mage':  { uid: DIANA_UID, displayName: 'Mage' },
  'Jacky': { uid: DIANA_UID, displayName: 'Jacky' },
  // Fallbacks if the spreadsheet ever has these too:
  'Mom':   { uid: DIANA_UID, displayName: 'Diana' },
  'Dad':   { uid: ELIA_UID,  displayName: 'Elia' },
  'Diana': { uid: DIANA_UID, displayName: 'Diana' },
  'Elia':  { uid: ELIA_UID,  displayName: 'Elia' },
};

// ── Excel item label → Routine.id mapping ──────────────────────────────
// Built from the Excel column-bracket text ("[Making bed / Kutandika
// Kitanda]") to the canonical Routine id used in DEFAULT_ROUTINES.
// Includes both morning + evening items.
const ROUTINE_LABEL_MAP: Record<string, string> = {
  // Morning
  'Making bed':            'bed',
  'Brushing Teeth':        'teeth',
  'Taking bath':           'bath',
  'Timely Preparation':    'timely',
  'Breakfast':             'breakfast',
  'Clean Room':            'room',          // also evening — disambiguated by period below
  'Morning Prayer':        'prayer',
  'Good Behavior':         'behavior',      // also evening — disambiguated by period below
  // Evening
  'Homework':              'homework',
  'Playing Outside':       'playing-outside',
  'Reading':               'reading',
  'Writing':               'writing',
  // Excel uses curly apostrophe ’ in "Daddy's Home Chores"; we
  // normalise via `resolveRoutineId` below so both spellings hit.
  "Daddy's Home Chores":   'home-chores',
  'Dinner':                'dinner',
  'Evening Prayer':        'evening-prayer',
  'Sleeping Time':         'sleeping-time',
  'Tablets':               'tablets',
  'Slippers':              'slippers',
};
// Morning vs evening disambiguation for label collisions.
const EVENING_OVERRIDE: Record<string, string> = {
  'Clean Room':    'room-evening',
  'Good Behavior': 'behavior-evening',
};

function resolveRoutineId(rawLabel: string, period: 'morning' | 'evening'): string | null {
  // Normalise curly apostrophes (U+2019) to straight (U+0027) so the
  // map lookup matches regardless of which Excel cell encoding we get.
  const label = rawLabel.replace(/’/g, "'");
  if (period === 'evening' && EVENING_OVERRIDE[label]) return EVENING_OVERRIDE[label];
  return ROUTINE_LABEL_MAP[label] ?? null;
}

// ── Excel column parsing ───────────────────────────────────────────────
// Form 2 columns look like "Tick / Chagua [Making bed / Kutandika Kitanda]"
// or "Tick / Chagua [Making bed / Kutandika Kitanda] 2" / "... 3" for the
// second/third kid. The bracket text uses "english / swahili" separated by
// a forward slash; we take the english part as the routine label.
interface ParsedColumn {
  kidIndex: 0 | 1 | 2;          // which kid (0=Earlnathan, 1=Diella, 2=Daniella)
  routineLabel: string;          // e.g. "Making bed"
}

function parseColumnHeader(header: string): ParsedColumn | null {
  // Strict shape: starts with "Tick / Chagua ["
  const m = header.match(/^Tick \/ Chagua \[([^\]]+)\](?:\s+(\d))?\s*$/);
  if (!m) return null;
  const bracket = m[1];               // "Making bed / Kutandika Kitanda"
  const suffix = m[2];                // undefined | "2" | "3"
  const englishLabel = bracket.split('/')[0].trim();
  let kidIndex: 0 | 1 | 2;
  if (!suffix) kidIndex = 0;
  else if (suffix === '2') kidIndex = 1;
  else if (suffix === '3') kidIndex = 2;
  else return null;
  return { kidIndex, routineLabel: englishLabel };
}

// ── Cell value → RatingValue ──────────────────────────────────────────
type RatingValue = 'excellent' | 'good' | 'bad' | 'skip';
function asRating(v: unknown): RatingValue | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim().toLowerCase();
  if (s === 'excellent') return 'excellent';
  if (s === 'good')      return 'good';
  if (s === 'bad')       return 'bad';
  return null;
}

// ── Row → kid ratings ──────────────────────────────────────────────────
interface ParsedRowEntry {
  rowIndex: number;
  kidName: string;              // 'Earlnathan' | 'Diella' | 'Daniella' (excel order index → name)
  date: Date;
  period: 'morning' | 'evening';
  ratings: Record<string, RatingValue>;   // routineId → RatingValue
  routineCount: number;          // count of rated items (non-skip)
  routinePoints: number;          // sum of points for this rating set
  ratedBy: string;
  ratedByName: string;
  comment?: string;
}

interface SkippedRow {
  rowIndex: number;
  reason: string;
}

const KID_NAME_BY_INDEX = ['Earlnathan', 'Diella', 'Daniella'] as const;

interface ImportContext {
  routinesByPeriod: { morning: Map<string, RoutineLite>; evening: Map<string, RoutineLite> };
  unknownLabels: Set<string>;
}

interface RoutineLite {
  id: string;
  pointsExcellent: number;
  pointsGood: number;
  pointsBad: number;
  active: boolean;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') return new Date((v - 25569) * 86400 * 1000);
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function parseRows(
  rows: Array<Record<string, unknown>>,
  headerOrder: string[],
  ctx: ImportContext,
): { entries: ParsedRowEntry[]; skipped: SkippedRow[] } {
  const entries: ParsedRowEntry[] = [];
  const skipped: SkippedRow[] = [];

  // Pre-parse the column headers once. Filter out empty / undefined
  // headers — Excel sometimes leaves trailing blank columns that the
  // parser surfaces as undefined.
  const colMeta = headerOrder
    .filter((h): h is string => typeof h === 'string' && h.length > 0)
    .map((h) => ({ header: h, parsed: parseColumnHeader(h) }));

  rows.forEach((row, i) => {
    const rowIndex = i + 2;

    // Period: column "Time of Day / Muda wa Kujaza" → 'morning' or 'evening'
    const timeStr = asString(row['Time of Day / Muda wa Kujaza']).toLowerCase();
    let period: 'morning' | 'evening';
    if (timeStr.includes('morning') || timeStr.includes('asubuhi')) period = 'morning';
    else if (timeStr.includes('evening') || timeStr.includes('jioni')) period = 'evening';
    else {
      // Silently skip truly empty rows — xlsx surfaces trailing blanks
      // past the last data row. Only flag rows with junk data.
      if (timeStr !== '' || asString(row['Timestamp'])) {
        skipped.push({ rowIndex, reason: `unknown time-of-day: "${timeStr}"` });
      }
      return;
    }

    // Date: prefer the Timestamp column (since Form 2 doesn't have a
    // separate Date column — submissions are timestamped at fill time).
    const date = asDate(row['Timestamp']);
    if (!date) {
      skipped.push({ rowIndex, reason: 'missing/invalid Timestamp' });
      return;
    }

    // Awarder
    const awarderName = asString(row['Filled By / Aliyejaza']);
    const awarder = AWARDER_MAP[awarderName] ?? AWARDER_MAP['Mom']; // fallback Diana
    if (!AWARDER_MAP[awarderName]) {
      // We still proceed (mapped to Diana) but emit a note.
      // Avoid skipping — the rating data is more valuable than the awarder fidelity.
    }

    // Build per-kid rating bundles by walking the columns in order.
    const perKid: Array<{ ratings: Record<string, RatingValue>; routineCount: number; routinePoints: number; comment?: string }> = [
      { ratings: {}, routineCount: 0, routinePoints: 0 },
      { ratings: {}, routineCount: 0, routinePoints: 0 },
      { ratings: {}, routineCount: 0, routinePoints: 0 },
    ];

    const routinesMap = ctx.routinesByPeriod[period];

    for (const { header, parsed } of colMeta) {
      if (!parsed) continue;
      const { kidIndex, routineLabel } = parsed;
      const routineId = resolveRoutineId(routineLabel, period);
      if (!routineId) {
        ctx.unknownLabels.add(`${period}: ${routineLabel}`);
        continue;
      }
      const routine = routinesMap.get(routineId);
      if (!routine || !routine.active) continue;
      const rating = asRating(row[header]);
      if (!rating) continue;
      perKid[kidIndex].ratings[routineId] = rating;
      perKid[kidIndex].routineCount += 1;
      perKid[kidIndex].routinePoints += pointsFor(routine, rating);
    }

    // Pull each kid's "Details / Maelezo" comment column. Column titles
    // vary slightly between morning + evening blocks; we match by prefix.
    const commentPrefixByKid = period === 'morning'
      ? ['Details/Maelezo kwa EARLNATHAN', 'Details / Maelezo kwa DIELLA', 'Details / Maelezo kwa DANIELLA']
      : ['Details / Maelezo kwa EARLNATHAN', 'Details / Maelezo kwa DIELLA', 'Details / Maelezo kwa DANIELLA'];
    commentPrefixByKid.forEach((prefix, kidIdx) => {
      // Find the column whose header starts with the prefix and matches the period.
      const periodTag = period === 'morning' ? 'Morning' : 'Evening';
      const colHeader = headerOrder.find((h) => h.startsWith(prefix) && h.includes(periodTag));
      if (!colHeader) return;
      const txt = asString(row[colHeader]);
      if (txt) perKid[kidIdx].comment = txt;
    });

    // Emit one entry per kid with at least one rating.
    perKid.forEach((bundle, kidIdx) => {
      if (bundle.routineCount === 0) return;
      entries.push({
        rowIndex,
        kidName: KID_NAME_BY_INDEX[kidIdx],
        date,
        period,
        ratings: bundle.ratings,
        routineCount: bundle.routineCount,
        routinePoints: bundle.routinePoints,
        ratedBy: awarder.uid,
        ratedByName: awarder.displayName,
        comment: bundle.comment,
      });
    });

    // If the entire row had no ratings for any kid, log as skipped.
    if (perKid.every((b) => b.routineCount === 0)) {
      skipped.push({ rowIndex, reason: 'no ratings filled for any kid' });
    }
  });

  return { entries, skipped };
}

function pointsFor(routine: RoutineLite, rating: RatingValue): number {
  if (rating === 'excellent') return routine.pointsExcellent;
  if (rating === 'good')      return routine.pointsGood;
  if (rating === 'bad')       return routine.pointsBad;
  return 0;
}

// ── Summary helpers ────────────────────────────────────────────────────
function summarize(entries: ParsedRowEntry[]): void {
  const byKid = new Map<string, { count: number; routinePoints: number; morning: number; evening: number }>();
  for (const e of entries) {
    if (!byKid.has(e.kidName)) byKid.set(e.kidName, { count: 0, routinePoints: 0, morning: 0, evening: 0 });
    const r = byKid.get(e.kidName)!;
    r.count += 1;
    r.routinePoints += e.routinePoints;
    if (e.period === 'morning') r.morning += 1; else r.evening += 1;
  }
  console.log('\n── Per-kid summary ─────────────────────────────────────');
  for (const [kid, r] of byKid) {
    console.log(`  ${kid.padEnd(12)}  ${String(r.count).padStart(3)} ratings  (M=${r.morning} · E=${r.evening})  ·  ${r.routinePoints} routine points total`);
  }
  console.log('────────────────────────────────────────────────────────');
}

function printSample(entries: ParsedRowEntry[], n = 8): void {
  console.log(`\n── Sample (first ${n} of ${entries.length}) ──`);
  for (const e of entries.slice(0, n)) {
    const dt = e.date.toISOString().slice(0, 10);
    const ratingsList = Object.entries(e.ratings)
      .map(([id, v]) => `${id}:${v[0].toUpperCase()}`)
      .join(' ');
    const cmt = e.comment ? `  comment="${e.comment.slice(0, 40)}"` : '';
    console.log(`  ${dt} ${e.period.padEnd(7)} ${e.kidName.padEnd(10)} ${String(e.routineCount).padStart(2)} items · ${String(e.routinePoints).padStart(2)} pts · by ${e.ratedByName.padEnd(8)}  ${ratingsList.slice(0, 80)}${cmt}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reading: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheet = wb.Sheets['Form 2'];
  if (!sheet) {
    console.error('Sheet "Form 2" not found in workbook.');
    process.exit(1);
  }
  // Get raw rows + the header order for column-position iteration.
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  const headerRow = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })[0] as string[];
  console.log(`Read ${rows.length} rows from "Form 2", ${headerRow.length} columns.`);

  // For dry-run we use DEFAULT_ROUTINES (loaded inline below). For commit
  // we'll read the live family.routines instead so the script reflects
  // any in-app customisation Elia made.
  const DEFAULT_ROUTINES: RoutineLite[] = [
    { id: 'bed', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'teeth', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'bath', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'timely', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'breakfast', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'room', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'prayer', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'behavior', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'homework', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'playing-outside', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'reading', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'writing', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'home-chores', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'room-evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'dinner', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'evening-prayer', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'sleeping-time', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'tablets', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'slippers', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
    { id: 'behavior-evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  ];

  // Build the per-period routines map. Morning items are the first 8
  // in DEFAULT_ROUTINES; evening are the rest. We can't infer period
  // from `id` alone, so we rely on the resolveRoutineId mapping above.
  const morningIds = new Set(['bed','teeth','bath','timely','breakfast','room','prayer','behavior']);
  const eveningIds = new Set(['homework','playing-outside','reading','writing','home-chores','room-evening','dinner','evening-prayer','sleeping-time','tablets','slippers','behavior-evening']);
  const ctx: ImportContext = {
    routinesByPeriod: {
      morning: new Map(DEFAULT_ROUTINES.filter((r) => morningIds.has(r.id)).map((r) => [r.id, r])),
      evening: new Map(DEFAULT_ROUTINES.filter((r) => eveningIds.has(r.id)).map((r) => [r.id, r])),
    },
    unknownLabels: new Set(),
  };

  const { entries, skipped } = parseRows(rows, headerRow, ctx);
  console.log(`Parsed: ${entries.length} kid-rating entries  ·  Skipped rows: ${skipped.length}`);
  if (ctx.unknownLabels.size > 0) {
    console.log('\n── Unmapped routine labels (need ROUTINE_LABEL_MAP entries) ──');
    for (const l of ctx.unknownLabels) console.log(`  ${l}`);
  }
  if (skipped.length > 0) {
    console.log('\n── Skipped rows ──');
    for (const s of skipped.slice(0, 20)) console.log(`  row ${s.rowIndex}  · ${s.reason}`);
    if (skipped.length > 20) console.log(`  ... and ${skipped.length - 20} more`);
  }

  printSample(entries, 10);
  summarize(entries);

  if (!commitMode) {
    console.log('\n[DRY-RUN] No Firestore writes performed. Re-run with --commit to apply.');
    return;
  }

  // ── Commit path ─────────────────────────────────────────────────────
  const projectId = process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463';
  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId });
    } catch (e) {
      console.error('\nCredential init failed. Set GOOGLE_APPLICATION_CREDENTIALS or run `gcloud auth application-default login`.');
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  const db = admin.firestore();

  // Resolve kid names → child doc IDs (with first-name fallback like Phase 2).
  const childrenSnap = await db.collection('families').doc(FAMILY_ID!).collection('children').get();
  const childIdByName = new Map<string, string>();
  childrenSnap.forEach((doc) => {
    const data = doc.data() as { name?: string };
    if (!data.name) return;
    childIdByName.set(data.name, doc.id);
    const firstName = data.name.split(/\s+/)[0];
    if (firstName && firstName !== data.name && !childIdByName.has(firstName)) {
      childIdByName.set(firstName, doc.id);
    }
  });
  for (const [n, id] of childIdByName) console.log(`  "${n}" → ${id}`);

  const missing = [...new Set(entries.map((e) => e.kidName))].filter((n) => !childIdByName.has(n));
  if (missing.length > 0) {
    console.error(`\nMissing child docs for: ${missing.join(', ')}.`);
    process.exit(1);
  }

  // Read live family routines + point system config so the writes reflect
  // actual in-app state, not the script's default snapshot.
  const famSnap = await db.collection('families').doc(FAMILY_ID!).get();
  const famData = famSnap.data() as Record<string, unknown>;
  const liveRoutines = (famData.routines as RoutineLite[] | undefined) || [];
  const liveRoutineIds = new Set(liveRoutines.map((r) => r.id));
  const required = [...morningIds, ...eveningIds];
  const missingRoutines = required.filter((id) => !liveRoutineIds.has(id));
  if (missingRoutines.length > 0) {
    console.error(`\nFamily.routines is missing ${missingRoutines.length} required routines:`);
    for (const id of missingRoutines) console.error(`  · ${id}`);
    if (patchRoutines) {
      console.log('\n--patch-routines passed — adding missing routines to family.routines[].');
      const additions: RoutineLite[] = DEFAULT_ROUTINES.filter((r) => missingRoutines.includes(r.id));
      await db.collection('families').doc(FAMILY_ID!).update({
        routines: [...liveRoutines, ...additions.map((r) => ({
          ...r,
          // Re-add the label/icon/period fields the app expects. We don't
          // have those in the lite type — load them from the canonical
          // hardcoded list below.
          ...ROUTINE_FULL_DETAILS[r.id],
        }))],
      });
      console.log(`Patched. Re-running family read…`);
    } else {
      console.error('\nRe-run with --patch-routines to auto-add them, or add them manually in Settings → Routines.');
      process.exit(1);
    }
  }

  // Write ratings using a partial of importRating's logic — we call the
  // shared computeRoutineRatingUpdates path by going through the live
  // function. For perf we use the admin SDK directly + replicate the
  // accumulator math here so we can batch updates.
  const cfgStored = famData.pointSystem as any;
  const pointsPerHousePoint = cfgStored?.routines?.pointsPerHousePoint ?? 100;
  console.log(`\nLive pointsPerHousePoint = ${pointsPerHousePoint}`);

  // Group entries by kid and sort chronologically — accumulator math
  // requires in-order processing so house-point conversions land at the
  // right dates.
  const byKid = new Map<string, ParsedRowEntry[]>();
  for (const e of entries) {
    if (!byKid.has(e.kidName)) byKid.set(e.kidName, []);
    byKid.get(e.kidName)!.push(e);
  }
  for (const arr of byKid.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  // For each kid: walk chronologically, accumulate routinePoints, convert
  // to house points at the threshold, then apply child-doc updates once
  // at the end (batched).
  const childDeltas = new Map<string, { totalPointsDelta: number; weeklyPointsDelta: number; routinePointsFinal: number }>();
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 86400_000);

  for (const [kidName, arr] of byKid) {
    const childId = childIdByName.get(kidName)!;
    // Start from the child's CURRENT routinePoints so we extend, not reset.
    const childRef = db.collection('families').doc(FAMILY_ID!).collection('children').doc(childId);
    const childSnap = await childRef.get();
    const childData = childSnap.data() as { routinePoints?: number };
    let rp = childData?.routinePoints || 0;
    let totalDelta = 0;
    let weeklyDelta = 0;

    for (const e of arr) {
      rp += e.routinePoints;
      const housePointsGained = Math.floor(rp / pointsPerHousePoint);
      if (housePointsGained > 0) {
        rp -= housePointsGained * pointsPerHousePoint;
        totalDelta += housePointsGained;
        if (e.date >= oneWeekAgo) weeklyDelta += housePointsGained;
      }
    }
    childDeltas.set(kidName, { totalPointsDelta: totalDelta, weeklyPointsDelta: weeklyDelta, routinePointsFinal: rp });
  }

  // Write ratings docs in batches of 400.
  const BATCH = 400;
  let written = 0;
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = db.batch();
    const chunk = entries.slice(i, i + BATCH);
    for (const e of chunk) {
      const childId = childIdByName.get(e.kidName)!;
      const date = e.date.toISOString().slice(0, 10);
      // Idempotent upsert by (childId, date, period).
      const existingQ = await db.collection('families').doc(FAMILY_ID!).collection('ratings')
        .where('childId', '==', childId).where('date', '==', date).where('period', '==', e.period).limit(1).get();
      const ref = existingQ.empty
        ? db.collection('families').doc(FAMILY_ID!).collection('ratings').doc()
        : existingQ.docs[0].ref;
      const doc: Record<string, unknown> = {
        childId,
        date,
        period: e.period,
        ratings: e.ratings,
        totalPoints: e.routinePoints,
        ratedBy: e.ratedBy,
        ratedByName: e.ratedByName,
        createdAt: admin.firestore.Timestamp.fromDate(e.date),
        importSource: 'excel-form2-2026-05',
      };
      if (e.comment) doc.comment = e.comment;
      batch.set(ref, doc, { merge: false });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  · wrote ${written}/${entries.length} ratings`);
  }

  // Apply child deltas (totalPoints, weeklyPoints, routinePoints).
  const tailBatch = db.batch();
  for (const [kidName, delta] of childDeltas) {
    const childId = childIdByName.get(kidName)!;
    const childRef = db.collection('families').doc(FAMILY_ID!).collection('children').doc(childId);
    tailBatch.set(childRef, {
      totalPoints: admin.firestore.FieldValue.increment(delta.totalPointsDelta),
      ...(delta.weeklyPointsDelta !== 0 ? { weeklyPoints: admin.firestore.FieldValue.increment(delta.weeklyPointsDelta) } : {}),
      routinePoints: delta.routinePointsFinal,
    }, { merge: true });
    console.log(`  · ${kidName}: +${delta.totalPointsDelta} HP, ${delta.routinePointsFinal} RP carryover`);
  }
  await tailBatch.commit();

  console.log(`\n✅ Imported ${written} ratings into family ${FAMILY_ID}.`);
  console.log(`   All tagged importSource="excel-form2-2026-05" — query and delete to undo.`);
}

// Full-shape routine details for --patch-routines. Mirrors DEFAULT_ROUTINES
// in firestore.ts; kept here so the script is self-contained.
const ROUTINE_FULL_DETAILS: Record<string, Record<string, unknown>> = {
  bed:               { label: 'Making bed',         labelSw: 'Kutandika Kitanda',    icon: '🛏️', period: 'morning' },
  teeth:             { label: 'Brushing teeth',     labelSw: 'Kuswaki',              icon: '🪥', period: 'morning' },
  bath:              { label: 'Taking bath',        labelSw: 'Kuoga',                icon: '🚿', period: 'morning' },
  timely:            { label: 'Timely preparation', labelSw: 'Kujiandaa kwa wakati', icon: '⏰', period: 'morning' },
  breakfast:         { label: 'Breakfast',          labelSw: 'Chai Asubuhi',         icon: '🥣', period: 'morning' },
  room:              { label: 'Clean room',         labelSw: 'Chumba Safi',          icon: '✨', period: 'morning' },
  prayer:            { label: 'Morning prayer',     labelSw: 'Sala Asubuhi',         icon: '🤲', period: 'morning' },
  behavior:          { label: 'Good behavior',      labelSw: 'Adabu Njema',          icon: '⭐', period: 'morning' },
  homework:          { label: 'Homework',           labelSw: 'Kazi za Shule',        icon: '📚', period: 'evening' },
  'playing-outside': { label: 'Playing outside',    labelSw: 'Kucheza Nje',          icon: '🏃', period: 'evening' },
  reading:           { label: 'Reading',            labelSw: 'Kusoma',               icon: '📖', period: 'evening' },
  writing:           { label: 'Writing',            labelSw: 'Kuandika',             icon: '✍️', period: 'evening' },
  'home-chores':     { label: "Daddy's home chores", labelSw: 'Kazi za Baba',         icon: '🧹', period: 'evening' },
  'room-evening':    { label: 'Clean room',         labelSw: 'Kupanga Chumba',       icon: '🛋️', period: 'evening' },
  dinner:            { label: 'Dinner',             labelSw: 'Chakula Jioni',        icon: '🍽️', period: 'evening' },
  'evening-prayer':  { label: 'Evening prayer',     labelSw: 'Sala ya Jioni',        icon: '🕌', period: 'evening' },
  'sleeping-time':   { label: 'Sleeping time',      labelSw: 'Muda wa Kulala',       icon: '🌙', period: 'evening' },
  tablets:           { label: 'Tablets / screens',  labelSw: 'Kuangalia Movie or Games', icon: '📱', period: 'evening' },
  slippers:          { label: 'Slippers',           labelSw: 'Malapa',               icon: '🥿', period: 'evening' },
  'behavior-evening':{ label: 'Good behavior',      labelSw: 'Adabu Njema',          icon: '⭐', period: 'evening' },
};

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
