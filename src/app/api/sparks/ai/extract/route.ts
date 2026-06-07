// Sparks AI · OCR extraction (server) — Claude Sonnet vision.
//
// Reads a photo a child uploads into one of the Sparks capture areas
// and extracts the structured bits the parent / kid would otherwise
// type by hand:
//   - achievement         → { awardName, issuer, date, category }
//   - academic            → { term, year, subjects[…], teacherNotes }
//   - school_project      → { title, description, subject }
//   - home_project        → { title, description }
//   - sports_subscription → { title, description }
//
// Powers:
//   • "✨ Scan certificate" button on Achievement capture
//   • Scan-tile auto-describe on every other Sparks capture area
//   • Upcoming "Scan a report card" flow on the Academic page
// The parent / kid ALWAYS reviews + edits before save.
//
// Mirrors /api/receipt-scan: no-ops with { skipped: true } when
// ANTHROPIC_API_KEY is missing.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type ExtractKind =
  | 'achievement'
  | 'academic'
  | 'school_project'
  | 'home_project'
  | 'sports_subscription'
  | 'reflection';

interface ExtractBody {
  imageBase64: string;
  mediaType?: string;
  kind: ExtractKind;
}

const ACHIEVEMENT_SYSTEM = `You read a photo of a certificate, award, medal, or prize for a child and extract the printed details so a parent doesn't have to type them.

Return JSON: {
  "awardName": short title (e.g. "Best in Mathematics", "1st Place · Inter-class Football"),
  "issuer":    school / club / event name (e.g. "St. Mary's School", "Aqua Kids Club"),
  "date":      ISO date "YYYY-MM-DD" when you can read one; else "",
  "category":  one of: "academic" | "sports" | "arts" | "service" | "other"
}

Rules:
- If the image isn't a certificate / award, return empty strings + "other".
- Read dates conservatively. Parse "Term 1 · 2026" as "2026-04-01" (start of term) only when nothing more precise is printed; otherwise leave empty.
- Never invent text you can't read.`;

const ACADEMIC_SYSTEM = `You read a photo of a school REPORT CARD for a child and extract the per-subject grades a parent would otherwise type by hand.

Return JSON: {
  "term":         "T1" | "T2" | "T3" | "" (best-guess from "Term N" or month range),
  "year":         calendar year as a number, e.g. 2026, or 0 if not readable,
  "subjects": [   one entry per subject row
    { "name": subject name, "grade": letter (A/B/C/D/F) or "" if absent, "percent": 0-100 number or null if absent }
  ],
  "teacherNotes": single paragraph summary of any teacher remark on the page, or ""
}

Rules:
- Keep subjects in the order printed on the card.
- Drop totals / averages / non-subject rows.
- Don't invent percentages — if only a letter grade is printed, set percent = null.
- Never read out parent / kid personal details — only the academic content.`;

const SCHOOL_PROJECT_SYSTEM = `You read a photo of a child's SCHOOL project (poster, model, drawing, presentation, homework) and produce three short fields to seed a kid-friendly capture entry.

Return JSON: {
  "title":       a short, kid-friendly name for the project (e.g. "Africa map · Geography", "Volcano model", "Solar system poster"). 2-6 words. No quotation marks.
  "description": one sentence (max 25 words) describing what the project shows, in simple kid-friendly language. Never invent facts you can't see.
  "subject":     the school subject visible on the work (e.g. "Geography", "Math", "Science", "English", "History"); empty string if not clear.
}

Rules:
- Tone is warm + plain English. Write so a 9-year-old feels proud of it.
- If the photo is NOT a school project, return empty strings for all three fields.
- Never include the child's name unless it is printed clearly on the work.`;

const HOME_PROJECT_SYSTEM = `You read a photo of a child's HOME project (craft, art, build, recipe, lego model, science experiment) and produce two short fields.

Return JSON: {
  "title":       a short, kid-friendly name for what was made (e.g. "Origami crane", "Paper plane v3", "Sand castle", "Lego rocket"). 2-6 words. No quotation marks.
  "description": one sentence (max 25 words) describing the build in simple kid-friendly language.
}

Rules:
- Tone is warm + plain English. Write so a 9-year-old feels proud of it.
- If the photo is NOT a home build / craft / art / experiment, return empty strings.
- Never invent facts you can't see.`;

const SPORTS_SUBSCRIPTION_SYSTEM = `You read a photo a child uploads for a sports / activity SUBSCRIPTION (poster, flyer, certificate, ID card, brochure, schedule) and produce two short fields.

Return JSON: {
  "title":       the club / activity name (e.g. "Football Academy", "Aqua Kids Club", "Karate Class"). 2-6 words. No quotation marks.
  "description": one sentence (max 25 words) noting the activity + coach / venue / dates if visible on the image. Never invent.
}

Rules:
- Tone is warm + plain English.
- If the photo is NOT a sports / activity sign-up, return empty strings.`;

const ACHIEVEMENT_SCHEMA = {
  type: 'object',
  properties: {
    awardName: { type: 'string' },
    issuer:    { type: 'string' },
    date:      { type: 'string' },
    category:  { type: 'string', enum: ['academic', 'sports', 'arts', 'service', 'other'] },
  },
  required: ['awardName', 'issuer', 'date', 'category'],
  additionalProperties: false,
} as const;

const ACADEMIC_SCHEMA = {
  type: 'object',
  properties: {
    term: { type: 'string', enum: ['T1', 'T2', 'T3', ''] },
    year: { type: 'number' },
    subjects: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          grade: { type: 'string' },
          percent: { type: ['number', 'null'] },
        },
        required: ['name', 'grade', 'percent'],
        additionalProperties: false,
      },
    },
    teacherNotes: { type: 'string' },
  },
  required: ['term', 'year', 'subjects', 'teacherNotes'],
  additionalProperties: false,
} as const;

const SCHOOL_PROJECT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    subject: { type: 'string' },
  },
  required: ['title', 'description', 'subject'],
  additionalProperties: false,
} as const;

const HOME_PROJECT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['title', 'description'],
  additionalProperties: false,
} as const;

const SPORTS_SUBSCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
  },
  required: ['title', 'description'],
  additionalProperties: false,
} as const;

const REFLECTION_SYSTEM = `You read a photo of a child's HANDWRITTEN daily reflection — a few sentences about how their school day went — and transcribe it faithfully so it can be saved as typed text.

Return JSON: {
  "text": the transcribed reflection in plain text, preserving the child's own words, sentence order, and meaning. Fix only obvious spelling so it reads cleanly; keep it in the child's voice. Use normal sentence spacing; join wrapped lines into sentences.
}

Rules:
- Transcribe ONLY what is written. Never add, summarise, or invent content.
- If a word is illegible, use [?] in its place rather than guessing.
- If the image is not a handwritten reflection (blank page, unrelated photo), return "".
- Do not include the child's name or any header/date line — just the reflection body.`;

const REFLECTION_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: ExtractBody;
  try {
    body = (await req.json()) as ExtractBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const kind = body?.kind;
  if (!imageBase64 || !kind) {
    return NextResponse.json({ error: 'Missing imageBase64 or kind' }, { status: 400 });
  }

  const system =
    kind === 'achievement'         ? ACHIEVEMENT_SYSTEM
    : kind === 'academic'          ? ACADEMIC_SYSTEM
    : kind === 'school_project'    ? SCHOOL_PROJECT_SYSTEM
    : kind === 'home_project'      ? HOME_PROJECT_SYSTEM
    : kind === 'reflection'        ? REFLECTION_SYSTEM
    :                                SPORTS_SUBSCRIPTION_SYSTEM;
  const schema =
    kind === 'achievement'         ? ACHIEVEMENT_SCHEMA
    : kind === 'academic'          ? ACADEMIC_SCHEMA
    : kind === 'school_project'    ? SCHOOL_PROJECT_SCHEMA
    : kind === 'home_project'      ? HOME_PROJECT_SCHEMA
    : kind === 'reflection'        ? REFLECTION_SCHEMA
    :                                SPORTS_SUBSCRIPTION_SCHEMA;

  const emptyFallback =
    kind === 'achievement'         ? { awardName: '', issuer: '', date: '', category: 'other' }
    : kind === 'academic'          ? { term: '', year: 0, subjects: [], teacherNotes: '' }
    : kind === 'school_project'    ? { title: '', description: '', subject: '' }
    : kind === 'reflection'        ? { text: '' }
    :                                { title: '', description: '' };

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Read this image.' },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json(emptyFallback);
    }
    return NextResponse.json(JSON.parse(text.text));
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Extract failed' },
      { status: 500 },
    );
  }
}
