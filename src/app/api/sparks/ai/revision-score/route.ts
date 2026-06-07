// Sparks AI · revision scoring (server) — Claude Sonnet vision.
//
// Two modes (`mode` body param, default 'answers'):
//
//   'answers'   → kid uploaded COMPLETED work. Returns subject +
//                 gradeLevel + 0-100 score + breakdown + kid-readable
//                 notes.
//   'questions' → kid uploaded a worksheet of QUESTIONS (no answers
//                 yet). Returns subject + gradeLevel + parsed list of
//                 the questions on the page. No score (nothing to
//                 score against yet).
//
// Powers /sparks/[kidId]/revisions. Mirrors /api/sparks/ai/extract:
// cache_control: ephemeral on the system prompt, { skipped: true }
// when ANTHROPIC_API_KEY is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type Mode = 'answers' | 'questions';

interface ScoreBody {
  imageBase64s: string[];
  mediaType?: string;
  kidName: string;
  mode?: Mode;
  /** Optional hint — the focus subjects from sparks_profiles. */
  focusSubjects?: string[];
}

const SYSTEM_ANSWERS = `You are the in-app AI tutor for Kaya Sparks Home Revisions. A child has just submitted 1-4 photos of COMPLETED homework. Identify the subject + grade level, then score the work AND produce a structured per-question breakdown.

Return JSON: {
  "mode":        "answers",
  "subject":     short subject name (e.g. "Math", "English", "Kiswahili", "Science", "Social Studies", "General Knowledge", "Other") — "General Knowledge" covers civics, current affairs, world facts, geography quizzes, and mixed-topic Q&A worksheets,
  "gradeLevel":  best-guess grade + level (e.g. "Grade 4", "Year 3", "Primary 5") — empty string if unreadable,
  "score":       0-100 overall percentage (round to int),
  "breakdown":   { "correct": int, "partial": int, "wrong": int }  — counts of distinct questions/items,
  "notes":       1-2 sentences for the child — kept short for chip rendering. Specific. (Slice 7i: this remains as a fallback summary; the per-question detail lives in "structured".),
  "parsedQuestions": [],  // empty array in answers mode

  "structured": {
    "coverage":   { "read": int, "total": int },     // read = questions you analysed; total = questions visible on the page
    "strengths":  [ "specific bullet 1", "specific bullet 2", ... ],  // 2-5 SPECIFIC strengths (reference questions / topics, never generic)
    "areas":      [                                  // ONE entry per question that's WRONG or PARTIAL — empty array if all correct
      {
        "question_ref":  "Q6c",                      // page reference (e.g. "Q2", "Q19b") — empty string ONLY if the page has no numbering
        "topic":         "Fractions of amounts",     // 2-5 word topic
        "what_happened": "You wrote 15% — ½ of 30 is 15 (the answer is a number, not a percentage).",   // 1-2 sentences naming the slip
        "tip":           "Watch: the question asked for 'half of 30', not 'what percentage is half'."   // 1 line, concrete next move. omit if no specific tip applies.
      }
    ],
    "qbq":        [                                  // EVERY question on the page — include correct ones too. read MUST equal coverage.read.
      {
        "question_ref": "Q1",
        "topic":        "Multiples of 6",
        "status":       "correct"                    // "correct" | "partial" | "wrong"
      }
    ]
  }
}

Rules:
- Be conservative: if the page isn't completed homework, return subject="Other", score=0, empty counts, parsedQuestions=[], notes="Couldn't read this as completed homework — try a clearer photo, or switch to 'questions' mode if these are unsolved questions.", and structured with empty arrays + coverage {read:0, total:0}.
- Don't shame mistakes — phrase notes + areas constructively ("Most multiplication was solid; check the long-division remainder step.").
- "partial" = right answer but missing working, OR mostly right with one slip.
- COVERAGE IS NON-NEGOTIABLE: structured.qbq MUST contain one entry per question you visually identified. structured.coverage.read MUST equal qbq.length. Never silently skip questions — if you can't tell the status of a question, include it with status "partial" and note "couldn't read clearly" in areas.
- areas covers ONLY wrong + partial. If everything is correct, areas is [].
- strengths are SPECIFIC: cite question refs or topics ("3D shape edges Q8 — all 3 correct"). Never write "good work overall" / "shows promise" / similar fluff.
- Never invent questions that aren't on the page. If page numbering is unclear, fall back to Q1, Q2, Q3 in reading order.
- Use the child's first name at most once.`;

const SYSTEM_QUESTIONS = `You are the in-app AI tutor for Kaya Sparks Home Revisions. A child has just submitted 1-4 photos of a worksheet of QUESTIONS — these aren't solved yet. Read the page, identify the subject + grade level, and list the questions you can read.

Return JSON: {
  "mode":        "questions",
  "subject":     short subject name (e.g. "Math", "English", "Kiswahili", "Science", "Social Studies", "General Knowledge", "Other") — "General Knowledge" covers civics, current affairs, world facts, geography quizzes, and mixed-topic Q&A worksheets,
  "gradeLevel":  best-guess grade + level (e.g. "Grade 4") — empty string if unreadable,
  "score":       0,                              // no score in questions mode
  "breakdown":   { "correct": 0, "partial": 0, "wrong": 0 },
  "notes":       1-2 sentences for the child: a friendly intro to the worksheet ("Looks like 5 long-division questions, Earlnathan — give them a go and re-snap when you're done."),
  "parsedQuestions": [ "Q1 text…", "Q2 text…", …]  // the questions you can read from the page
}

Rules:
- Read each printed question and copy it verbatim into parsedQuestions (lightly clean spacing, but don't paraphrase).
- Up to 12 questions; if there are more, return the first 12.
- If the page isn't a question worksheet, return subject="Other", parsedQuestions=[], notes pointing the kid to a clearer photo.
- Never invent questions that aren't on the page.`;

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
    // Slice 7i · structured per-question breakdown. The schema enforces
    // shape; the prompt enforces that qbq covers EVERY question on the
    // page (no silent skips). Optional in the schema for back-compat
    // with the questions-mode prompt where it's unused — server-side
    // logic populates an empty object there.
    structured: {
      type: 'object',
      properties: {
        coverage: {
          type: 'object',
          properties: {
            read:  { type: 'number' },
            total: { type: 'number' },
          },
          required: ['read', 'total'],
          additionalProperties: false,
        },
        strengths: {
          type: 'array',
          items: { type: 'string' },
        },
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

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: ScoreBody;
  try {
    body = (await req.json()) as ScoreBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const images = (body?.imageBase64s ?? []).filter((s) => typeof s === 'string' && s.length > 0).slice(0, 4);
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const kidName = (body?.kidName || '').trim().slice(0, 60) || 'the child';
  const focus = (body?.focusSubjects ?? []).slice(0, 8).join(', ');
  const mode: Mode = body?.mode === 'questions' ? 'questions' : 'answers';

  if (images.length === 0) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 });
  }

  const userContext = [
    `Kid: ${kidName}`,
    focus ? `Family is focusing on: ${focus}` : '',
    `${images.length} photo(s) attached.`,
    `Upload mode: ${mode === 'questions' ? 'QUESTIONS (worksheet to practice from)' : 'ANSWERS (completed work)'}`,
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      // Slice 7i bumped from 1200 → 3000 for answers mode to fit the new
      // structured qbq array (up to ~25 questions × ~80 tokens each).
      max_tokens: mode === 'questions' ? 1800 : 3000,
      system: [{
        type: 'text',
        text: mode === 'questions' ? SYSTEM_QUESTIONS : SYSTEM_ANSWERS,
        cache_control: { type: 'ephemeral' },
      }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((data) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: mediaType, data },
            })),
            { type: 'text' as const, text: userContext },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({
        mode, subject: 'Other', gradeLevel: '',
        score: 0,
        breakdown: { correct: 0, partial: 0, wrong: 0 },
        notes: "Couldn't parse this page — try a clearer photo.",
        parsedQuestions: [],
        structured: { coverage: { read: 0, total: 0 }, strengths: [], areas: [], qbq: [] },
      });
    }
    return NextResponse.json(JSON.parse(text.text));
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Score failed' },
      { status: 500 },
    );
  }
}
