#!/usr/bin/env tsx
/**
 * scripts/import-bonus-awards.ts
 *
 * One-time importer for Elia's "ED House Point System" Google-Form Excel.
 * Reads Form 1 (335 bonus-award rows across ~6 months) and writes one
 * Kaya Award doc per row into /families/{familyId}/awards/, using the
 * tiered v2 schema (regular / diamond / reducing / kudos / improvement_note).
 *
 * MODES
 *   --dry-run (default) — Parse + map + replay thresholds in-memory and
 *                         print a sample + summary. NO Firestore I/O.
 *                         Safe to run repeatedly while tuning mappings.
 *   --commit            — Actually write to Firestore via firebase-admin.
 *                         Requires GOOGLE_APPLICATION_CREDENTIALS env var
 *                         pointing at a service-account JSON.
 *
 * IDEMPOTENCY
 *   Every written doc carries `importSource: 'excel-2026-05'`. To undo
 *   the entire import, delete docs in awards where importSource matches.
 *
 * USAGE
 *   FAMILY_ID=<your-family-doc-id> \
 *     ELIA_UID=<parent-1-uid> \
 *     DIANA_UID=<parent-2-uid> \
 *     npx tsx scripts/import-bonus-awards.ts \
 *     '<path-to-xlsx>' \
 *     --dry-run
 *
 *   # When dry-run output looks right, swap to --commit and add
 *   # GOOGLE_APPLICATION_CREDENTIALS (or run `gcloud auth
 *   # application-default login` for ADC).
 *   GOOGLE_APPLICATION_CREDENTIALS=~/path/to/service-account.json \
 *     FAMILY_ID=... ELIA_UID=... DIANA_UID=... \
 *     npx tsx scripts/import-bonus-awards.ts '<xlsx path>' --commit
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

// ── Config from env / CLI ──────────────────────────────────────────────
const FAMILY_ID = process.env.FAMILY_ID;
const ELIA_UID = process.env.ELIA_UID;
const DIANA_UID = process.env.DIANA_UID;
const IMPORT_SOURCE = 'excel-2026-05';

const args = process.argv.slice(2);
const xlsxPathArg = args.find((a) => !a.startsWith('--'));
const commitMode = args.includes('--commit');
const verbose = args.includes('--verbose');

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

// ── Awarder name → { uid, displayName } map ────────────────────────────
// Per Elia's #5 call: Mom→Diana, Dad→Elia, all kid-as-awarder + Auntie
// Getu→Diana. We preserve the source name in `awardedByName` so the
// timeline reads correctly even when the UID is collapsed.
const AWARDER_MAP: Record<string, { uid: string; displayName: string }> = {
  'Mom':         { uid: DIANA_UID, displayName: 'Diana' },
  'Dad':         { uid: ELIA_UID,  displayName: 'Elia' },
  'Diella':      { uid: DIANA_UID, displayName: 'Diella' },
  'Daniella':    { uid: DIANA_UID, displayName: 'Daniella' },
  'Auntie Getu': { uid: DIANA_UID, displayName: 'Auntie Getu' },
};

// ── Kid name resolution (Excel → Kaya child) ───────────────────────────
// Excel writes "Earlnathan (Golden)", "Diella (White)", "Daniella (Silver)".
// We map these to the child by stripping the house suffix and matching on
// child.name. Resolved childIds get filled in at runtime from Firestore
// (commit mode) or assumed-OK in dry-run.
const KID_NAME_RX = /^([A-Za-z'-]+)\s*\(/; // captures "Earlnathan" from "Earlnathan (Golden)"
function normalizeKidName(raw: string): string | null {
  if (!raw) return null;
  const m = raw.match(KID_NAME_RX);
  if (m) return m[1].trim();
  // Plain name (no house suffix) — accept as-is unless it's a known skip.
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === 'Test Kid' || trimmed === 'Other Kids') return null;
  return trimmed;
}

// ── Category mapping (Excel list-item → Kaya virtue category) ─────────
// Option (b) from the alignment: each row gets categorised by the
// list-item the awarder selected, not just by tier. Keyword matching
// over the lowered text — first hit wins. Unmatched rows fall back to
// 'other' (still imported, just with the generic category). The
// original list-item text is always preserved in the `reason` field so
// no information is lost.
// Order matters — first hit wins. We check responsibility BEFORE learning
// so phrases like "Getting ready on time" don't get dragged into learning
// by a stray substring. Single-word keys are substring-matched, so a key
// like "pray" catches "pray", "prayer", "praying" without extra entries.
// Avoid keys that prefix other common words (e.g. don't use "read" — it
// would false-match "ready"; use "reading" instead).
const CATEGORY_KEYWORDS: Array<{ category: string; words: string[] }> = [
  { category: 'responsibility', words: ['ready', 'on time', 'early', 'timely', 'punctual', 'maintain', 'preparation', 'listen', 'finishing food', 'finished food'] },
  { category: 'helping',        words: ['chore', 'clean', 'tidy', 'table', 'plate', 'dish', 'help', 'cook', 'tea ', ' tea', 'breakfast', 'serv', 'remove', 'utensil'] },
  { category: 'learning',       words: ['homework', 'reading', 'writing', 'study', 'book', 'project', 'presenting', 'presentation', 'question'] },
  { category: 'kindness',       words: ['kind', 'share', 'comfort', 'polite', 'thank', 'please', 'sorry', 'manner', 'pray', 'mass', 'church', 'communion', 'bible', 'gift'] },
  { category: 'bravery',        words: ['brave', 'scary', 'speak up', 'first time'] },
  { category: 'creativity',     words: ['draw', 'paint', 'creat', 'craft', 'imagin'] },
  { category: 'teamwork',       words: ['team', 'together', 'sibling'] },
];
function categorize(listItem: string): string {
  if (!listItem) return 'other';
  const lower = listItem.toLowerCase();
  for (const { category, words } of CATEGORY_KEYWORDS) {
    for (const w of words) if (lower.includes(w)) return category;
  }
  return 'other';
}

// ── Excel column constants ─────────────────────────────────────────────
// Column header strings match Form 1's row 1. Bilingual labels keep the
// emoji prefix — preserved verbatim from the source so xlsx header
// lookup hits cleanly. Update here if the source headers change.
const COL = {
  date: 'Date',
  timestamp: 'Timestamp',
  kidName: 'Kids Name',
  whatHappened: 'What happened?',
  awarder: 'Point rewarded by',
  description: 'Description of the point',
  goodChoice: '⭐ Good Choice List',
  superGoodChoice: '🌟 Super Good Choice List',
  littleSlip: '⚠️ Little Slip List',
  bigSlip: '🚫 Big Slip List',
  kudosList: '👍 Kudos (0) List',
  improvementList: '👉 Improvement Note List',
  diamondList: '💎 Diamond Bonus Points (+)',
  diamondPoints: '💎 Points Rewarded',
  mudList: '💩 Mud Points (–ve)',
  mudPoints: '💩 Mud Points Rewarded',
  rewardForOthers: '🔥  Reward Points (for Others)',
  point: 'Point',
} as const;

// ── Row → typed event ───────────────────────────────────────────────────
type AwardKind = 'regular' | 'diamond' | 'reducing' | 'kudos' | 'improvement_note';

interface MappedEvent {
  rowIndex: number;        // 1-based for human reference
  kidName: string;         // normalised, e.g. "Earlnathan"
  date: Date;              // event date (createdAt)
  kind: AwardKind;
  points: number;
  category: string;
  reason: string;
  awardedBy: string;
  awardedByName: string;
}

interface SkippedRow {
  rowIndex: number;
  reason: string;
  raw: Record<string, unknown>;
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function asNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial date — xlsx with cellDates:true usually converts
    // these, but guard anyway. Days since 1899-12-30.
    const ms = (v - 25569) * 86400 * 1000;
    return new Date(ms);
  }
  if (typeof v === 'string' && v) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function classifyEvent(row: Record<string, unknown>): { kind: AwardKind; points: number; listItem: string } | null {
  const what = asString(row[COL.whatHappened]);
  if (!what) return null;
  const lower = what.toLowerCase();

  // Order matters — match the more-specific markers before generic ones.
  if (lower.includes('super good choice')) {
    return { kind: 'regular', points: 2, listItem: asString(row[COL.superGoodChoice]) };
  }
  if (lower.includes('good choice')) {
    return { kind: 'regular', points: 1, listItem: asString(row[COL.goodChoice]) };
  }
  if (lower.includes('diamond')) {
    const pts = asNumber(row[COL.diamondPoints]) || asNumber(row[COL.point]) || 3;
    return { kind: 'diamond', points: Math.max(3, Math.round(pts)), listItem: asString(row[COL.diamondList]) };
  }
  if (lower.includes('big slip')) {
    return { kind: 'reducing', points: -2, listItem: asString(row[COL.bigSlip]) };
  }
  if (lower.includes('little slip')) {
    return { kind: 'reducing', points: -1, listItem: asString(row[COL.littleSlip]) };
  }
  if (lower.includes('mud')) {
    const mag = Math.abs(asNumber(row[COL.mudPoints]) || asNumber(row[COL.point]) || 1);
    return { kind: 'reducing', points: -Math.round(mag), listItem: asString(row[COL.mudList]) };
  }
  if (lower.includes('kudos')) {
    return { kind: 'kudos', points: 0, listItem: asString(row[COL.kudosList]) };
  }
  if (lower.includes('improvement')) {
    return { kind: 'improvement_note', points: 0, listItem: asString(row[COL.improvementList]) };
  }
  if (lower.includes('reward points')) {
    // Per Elia's call: "Reward for other kids" (3 rows) → import as a
    // regular award. Magnitude defaults to +1 if not specified.
    const pts = asNumber(row[COL.point]) || 1;
    return { kind: 'regular', points: Math.round(pts), listItem: asString(row[COL.rewardForOthers]) };
  }
  return null;
}

function parseRows(rows: Array<Record<string, unknown>>): { mapped: MappedEvent[]; skipped: SkippedRow[] } {
  const mapped: MappedEvent[] = [];
  const skipped: SkippedRow[] = [];

  rows.forEach((row, i) => {
    const rowIndex = i + 2; // header is row 1 in the spreadsheet
    const kidRaw = asString(row[COL.kidName]);
    const kidName = normalizeKidName(kidRaw);
    if (!kidName) {
      skipped.push({ rowIndex, reason: `kid name "${kidRaw}" not importable`, raw: { kid: kidRaw } });
      return;
    }

    // Prefer the event Date column; fall back to Timestamp (form submit
    // time) when Date is missing — happens ~3 times in our source where
    // the parent forgot to set the picker. Better than dropping the row.
    const date = asDate(row[COL.date]) ?? asDate(row[COL.timestamp]);
    if (!date) {
      skipped.push({ rowIndex, reason: 'missing/invalid date (and no Timestamp)', raw: { kid: kidRaw, date: row[COL.date] } });
      return;
    }

    const classified = classifyEvent(row);
    if (!classified) {
      skipped.push({ rowIndex, reason: `unknown "What happened?" value: "${asString(row[COL.whatHappened])}"`, raw: { kid: kidRaw } });
      return;
    }

    const awarderName = asString(row[COL.awarder]);
    const awarder = AWARDER_MAP[awarderName];
    if (!awarder) {
      skipped.push({ rowIndex, reason: `unknown awarder "${awarderName}"`, raw: { kid: kidRaw } });
      return;
    }

    const description = asString(row[COL.description]);
    // Build reason: prefer "list-item — description", fall back to whichever exists.
    const reason = [classified.listItem, description].filter((s) => s).join(' — ') || classified.listItem || description || '(no detail)';

    mapped.push({
      rowIndex,
      kidName,
      date,
      kind: classified.kind,
      points: classified.points,
      category: categorize(classified.listItem),
      reason,
      awardedBy: awarder.uid,
      awardedByName: awarder.displayName,
    });
  });

  return { mapped, skipped };
}

// ── Threshold replay ───────────────────────────────────────────────────
// Walks each kid's timeline chronologically and emits derived awards
// when kudos / improvement_note counters cross the family-configured
// threshold. The derived award is backdated to the source's date so the
// activity feed reads correctly. Returns the union of raw + derived
// events plus the final counter state per kid.
interface FinalAward extends MappedEvent {
  derivedFrom?: { kind: 'kudos' | 'improvement_note'; sourceRowIndex: number };
}

interface KidCounters {
  kidName: string;
  kudosCount: number;
  improvementNoteCount: number;
}

interface ReplayResult {
  awards: FinalAward[];
  counters: Map<string, KidCounters>;
}

interface PointSystemForReplay {
  kudosThreshold: number;
  kudosBonus: number;
  improvementThreshold: number;
  improvementDeduction: number;
  reducingEnabled: boolean;
}

const DEFAULT_REPLAY_CONFIG: PointSystemForReplay = {
  kudosThreshold: 4,
  kudosBonus: 1,
  improvementThreshold: 4,
  improvementDeduction: 1,
  reducingEnabled: false, // Phase-1 default; can be overridden once Elia turns Reducing on
};

function replayThresholds(events: MappedEvent[], cfg: PointSystemForReplay): ReplayResult {
  // Group by kid + sort by date asc.
  const byKid = new Map<string, MappedEvent[]>();
  for (const e of events) {
    if (!byKid.has(e.kidName)) byKid.set(e.kidName, []);
    byKid.get(e.kidName)!.push(e);
  }
  for (const arr of byKid.values()) arr.sort((a, b) => a.date.getTime() - b.date.getTime());

  const awards: FinalAward[] = [];
  const counters = new Map<string, KidCounters>();

  for (const [kidName, arr] of byKid) {
    let kudosCount = 0;
    let improvementCount = 0;
    for (const e of arr) {
      awards.push({ ...e });

      if (e.kind === 'kudos') {
        kudosCount += 1;
        if (kudosCount >= cfg.kudosThreshold) {
          awards.push({
            rowIndex: e.rowIndex,
            kidName,
            date: e.date,
            kind: 'regular',
            points: cfg.kudosBonus,
            category: 'other',
            reason: `Auto: ${cfg.kudosThreshold}× Kudos reached`,
            awardedBy: 'system',
            awardedByName: 'Kaya',
            derivedFrom: { kind: 'kudos', sourceRowIndex: e.rowIndex },
          });
          kudosCount -= cfg.kudosThreshold;
        }
      } else if (e.kind === 'improvement_note') {
        improvementCount += 1;
        if (improvementCount >= cfg.improvementThreshold) {
          if (cfg.reducingEnabled) {
            awards.push({
              rowIndex: e.rowIndex,
              kidName,
              date: e.date,
              kind: 'reducing',
              points: -cfg.improvementDeduction,
              category: 'other',
              reason: `Auto: ${cfg.improvementThreshold}× Improvement Note reached`,
              awardedBy: 'system',
              awardedByName: 'Kaya',
              derivedFrom: { kind: 'improvement_note', sourceRowIndex: e.rowIndex },
            });
          }
          improvementCount -= cfg.improvementThreshold;
        }
      }
    }
    counters.set(kidName, { kidName, kudosCount, improvementNoteCount: improvementCount });
  }

  // Re-sort overall so the printout reads chronologically.
  awards.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { awards, counters };
}

// ── Summary helpers ────────────────────────────────────────────────────
function summarize(awards: FinalAward[]): void {
  const byKid = new Map<string, { count: number; totalPts: number; byKind: Record<string, number> }>();
  for (const a of awards) {
    if (!byKid.has(a.kidName)) byKid.set(a.kidName, { count: 0, totalPts: 0, byKind: {} });
    const r = byKid.get(a.kidName)!;
    r.count += 1;
    r.totalPts += a.points;
    r.byKind[a.kind] = (r.byKind[a.kind] || 0) + 1;
  }

  console.log('\n── Per-kid summary ─────────────────────────────────────');
  for (const [kid, r] of byKid) {
    const kindBreakdown = Object.entries(r.byKind)
      .map(([k, n]) => `${k}=${n}`)
      .join(', ');
    console.log(`  ${kid.padEnd(12)}  ${String(r.count).padStart(3)} awards  ·  net points ${r.totalPts >= 0 ? '+' : ''}${r.totalPts}  ·  ${kindBreakdown}`);
  }
  console.log('────────────────────────────────────────────────────────');
}

function printSample(awards: FinalAward[], n = 10): void {
  console.log(`\n── Sample (first ${n} of ${awards.length}) ──`);
  for (const a of awards.slice(0, n)) {
    const dt = a.date.toISOString().slice(0, 10);
    const ptsLabel = a.kind === 'kudos' || a.kind === 'improvement_note'
      ? '(0)'
      : `${a.points >= 0 ? '+' : ''}${a.points}`;
    const derivedTag = a.derivedFrom ? ' [DERIVED]' : '';
    console.log(`  ${dt}  ${a.kidName.padEnd(10)}  ${a.kind.padEnd(17)}  ${ptsLabel.padStart(4)}  ${a.category.padEnd(15)}  by ${a.awardedByName.padEnd(11)}  — ${a.reason.slice(0, 80)}${derivedTag}`);
  }
}

// ── Main ───────────────────────────────────────────────────────────────
async function main() {
  console.log(`Reading: ${xlsxPath}`);
  const wb = XLSX.readFile(xlsxPath, { cellDates: true });
  const sheet = wb.Sheets['Form 1'];
  if (!sheet) {
    console.error('Sheet "Form 1" not found in workbook.');
    process.exit(1);
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
  console.log(`Read ${rows.length} rows from "Form 1".`);

  const { mapped, skipped } = parseRows(rows);
  console.log(`Mapped: ${mapped.length}  ·  Skipped: ${skipped.length}`);

  if (skipped.length > 0) {
    console.log('\n── Skipped rows ──');
    for (const s of skipped) console.log(`  row ${s.rowIndex}  · ${s.reason}`);
  }

  // For dry-run we use the *default* point-system config. When committing
  // we'll read the actual family pointSystem and pass it here so threshold
  // replay reflects whatever Elia configured.
  const { awards, counters } = replayThresholds(mapped, DEFAULT_REPLAY_CONFIG);
  console.log(`\nTotal awards after threshold replay: ${awards.length} (${awards.length - mapped.length} derived)`);

  printSample(awards, 15);
  summarize(awards);

  console.log('\n── Final counters (modulo) ──');
  for (const c of counters.values()) {
    console.log(`  ${c.kidName.padEnd(12)}  kudosCount=${c.kudosCount}  improvementNoteCount=${c.improvementNoteCount}`);
  }

  if (!commitMode) {
    console.log('\n[DRY-RUN] No Firestore writes performed. Re-run with --commit to apply.');
    return;
  }

  // ── Commit path ─────────────────────────────────────────────────────
  // Credential source — supports either:
  //   (a) GOOGLE_APPLICATION_CREDENTIALS pointing at a service-account JSON
  //   (b) gcloud Application Default Credentials (`gcloud auth application-default login`)
  // Both go through admin.credential.applicationDefault(). The project ID
  // is set explicitly so we don't depend on gcloud's default project.
  const projectId = process.env.FIREBASE_PROJECT_ID || 'kaya-app-b9463';
  const admin = await import('firebase-admin');
  if (admin.apps.length === 0) {
    try {
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
        projectId,
      });
    } catch (e) {
      console.error('\nCredential init failed. Try ONE of:');
      console.error('  · GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json');
      console.error('  · gcloud auth application-default login');
      console.error(`Error: ${(e as Error).message}`);
      process.exit(1);
    }
  }
  const db = admin.firestore();

  // Resolve kid names → child doc IDs. Excel uses first names only
  // ("Earlnathan") but the Firestore child docs may store full names
  // ("Earlnathan Irisha"). Index by both the full name and the first
  // token so either spelling lands on the same doc.
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
  console.log(`\nResolved ${childrenSnap.size} children in family ${FAMILY_ID} (indexed under ${childIdByName.size} name keys).`);
  for (const [name, id] of childIdByName) console.log(`  "${name}" → ${id}`);

  // Bail if any referenced kid isn't in Firestore.
  const missing = [...new Set(awards.map((a) => a.kidName))].filter((n) => !childIdByName.has(n));
  if (missing.length > 0) {
    console.error(`\nMissing child docs for: ${missing.join(', ')}. Create them in the app first.`);
    process.exit(1);
  }

  // Re-read family pointSystem to make threshold replay match what the
  // family is currently configured for. If they've turned Reducing on
  // since dry-run, the deductions will fire.
  const famSnap = await db.collection('families').doc(FAMILY_ID!).get();
  const stored = (famSnap.data() as any)?.pointSystem;
  const liveCfg: PointSystemForReplay = stored
    ? {
        kudosThreshold:        stored.kudos?.threshold ?? DEFAULT_REPLAY_CONFIG.kudosThreshold,
        kudosBonus:            stored.kudos?.bonusPoints ?? DEFAULT_REPLAY_CONFIG.kudosBonus,
        improvementThreshold:  stored.improvementNote?.threshold ?? DEFAULT_REPLAY_CONFIG.improvementThreshold,
        improvementDeduction:  stored.improvementNote?.deductionPoints ?? DEFAULT_REPLAY_CONFIG.improvementDeduction,
        reducingEnabled:       stored.reducing?.enabled ?? DEFAULT_REPLAY_CONFIG.reducingEnabled,
      }
    : DEFAULT_REPLAY_CONFIG;
  console.log('\nLive point-system config:', liveCfg);

  const finalReplay = replayThresholds(mapped, liveCfg);
  console.log(`Final awards to write: ${finalReplay.awards.length}`);

  // Idempotency check — bail if a prior import is already in place.
  const existing = await db
    .collection('families').doc(FAMILY_ID!)
    .collection('awards')
    .where('importSource', '==', IMPORT_SOURCE)
    .limit(1)
    .get();
  if (!existing.empty) {
    console.error(`\nAborted: at least one award already tagged importSource="${IMPORT_SOURCE}".`);
    console.error('Delete the prior batch first (query for that tag) or change IMPORT_SOURCE in this script.');
    process.exit(1);
  }

  // Compute child deltas to apply once at the end.
  const childDelta = new Map<string, { totalPointsDelta: number; weeklyPointsDelta: number; kudosCount: number; improvementNoteCount: number }>();
  for (const c of finalReplay.counters.values()) {
    childDelta.set(c.kidName, { totalPointsDelta: 0, weeklyPointsDelta: 0, kudosCount: c.kudosCount, improvementNoteCount: c.improvementNoteCount });
  }
  const now = new Date();
  const oneWeekAgo = new Date(now.getTime() - 7 * 86400_000);
  for (const a of finalReplay.awards) {
    const d = childDelta.get(a.kidName)!;
    d.totalPointsDelta += a.points;
    if (a.date >= oneWeekAgo) d.weeklyPointsDelta += a.points;
  }

  // Write in batches of 400 to stay well under Firestore's 500-op limit
  // (each award is one write; child updates added at the end).
  const BATCH = 400;
  let written = 0;
  for (let i = 0; i < finalReplay.awards.length; i += BATCH) {
    const batch = db.batch();
    const chunk = finalReplay.awards.slice(i, i + BATCH);
    for (const a of chunk) {
      const childId = childIdByName.get(a.kidName)!;
      const ref = db.collection('families').doc(FAMILY_ID!).collection('awards').doc();
      batch.set(ref, {
        childId,
        kind: a.kind,
        points: a.points,
        reason: a.reason,
        category: a.category,
        awardedBy: a.awardedBy,
        awardedByName: a.awardedByName,
        createdAt: admin.firestore.Timestamp.fromDate(a.date),
        importSource: IMPORT_SOURCE,
        ...(a.derivedFrom ? { derivedFrom: { kind: a.derivedFrom.kind, sourceAwardIds: [] } } : {}),
      });
    }
    await batch.commit();
    written += chunk.length;
    console.log(`  · wrote ${written}/${finalReplay.awards.length}`);
  }

  // Apply child running-total + counter deltas in a final batch.
  const tailBatch = db.batch();
  for (const [kidName, delta] of childDelta) {
    const childId = childIdByName.get(kidName)!;
    const childRef = db.collection('families').doc(FAMILY_ID!).collection('children').doc(childId);
    tailBatch.set(childRef, {
      totalPoints: admin.firestore.FieldValue.increment(delta.totalPointsDelta),
      ...(delta.weeklyPointsDelta !== 0 ? { weeklyPoints: admin.firestore.FieldValue.increment(delta.weeklyPointsDelta) } : {}),
      kudosCount: admin.firestore.FieldValue.increment(delta.kudosCount),
      improvementNoteCount: admin.firestore.FieldValue.increment(delta.improvementNoteCount),
    }, { merge: true });
  }
  await tailBatch.commit();
  console.log('  · updated child running totals + counters');

  console.log(`\n✅ Imported ${written} awards into family ${FAMILY_ID}.`);
  console.log(`   All tagged importSource="${IMPORT_SOURCE}" — query and delete to undo.`);
}

main().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});
