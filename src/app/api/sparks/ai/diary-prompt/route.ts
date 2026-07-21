// Kaya Sparks · Diary 🫙 Prompt Jar (Slice 8f · 2026-07-21).
//
// Returns ONE kid-appropriate writing prompt for a blank diary page.
// Age-tiered tone; falls back to a local bank when the AI key is
// absent so the jar never comes up empty.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 20;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const BANK = [
  'What made you laugh so hard today you almost fell over?',
  'If today had a colour, what would it be — and why?',
  'Write about someone who was kind to you this week.',
  'What is something you can do now that you couldn’t do last year?',
  'Describe your perfect Saturday, hour by hour.',
  'What sound do you love the most? When did you last hear it?',
  'If you could ask one question and get a true answer, what would it be?',
  'Write a letter to yourself one year from now.',
  'What was the hardest part of today? What helped?',
  'Which meal would you eat every day forever? Defend it!',
  'What do you want to remember about being the age you are right now?',
  'Invent a holiday. What do people do on it?',
];

const SYSTEM = `You write ONE diary prompt for a child's personal diary in Kaya Sparks. Warm, curious, specific — a question that makes a kid WANT to write. Age-appropriate to the given age (younger = simpler + more concrete). Never about trauma. Never preachy. Return JSON: { "prompt": "one question, max 20 words" }.`;

const SCHEMA = {
  type: 'object',
  properties: { prompt: { type: 'string' } },
  required: ['prompt'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  let body: { firstName?: string; age?: number };
  try { body = await req.json(); } catch { body = {}; }
  const firstName = (body.firstName || '').trim().slice(0, 40);
  const age = Number.isFinite(body.age) ? Math.max(3, Math.min(17, Number(body.age))) : null;

  if (!client) {
    return NextResponse.json({ prompt: BANK[Math.floor(Math.random() * BANK.length)], source: 'bank' });
  }
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Kid: ${firstName || 'a child'}${age ? ` · age ${age}` : ''}. One fresh prompt.` }],
      }],
    });
    const t = response.content.find((b) => b.type === 'text');
    if (t && t.type === 'text') {
      const parsed = JSON.parse(t.text) as { prompt?: string };
      if (parsed.prompt) return NextResponse.json({ prompt: parsed.prompt.slice(0, 200), source: 'ai' });
    }
  } catch { /* fall through to bank */ }
  return NextResponse.json({ prompt: BANK[Math.floor(Math.random() * BANK.length)], source: 'bank' });
}
