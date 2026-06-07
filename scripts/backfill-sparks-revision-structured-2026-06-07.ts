/* eslint-disable @typescript-eslint/no-explicit-any */
// Kaya Sparks · one-time backfill: re-score existing revisions for the
// Slice 7i structured AI breakdown (Section D of the 2026-06-07 design).
//
// Reads every family's `sparks_items` where area === 'revision' and
// `revision_data.ai_breakdown_structured` is missing. Re-fires Claude
// Sonnet vision against the same photo URLs with the new prompt +
// schema, then writes the `structured` field back onto the existing
// row. Old `ai_notes` blob stays as fallback — never deleted, never
// touched.
//
// Idempotent: skips rows that already have ai_breakdown_structured.
// Re-runnable: safe to invoke many times.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/kaya-sa.json \
//     ANTHROPIC_API_KEY=sk-… \
//     npx tsx scripts/backfill-sparks-revision-structured-2026-06-07.ts        # dry run
//   GOOGLE_APPLICATION_CREDENTIALS=~/.config/firebase/kaya-sa.json \
//     ANTHROPIC_API_KEY=sk-… \
//     npx tsx scripts/backfill-sparks-revision-structured-2026-06-07.ts --write
//
// Defaults to a dry run: lists what WOULD be backfilled but never
// writes. Pass --write to actually persist the updates.
//
// Optional flags:
//   --family <id>        only process this family
//   --limit  <n>         stop after N successful re-scores (sane cap)
//   --concurrency <n>    parallel re-scores (default 3)
//
// Cost note: ~$0.01-0.02 per revision (Sonnet vision · ~3000 tok in/out).
// At the current beta size (~7 rows in Elia's family) this is negligible.

import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';

// ──────────────────────────────────────────────────────────────────────
// Setup

const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? process.env.GOOGLE_APPLICATION_CREDENTIALS.replace(/^~/, homedir())
  : `${homedir()}/.config/firebase/kaya-sa.json`;
if (!existsSync(credsPath)) {
  console.error(`✗ Service account JSON not found at ${credsPath}.`);
  process.exit(1);
}
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('✗ ANTHROPIC_API_KEY env var not set.');
  process.exit(1);
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(JSON.parse(readFileSync(credsPath, 'utf8'))) });
}
const db = getFirestore();
const anthropic = new Anthropic({ apiKey });

// ──────────────────────────────────────────────────────────────────────
// Args

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt  = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
};

const DRY        = !flag('write');
const FAMILY     = opt('family');
const LIMIT      = Number(opt('limit') || 1000);
const CONC       = Math.max(1, Math.min(8, Number(opt('concurrency') || 3)));

// ──────────────────────────────────────────────────────────────────────
// Prompt + schema — duplicated from src/app/api/sparks/ai/revision-score/
// route.ts on purpose. This is a one-off backfill; coupling to the live
// API route would force an HTTP roundtrip and an auth dance for no gain.

const SYSTEM_ANSWERS = `You are the in-app AI tutor for Kaya Sparks Home Revisions. A child has just submitted 1-4 photos of COMPLETED homework. Identify the subject + grade level, then score the work AND produce a structured per-question breakdown.

Return JSON: {
  "mode":        "answers",
  "subject":     short subject name (e.g. "Math", "English", "Kiswahili", "Science", "Social Studies", "General Knowledge", "Other") — "General Knowledge" covers civics, current affairs, world facts, geography quizzes, and mixed-topic Q&A worksheets,
  "gradeLevel":  best-guess grade + level (e.g. "Grade 4", "Year 3", "Primary 5") — empty string if unreadable,
  "score":       0-100 overall percentage (round to int),
  "breakdown":   { "correct": int, "partial": int, "wrong": int }  — counts of distinct questions/items,
  "notes":       1-2 sentences for the child — kept short for chip rendering. Specific.,
  "parsedQuestions": [],
  "structured": {
    "coverage":   { "read": int, "total": int },
    "strengths":  [ "specific bullet 1", "specific bullet 2", ... ],
    "areas":      [ { "question_ref": "Q6c", "topic": "Fractions of amounts", "what_happened": "…", "tip": "…" } ],
    "qbq":        [ { "question_ref": "Q1", "topic": "Multiples of 6", "status": "correct" } ]
  }
}

Rules:
- COVERAGE IS NON-NEGOTIABLE: structured.qbq MUST contain one entry per question you visually identified. structured.coverage.read MUST equal qbq.length.
- areas covers ONLY wrong + partial. If everything is correct, areas is [].
- strengths are SPECIFIC: cite question refs or topics. Never write generic praise.
- Never invent questions that aren't on the page. If page numbering is unclear, fall back to Q1, Q2, Q3 in reading order.
- "partial" = right answer but missing working, OR mostly right with one slip.`;

const SCHEMA = {
  type: 'object',
  properties: {
    mode: { type: 'string', enum: ['answers', 'questions'] },
    subject: { type: 'string' },
    gradeLevel: { type: 'string' },
    score: { type: 'number' },
    breakdown: {
      type: 'object',
      properties: {
        correct: { type: 'number' },
        partial: { type: 'number' },
        wrong: { type: 'number' },
      },
      required: ['correct', 'partial', 'wrong'],
      additionalProperties: false,
    },
    notes: { type: 'string' },
    parsedQuestions: { type: 'array', items: { type: 'string' } },
    structured: {
      type: 'object',
      properties: {
        coverage: {
          type: 'object',
          properties: { read: { type: 'number' }, total: { type: 'number' } },
          required: ['read', 'total'],
          additionalProperties: false,
        },
        strengths: { type: 'array', items: { type: 'string' } },
        areas: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question_ref:  { type: 'string' },
              topic:         { type: 'string' },
              what_happened: { type: 'string' },
              tip:           { type: 'string' },
            },
            required: ['topic', 'what_happened'],
            additionalProperties: false,
          },
        },
        qbq: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              question_ref: { type: 'string' },
              topic:        { type: 'string' },
              status:       { type: 'string', enum: ['correct', 'partial', 'wrong'] },
            },
            required: ['question_ref', 'topic', 'status'],
            additionalProperties: false,
          },
        },
      },
      required: ['coverage', 'strengths', 'areas', 'qbq'],
      additionalProperties: false,
    },
  },
  required: ['mode', 'subject', 'gradeLevel', 'score', 'breakdown', 'notes', 'parsedQuestions'],
  additionalProperties: false,
} as const;

// ──────────────────────────────────────────────────────────────────────
// Photo fetcher

async function fetchImageAsBase64(url: string): Promise<{ base64: string; mediaType: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const ct = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    return { base64: buf.toString('base64'), mediaType: allowed.includes(ct) ? ct : 'image/jpeg' };
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────────────
// Score one row

interface RevisionStructured {
  coverage: { read: number; total: number };
  strengths: string[];
  areas: Array<{ question_ref?: string; topic: string; what_happened: string; tip?: string }>;
  qbq: Array<{ question_ref: string; topic: string; status: 'correct' | 'partial' | 'wrong' }>;
}

async function rescoreOne(item: { photo_urls?: string[]; kid_name?: string; subject?: string }): Promise<RevisionStructured | null> {
  const urls = (item.photo_urls ?? []).slice(0, 4);
  if (urls.length === 0) return null;
  const images = await Promise.all(urls.map(fetchImageAsBase64));
  const valid = images.filter((i): i is { base64: string; mediaType: string } => i !== null);
  if (valid.length === 0) return null;

  const userText = [
    `Kid: ${item.kid_name || 'the child'}`,
    `Subject (from family): ${item.subject || 'unknown — re-detect from the photo'}`,
    `${valid.length} photo(s) attached.`,
    `Upload mode: ANSWERS (completed work).`,
    'BACKFILL CONTEXT: this row was scored before structured output was wired. Produce the full structured breakdown now.',
  ].join('\n');

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 3000,
    system: [{ type: 'text', text: SYSTEM_ANSWERS, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: SCHEMA } } as any,
    messages: [{
      role: 'user',
      content: [
        ...valid.map((v) => ({
          type: 'image' as const,
          source: { type: 'base64' as const, media_type: v.mediaType as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif', data: v.base64 },
        })),
        { type: 'text' as const, text: userText },
      ],
    }],
  });

  const text = resp.content.find((b) => b.type === 'text');
  if (!text || text.type !== 'text') return null;
  let parsed: any;
  try { parsed = JSON.parse(text.text); } catch { return null; }
  const s = parsed?.structured;
  if (!s) return null;

  // Normalise — mirror the client safe-parse in lib/sparks/ai.ts.
  const out: RevisionStructured = {
    coverage: {
      read:  Number(s.coverage?.read  ?? 0),
      total: Number(s.coverage?.total ?? 0),
    },
    strengths: Array.isArray(s.strengths)
      ? s.strengths.filter((x: unknown): x is string => typeof x === 'string')
      : [],
    areas: Array.isArray(s.areas)
      ? s.areas
          .filter((a: any) => a && typeof a === 'object')
          .map((a: any) => ({
            ...(typeof a.question_ref === 'string' && a.question_ref.length > 0 ? { question_ref: a.question_ref } : {}),
            topic: String(a.topic ?? ''),
            what_happened: String(a.what_happened ?? ''),
            ...(typeof a.tip === 'string' && a.tip.length > 0 ? { tip: a.tip } : {}),
          }))
          .filter((a: any) => a.topic.length > 0 && a.what_happened.length > 0)
      : [],
    qbq: Array.isArray(s.qbq)
      ? s.qbq
          .filter((q: any) => q && typeof q === 'object')
          .map((q: any) => ({
            question_ref: String(q.question_ref ?? ''),
            topic: String(q.topic ?? ''),
            status: (q.status === 'correct' || q.status === 'partial' || q.status === 'wrong') ? q.status : 'partial' as 'correct' | 'partial' | 'wrong',
          }))
          .filter((q: any) => q.question_ref.length > 0)
      : [],
  };
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Walk Firestore

interface Job {
  familyId: string;
  itemId: string;
  ref: FirebaseFirestore.DocumentReference;
  data: any;
}

async function gather(): Promise<Job[]> {
  const out: Job[] = [];
  const familiesQuery = FAMILY
    ? [await db.collection('families').doc(FAMILY).get()]
    : (await db.collection('families').get()).docs;
  for (const famDoc of familiesQuery) {
    if (!famDoc.exists) continue;
    const itemsSnap = await db
      .collection(`families/${famDoc.id}/sparks_items`)
      .where('area', '==', 'revision')
      .get();
    for (const itemDoc of itemsSnap.docs) {
      const data = itemDoc.data();
      const rd = data.revision_data;
      if (!rd) continue;
      if ((rd.upload_mode ?? 'answers') !== 'answers') continue;
      if (rd.ai_breakdown_structured) continue;
      if (!Array.isArray(data.photo_urls) || data.photo_urls.length === 0) continue;
      out.push({ familyId: famDoc.id, itemId: itemDoc.id, ref: itemDoc.ref, data });
      if (out.length >= LIMIT) return out;
    }
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────
// Run

async function main() {
  console.log(`Kaya Sparks · structured backfill · ${DRY ? 'DRY RUN' : 'WRITE MODE'}`);
  console.log(`  family scope: ${FAMILY ?? 'all'}`);
  console.log(`  limit:        ${LIMIT}`);
  console.log(`  concurrency:  ${CONC}`);
  console.log('');

  const jobs = await gather();
  console.log(`Found ${jobs.length} revision(s) eligible for backfill.\n`);
  if (jobs.length === 0) return;

  let touched = 0, failed = 0;

  // Simple concurrency-N pool.
  let cursor = 0;
  async function worker(id: number) {
    while (cursor < jobs.length) {
      const job = jobs[cursor++];
      const tag = `[${id}] ${job.familyId}/${job.itemId}`;
      try {
        const subject = job.data.subject || job.data.revision_data?.subject || '';
        console.log(`${tag} re-scoring · subject=${subject || '(unknown)'}`);
        const structured = await rescoreOne({
          photo_urls: job.data.photo_urls,
          kid_name:   job.data.revision_data?.subject ? '' : '',  // re-detect; per-kid name lookup is optional for tone
          subject,
        });
        if (!structured) {
          console.log(`${tag}   ✗ no structured returned`);
          failed++;
          continue;
        }
        const totalQ = structured.qbq.length;
        const strengths = structured.strengths.length;
        const areas = structured.areas.length;
        console.log(`${tag}   ✓ ${totalQ} qbq · ${strengths} strengths · ${areas} areas`);
        if (!DRY) {
          await job.ref.update({
            'revision_data.ai_breakdown_structured': structured,
            updated_at: FieldValue.serverTimestamp(),
          });
        }
        touched++;
      } catch (e) {
        console.error(`${tag}   ✗ failed:`, e instanceof Error ? e.message : e);
        failed++;
      }
    }
  }
  await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i + 1)));

  console.log('');
  console.log(`${DRY ? 'WOULD WRITE' : 'WROTE'}: ${touched}`);
  console.log(`Failed:     ${failed}`);
  if (DRY) console.log('\nRe-run with --write to persist.');
}

main().catch((e) => { console.error(e); process.exit(1); });
