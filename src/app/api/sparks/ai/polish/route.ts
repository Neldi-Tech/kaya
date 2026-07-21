// Kaya Sparks · AI Polish (Slice 8h · 2026-07-21).
//
// Takes what a kid (or parent) wrote in a Diary or Reflection page and
// returns a NEATLY FORMATTED version — a title, bullets/numbers where
// they fit, light emojis — using markdown-lite the client renders.
//
// The one rule that keeps this safe (from the approved design):
//   · SAME MEANING. Never add facts, never change feelings, never
//     invent events. Only structure + tidy + tasteful emoji.
//   · SAME LANGUAGE as the input (EN / SW auto).
//   · This route only PREVIEWS — the client decides "use polished" vs
//     "keep mine" and stores both via the diary / reflection gateway.
//
// No auth needed beyond same-origin (mirrors the other /ai/* preview
// routes) — it returns text only, touches no data. Skips with
// { skipped:true } when the AI key is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const SYSTEM = `You tidy a child's (or parent's) diary/reflection page into neat, fun, easy-to-review formatting for the Kaya Sparks app. You output MARKDOWN-LITE:
- a single short "# Title" line (a warm, fitting heading)
- normal paragraphs
- "- " bullet lists when they list things
- "1. " numbered lists for steps or sequences
- **bold** for the odd key phrase
- a few tasteful emoji sprinkled in (never every line)

IRON RULES:
- SAME MEANING. Do NOT add facts, events, names, feelings, or opinions that aren't in the original. Do NOT remove anything meaningful.
- SAME LANGUAGE as the input (English or Kiswahili — match it).
- Keep the writer's voice — this is their page, tidied, not rewritten.
- Fix obvious spelling/casing/spacing. Do not "upgrade" simple words.
- If the text is already tidy or very short, return it lightly formatted (a title + the text) rather than forcing lists.

Return JSON: { "polished": "the markdown-lite version" }.`;

const SCHEMA = {
  type: 'object',
  properties: { polished: { type: 'string' } },
  required: ['polished'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  let body: { text?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const text = String(body?.text ?? '').trim().slice(0, 6000);
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });

  try {
    const r = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
    });
    const t = r.content.find((b) => b.type === 'text');
    if (!t || t.type !== 'text') return NextResponse.json({ error: 'no-output' }, { status: 500 });
    const polished = (JSON.parse(t.text) as { polished?: string }).polished?.slice(0, 8000) || '';
    if (!polished) return NextResponse.json({ error: 'no-output' }, { status: 500 });
    return NextResponse.json({ polished });
  } catch (e) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Polish failed' }, { status: 500 });
  }
}
