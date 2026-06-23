// 2026-06-23 · Daily Reflection · AI soundness score.
//
// Scores how SOUND a child's reflection is — thoughtful, honest, and
// reasonably complete — on a 0-100 scale, with a 1-line kid-readable
// rationale. This is DISPLAY-ONLY feedback (never points): it sits next
// to the parent's review so both a machine read and a human read of the
// same page are visible. Tests the soundness of the REFLECTION (depth /
// self-awareness), NOT spelling, grammar, or handwriting.
//
// Mirrors /api/sparks/ai/reflection-read: cache_control ephemeral on the
// system prompt, { skipped: true } when ANTHROPIC_API_KEY is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface ScoreBody {
  text: string;
  firstName?: string;
}

const SYSTEM = `You score how SOUND a child's short daily reflection is for Kaya Sparks. "Sound" = thoughtful, honest, and reasonably complete for a kid writing a few lines about their day — does it go beyond "it was fine" to name what happened, how they felt, or what they noticed/learned? You are scoring the REFLECTION itself, NOT spelling, grammar, vocabulary, or handwriting (you only see transcribed text).

Return JSON: {
  "soundness":  0-100 integer. Anchor it: 20 = one bland word ("ok"); 45 = a single concrete event, no feeling; 65 = an event + a feeling OR a small reflection; 85 = an event + feeling + something they noticed/learned; 95 = genuinely reflective with cause/effect or a next step. Be encouraging but honest — most everyday entries land 50-80.,
  "rationale":  ONE short, warm sentence (kid-readable) naming WHY — point at what made it sound, or the one thing that would lift it. Never shame. Use the child's first name at most once.
}

Rules:
- Reward honesty about hard days as much as happy ones — a sad, specific entry is sound.
- Do NOT penalise short entries if they're specific and felt; do nudge purely empty ones.
- Never mention spelling/grammar/handwriting — those aren't what this measures.`;

const SCHEMA = {
  type: 'object',
  properties: {
    soundness: { type: 'number' },
    rationale: { type: 'string' },
  },
  required: ['soundness', 'rationale'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }
  let body: ScoreBody;
  try { body = (await req.json()) as ScoreBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = (body?.text || '').trim().slice(0, 1500);
  if (!text) return NextResponse.json({ error: 'Empty text' }, { status: 400 });
  const firstName = (body?.firstName || '').trim().slice(0, 40) || 'the kid';

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 250,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Kid: ${firstName}\nReflection: """${text}"""` }],
      }],
    });
    const out = response.content.find((b) => b.type === 'text');
    if (!out || out.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 });
    const parsed = JSON.parse(out.text) as { soundness?: number; rationale?: string };
    const soundness = Math.max(0, Math.min(100, Math.round(Number(parsed.soundness) || 0)));
    return NextResponse.json({ soundness, rationale: String(parsed.rationale || '') });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI score failed' },
      { status: 500 },
    );
  }
}
