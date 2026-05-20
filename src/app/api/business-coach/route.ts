// Kaya Business · AI co-pilot (server). The four Phase-1 loops — idea shaping,
// pricing, cost flags, weekly review — over the kid's ACTUAL numbers. The coach
// only ever ADVISES; it never executes anything (no writes happen here).
//
// Mirrors /api/catalogue-suggest's trust + fallback model: no-ops cleanly when
// ANTHROPIC_API_KEY is missing, so every business screen still works without AI.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type Loop = 'idea' | 'pricing' | 'cost_flag' | 'weekly';

interface CoachBody {
  loop: Loop;
  coachName?: string;
  currency?: string;
  /** Short, already-formatted facts about the business (the kid's real
   *  numbers). Display strings only — no PII beyond the business + customer
   *  names the kid themselves typed. */
  facts?: Record<string, string | number>;
}

const LOOP_BRIEF: Record<Loop, string> = {
  idea: 'The kid is shaping a NEW business idea. Give one encouraging sentence that reflects their idea back, then one concrete next step to turn it into a 2-week pilot. Suggestions = 2-3 tiny first actions.',
  pricing: 'Coach the kid on PRICE. Using their cost and current price, say whether the price looks healthy and suggest a fair number if it is below cost or very thin. Keep the math kid-simple. Suggestions = e.g. "Raise to X", "Keep it", "Why?".',
  cost_flag: 'A COST looks high or margin dropped. Gently flag it (never shame) and offer options to look into — bigger pack, different supplier, or a small price nudge. Suggestions = 2-3 options to explore.',
  weekly: 'Write a short, warm WEEKLY recap a kid can share with a parent: best moment, biggest cost, and one thing to try next week. Use their real numbers. Suggestions = 1-2 things to try next week.',
};

const SYSTEM = `You are a kid-friendly business coach inside the Kaya family app. A CHILD runs a tiny real micro-business (lemonade, eggs, a car-wash, crafts) with simple books, and you help them learn money by doing.

Hard rules:
- You ADVISE, you never INSTRUCT or act. Always propose, never command. Nothing you say is executed.
- Use the child's ACTUAL numbers and their business name, exactly as given. Never invent figures.
- Kid-level words and kid-level math. Short — 1-3 sentences, warm, specific.
- Never shame, never lecture, never scare. A loss or a thin margin is a normal thing to learn from.
- Money is in the family's currency; use the provided currency symbol/code as-is. Geographically neutral — no country/region framing.
- If the first big decisions look risky (spending a lot, dropping price below cost), gently suggest checking with a parent.

Return JSON: a short "message" (the coach's words, plain text, no markdown) and "suggestions" (0-3 very short tap-reply chips, ≤4 words each).`;

const SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['message', 'suggestions'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: CoachBody;
  try {
    body = (await req.json()) as CoachBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const loop = body?.loop;
  if (!loop || !LOOP_BRIEF[loop]) {
    return NextResponse.json({ error: 'Unknown coaching loop' }, { status: 400 });
  }
  const coachName = (body.coachName || 'Kaya Coach').trim().slice(0, 40);
  const currency = (body.currency || 'USD').trim().slice(0, 8);
  const facts = body.facts && typeof body.facts === 'object' ? body.facts : {};
  const factLines = Object.entries(facts)
    .slice(0, 20)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (no numbers yet)';

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Your name is "${coachName}". Currency: ${currency}.
Coaching loop: ${loop}
${LOOP_BRIEF[loop]}

The child's real numbers:
${factLines}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No coaching returned' }, { status: 502 });
    }
    const parsed = JSON.parse(text.text) as { message?: string; suggestions?: string[] };
    return NextResponse.json({
      message: (parsed.message || '').trim(),
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3)
        : [],
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Coaching failed' },
      { status: 500 },
    );
  }
}
