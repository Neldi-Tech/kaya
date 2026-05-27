// Sparks AI · OCR extraction (server) — Claude Sonnet vision.
//
// Reads a photo of a certificate / award / report card and extracts
// the structured bits the parent would otherwise type by hand:
//   - achievement → { awardName, issuer, date, category }
//   - academic   → { term, year, subjects[{name, grade?, percent?}], teacherNotes }
//
// Powers the "✨ Scan this certificate" button in the CaptureSheet
// (when area === 'achievement') and the upcoming "Scan a report card"
// flow on the Academic page. Parent ALWAYS reviews + edits before save.
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

type ExtractKind = 'achievement' | 'academic';

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

  const system = kind === 'achievement' ? ACHIEVEMENT_SYSTEM : ACADEMIC_SYSTEM;
  const schema = kind === 'achievement' ? ACHIEVEMENT_SCHEMA : ACADEMIC_SCHEMA;

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
      return NextResponse.json(kind === 'achievement'
        ? { awardName: '', issuer: '', date: '', category: 'other' }
        : { term: '', year: 0, subjects: [], teacherNotes: '' });
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
