// Kaya Games — "Tell me more" (server) — Claude Haiku (fast, cheap).
// Expands a trivia question + fun fact into a short kid-friendly mini-lesson.
// Fails SAFE: { skipped:true } with no key; { text:'' } on error.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const SYSTEM = "You are a warm, friendly tutor for children aged about 6 to 12. Given a trivia question and its fun fact, explain it a little more in 2 to 3 short, vivid, accurate sentences a child would enjoy. Plain text, at most one emoji, no preamble — just the explanation.";

export async function POST(req: NextRequest) {
  if (!client) return NextResponse.json({ skipped: true });

  let body: { q?: string; fact?: string };
  try { body = (await req.json()) as typeof body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const q = (body.q || '').toString().slice(0, 240);
  const fact = (body.fact || '').toString().slice(0, 320);
  if (!q && !fact) return NextResponse.json({ error: 'nothing' }, { status: 400 });

  try {
    const r = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 240,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: [{ type: 'text', text: `Question: ${q}\nFun fact: ${fact}\nTell me a little more:` }] }],
    });
    const t = r.content.find((b) => b.type === 'text');
    const text = t && t.type === 'text' ? t.text.trim().slice(0, 600) : '';
    return NextResponse.json({ text });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
