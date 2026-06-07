// Sparks AI · Daily Reflection feedback (server) — Claude Sonnet.
//
// Takes a child's saved daily reflection text and returns WARM, STRUCTURED
// feedback the kid can read at a glance — three short blocks:
//   wentWell  🌟  what they did well today (always; encouragement-first)
//   tip       💡  one small, specific, kind pointer (optional — omit on
//                 pure-positive days rather than forcing criticism)
//   cheer     👏  a short closing cheer
//
// Tone: kid-safe, age-aware, never harsh. The point is consistency +
// confidence, not grading. Mirrors /api/sparks/ai/extract: no-ops with
// { skipped: true } when ANTHROPIC_API_KEY is missing, so the module
// degrades to "saved, no AI" gracefully.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface ReflectBody {
  text: string;
  /** Optional — lets the model pitch tone for the child's age. */
  ageYears?: number;
  /** Optional — kid's first name, for a warmer cheer. */
  firstName?: string;
}

const SYSTEM = `You are Kaya, a warm, encouraging companion for a CHILD reflecting on their school day. You read the child's own short reflection and reply with kind, structured feedback they can read at a glance.

Return JSON: {
  "wentWell": one or two short sentences naming something genuinely good in what they wrote — effort, honesty, progress, a good attitude. Always present. Specific to their words, never generic.
  "tip":      OPTIONAL — one small, specific, gentle suggestion for next time, phrased kindly and positively. Omit this field entirely on days that are simply positive; never invent a problem just to give a tip.
  "cheer":    one short closing cheer (max ~12 words) that leaves them feeling proud and motivated.
}

Rules:
- Audience is a child. Warm, simple, plain English. Short sentences.
- Encouragement first, always. A tip is optional and must be kind, not corrective scolding.
- Praise effort and process ("you kept going", "you noticed what was hard"), not just outcomes.
- Stay strictly grounded in what the child wrote. Never invent events, grades, or feelings.
- Never mention anything unsafe, never compare them to others, never be sarcastic.
- Keep the whole thing skimmable — a child should read it in a few seconds.`;

const SCHEMA = {
  type: 'object',
  properties: {
    wentWell: { type: 'string' },
    tip: { type: 'string' },
    cheer: { type: 'string' },
  },
  required: ['wentWell', 'cheer'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: ReflectBody;
  try {
    body = (await req.json()) as ReflectBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const text = (body?.text || '').trim();
  if (!text) {
    return NextResponse.json({ error: 'Missing reflection text' }, { status: 400 });
  }

  const ctx: string[] = [];
  if (typeof body.ageYears === 'number' && body.ageYears > 0) ctx.push(`The child is about ${body.ageYears} years old — pitch your words for that age.`);
  if (body.firstName) ctx.push(`Their first name is ${body.firstName} — you may use it once in the cheer.`);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `${ctx.join('\n')}\n\nThe child's reflection:\n"""\n${text}\n"""` },
          ],
        },
      ],
    });

    const out = response.content.find((b) => b.type === 'text');
    if (!out || out.type !== 'text') {
      return NextResponse.json({ wentWell: '', cheer: '' });
    }
    return NextResponse.json(JSON.parse(out.text));
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Reflect failed' },
      { status: 500 },
    );
  }
}
