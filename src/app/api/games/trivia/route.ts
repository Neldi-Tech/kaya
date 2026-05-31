// Kaya Games — AI trivia question generator (server) — Claude Sonnet (text).
//
// Given a subject, generate kid-friendly multiple-choice questions (exactly 4
// choices each, one correct) for the multi-device Family Trivia game. The host
// calls this once when a subject is picked; the result is cached in the game
// session so every phone gets the same set.
//
// Fails SAFE: returns { skipped: true } when ANTHROPIC_API_KEY is absent and
// { questions: [] } on any model/parse error — the client then falls back to
// its hand-authored bank, so trivia always works.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

// Maps the picker's subject id → a richer prompt label for the model.
const SUBJECT_LABELS: Record<string, string> = {
  animals: 'Animals & nature',
  science: 'Simple science, the human body & space',
  geography: 'World geography (oceans, continents, countries, landmarks)',
  sports: 'Sports & games',
  words: 'Words, spelling, grammar & popular kids books',
  mixed: 'Fun general knowledge — colours, shapes, numbers, food & everyday life',
};

const SYSTEM = `You write multiple-choice trivia questions for a FAMILY game played by children roughly ages 5 to 12 together with their parents.

Return JSON: { "questions": [ { "q": string, "choices": [string, string, string, string], "answer": number } ] }

Rules:
- Each question has EXACTLY 4 choices, and "answer" is the 0-based index (0 to 3) of the single correct choice.
- Every question must be factually correct and unambiguous — exactly ONE choice is right and the other three are clearly wrong.
- Keep the question and each choice SHORT and simple enough for a young child to read aloud. No trick questions, no dark or scary themes.
- Vary the position of the correct answer across the set — do not always put it at the same index.
- Plain text only — no emojis, no markdown, no numbering inside the question or choices.
- Stay strictly on the requested subject. Mix easier and slightly harder questions so the whole family enjoys it.`;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          answer: { type: 'integer', minimum: 0, maximum: 3 },
        },
        required: ['q', 'choices', 'answer'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

interface TriviaQ { q: string; choices: string[]; answer: number }

// Defence in depth — never trust the model's shape even with json_schema on.
function sanitize(raw: unknown): TriviaQ[] {
  const arr = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(arr)) return [];
  const out: TriviaQ[] = [];
  for (const item of arr) {
    const q = (item as TriviaQ)?.q;
    const choices = (item as TriviaQ)?.choices;
    const answer = (item as TriviaQ)?.answer;
    if (typeof q !== 'string' || !q.trim()) continue;
    if (!Array.isArray(choices) || choices.length !== 4) continue;
    if (!choices.every((c) => typeof c === 'string' && c.trim())) continue;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    out.push({
      q: q.trim().slice(0, 160),
      choices: choices.map((c) => c.trim().slice(0, 60)),
      answer,
    });
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: { subject?: string; count?: number };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const subjectId = (body?.subject || 'mixed').toString().trim().slice(0, 40);
  const label = SUBJECT_LABELS[subjectId] || SUBJECT_LABELS.mixed;
  const count = Math.max(4, Math.min(10, Number(body?.count) || 6));

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [{
            type: 'text',
            text: `Subject: ${label}\nWrite ${count} fresh, varied questions for this subject.`,
          }],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ questions: [] });
    const qs = sanitize(JSON.parse(text.text)).slice(0, count);
    return NextResponse.json({ questions: qs });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Trivia generation failed' },
      { status: 500 },
    );
  }
}
