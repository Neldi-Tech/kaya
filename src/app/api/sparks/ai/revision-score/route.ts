// Sparks AI · revision scoring (server) — Claude Sonnet vision.
//
// Reads a photo (1-4) of a kid's homework revision and returns a
// structured score the dashboard renders verbatim:
//
//   subject     · 'Math' | 'English' | 'Kiswahili' | 'Science' | ...
//   gradeLevel  · 'Grade 4' best-guess from handwriting + content
//   score       · 0-100 overall %
//   breakdown   · { correct, partial, wrong } per-question counts
//   notes       · 1-2 sentence kid-readable "why" of mistakes
//
// Powers the in-flow scoring step on /sparks/[kidId]/revisions/new.
// Mirrors /api/sparks/ai/extract: cache_control: ephemeral on the
// system prompt, { skipped: true } when ANTHROPIC_API_KEY is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface ScoreBody {
  imageBase64s: string[];
  mediaType?: string;
  kidName: string;
  /** Optional hint — the focus subjects from sparks_profiles. */
  focusSubjects?: string[];
}

const SYSTEM = `You are the in-app AI tutor for Kaya Sparks Home Revisions. A child has just submitted 1-4 photos of a homework revision page. Identify the subject + grade level, then score the work.

Return JSON: {
  "subject":     short subject name (e.g. "Math", "English", "Kiswahili", "Science", "Social Studies", "Other"),
  "gradeLevel":  best-guess grade + level (e.g. "Grade 4", "Year 3", "Primary 5") — empty string if unreadable,
  "score":       0-100 overall percentage (round to int),
  "breakdown":   { "correct": int, "partial": int, "wrong": int }  — counts of distinct questions/items,
  "notes":       1-2 sentences explaining the main strength + the main mistake pattern, written for the child (you can use their first name)
}

Rules:
- Be conservative: if the page isn't a homework revision, return subject="Other", score=0, empty counts, and notes="Couldn't read this as a homework revision — try a clearer photo."
- Don't shame mistakes — phrase notes constructively ("Most multiplication was solid; check the long-division remainder step.").
- "partial" = right answer but missing working, OR mostly right with one slip.
- Be specific in notes — reference what you saw on the page.
- Never invent questions that aren't on the page. If you can't read items, count what you can.`;

const SCHEMA = {
  type: 'object',
  properties: {
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
  },
  required: ['subject', 'gradeLevel', 'score', 'breakdown', 'notes'],
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

  if (images.length === 0) {
    return NextResponse.json({ error: 'No images provided' }, { status: 400 });
  }

  const userContext = [
    `Kid: ${kidName}`,
    focus ? `Family is focusing on: ${focus}` : '',
    `${images.length} photo(s) of a homework revision attached.`,
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
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
        subject: 'Other', gradeLevel: '', score: 0,
        breakdown: { correct: 0, partial: 0, wrong: 0 },
        notes: "Couldn't parse this page — try a clearer photo.",
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
