// Slice 7p · Daily Reflection · post-scan AI read (Section D of design).
//
// The moment the kid scans/types a reflection, this endpoint returns:
//   · mood_emoji + mood_word — one of 8 read from the kid's own words
//   · theme_emoji + theme_label — what they wrote about today
//   · kaya_response — 1–2 short warm sentences, never preachy
// Used by the reflection page's "🤖 Kaya read your reflection" card.
//
// Sits alongside /api/sparks/ai/reflect (which produces the structured
// wentWell/tip/cheer feedback) — that one is the encouragement card,
// THIS one is the fast emotional read with read-aloud baked in.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface ReadBody {
  text: string;
  firstName?: string;
}

const SYSTEM = `You read a child's short daily reflection (typed or transcribed from handwriting) and respond with a warm, specific micro-read for Kaya Sparks. This appears moments after the kid hits save — it must feel like a friend who actually listened, not a coach.

Return JSON: {
  "mood_emoji":  "single emoji (one of 😊 😄 😐 🙁 😢 😠 😴 🤔 — pick the closest)",
  "mood_word":   "one or two words: 'joyful', 'proud', 'tired', 'curious', 'mixed', 'quiet'",
  "theme_emoji": "single emoji for the day's theme (e.g. ⚽ for football, 📚 for school, 🤝 for friends)",
  "theme_label": "2-4 words naming what the kid wrote about today",
  "kaya_response": "1-2 SHORT sentences from Kaya. Warm + specific + never preachy. Reference something the kid actually wrote. Use the kid's first name at most once. Do not give advice unless they asked for it."
}

Rules:
- mood + theme are READS, not labels — choose what matches the kid's own words.
- If the entry is one tired sentence, the response is a kind one-liner.
- If the entry mentions a low day, name it gently ("Tough one today.") — never minimise.
- Never use "amazing", "fantastic", or pile-up praise. Specific > effusive.
- Never moralize. The kid is the author; you reflect, you don't direct.`;

const SCHEMA = {
  type: 'object',
  properties: {
    mood_emoji:    { type: 'string' },
    mood_word:     { type: 'string' },
    theme_emoji:   { type: 'string' },
    theme_label:   { type: 'string' },
    kaya_response: { type: 'string' },
  },
  required: ['mood_emoji', 'mood_word', 'theme_emoji', 'theme_label', 'kaya_response'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }
  let body: ReadBody;
  try { body = (await req.json()) as ReadBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = (body?.text || '').trim().slice(0, 1500);
  if (!text) return NextResponse.json({ error: 'Empty text' }, { status: 400 });
  const firstName = (body?.firstName || '').trim().slice(0, 40) || 'the kid';

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Kid: ${firstName}\nReflection: """${text}"""` }],
      }],
    });
    const out = response.content.find((b) => b.type === 'text');
    if (!out || out.type !== 'text') return NextResponse.json({ error: 'No response' }, { status: 500 });
    return NextResponse.json(JSON.parse(out.text));
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'AI read failed' },
      { status: 500 },
    );
  }
}
