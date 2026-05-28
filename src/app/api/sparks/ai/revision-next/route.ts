// Sparks AI · next-question generator (server) — Claude Sonnet (text).
//
// Given the just-scored revision (subject + grade + score + notes),
// generate 3 follow-up questions tuned to what the kid got wrong.
// Progressive difficulty: easier-first when score < 60%, harder-first
// when score > 80%, balanced otherwise.
//
// Text-only route (no vision) so it returns fast — typically < 2s.
// Mirrors /api/sparks/ai/extract: cache_control: ephemeral on the
// system prompt, { skipped: true } when ANTHROPIC_API_KEY is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface NextBody {
  kidName: string;
  subject: string;
  gradeLevel: string;
  score: number;
  notes?: string;
  /** Optional — past round titles so we don't repeat the same questions. */
  recentRounds?: Array<{ subject: string; ai_notes?: string }>;
}

const SYSTEM = `You are the in-app AI tutor for Kaya Sparks Home Revisions. The child has just submitted a homework revision; you've already scored it. Now generate exactly 3 follow-up practice questions tuned to what they got wrong.

Return JSON: { "questions": [ string, string, string ] }

Rules:
- Tune difficulty to the score: if score < 60 → start easier and build, if 60-79 → mixed, if ≥ 80 → push slightly harder.
- Match the grade level — never throw algebra at a Grade 3 kid.
- Each question is a single concrete problem the child can write on paper. Include any units / context they need.
- Use the subject AND any "notes" hint to target the mistake. If notes mention "remainder step", make the questions involve remainders.
- Avoid repeating the same question shape as past rounds when provided.
- Plain language. No emojis. Phrase the questions for a child to read solo.
- Don't include answers — these are practice questions.`;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

const EMPTY = { questions: [
  'Try a similar problem to one you got wrong — re-do it slowly, showing every step.',
  'Make up your own problem in this topic and solve it.',
  'Explain the topic to a sibling or stuffed animal in 2 sentences.',
] };

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: NextBody;
  try {
    body = (await req.json()) as NextBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const kidName = (body?.kidName || '').trim().slice(0, 60) || 'the child';
  const subject = (body?.subject || 'Other').trim().slice(0, 40);
  const gradeLevel = (body?.gradeLevel || '').trim().slice(0, 40);
  const score = Math.max(0, Math.min(100, Number(body?.score) || 0));
  const notes = (body?.notes || '').trim().slice(0, 600);
  const recent = (body?.recentRounds ?? []).slice(0, 4);

  if (!subject) return NextResponse.json(EMPTY);

  const context = [
    `Kid: ${kidName}`,
    `Subject: ${subject}`,
    gradeLevel ? `Grade: ${gradeLevel}` : '',
    `Just-scored: ${score}%`,
    notes ? `Mistake pattern noted: ${notes}` : '',
    recent.length > 0 ? `Recent rounds (so don't repeat exactly): ${recent.map((r) => r.subject + (r.ai_notes ? ' · ' + r.ai_notes : '')).join(' | ')}` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 800,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        { role: 'user', content: [{ type: 'text', text: context }] },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json(EMPTY);
    const parsed = JSON.parse(text.text) as { questions?: string[] };
    const qs = (parsed.questions ?? []).filter((q) => typeof q === 'string' && q.trim().length > 0).slice(0, 3);
    if (qs.length < 3) return NextResponse.json(EMPTY);
    return NextResponse.json({ questions: qs });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Next-questions failed' },
      { status: 500 },
    );
  }
}
