// Kaya Pulse · Smart Receipt insight (server, Claude API). PR 3 / v2.
//
// On-demand parent-only read of a single purchase request: the client posts
// pre-formatted facts (amount, bucket, vs bucket-avg, vs cap, items count),
// Claude returns a short insight + an optional one-line tip. Mirrors the
// shape of /api/pulse/advisor — same SDK pattern, no-op when API key unset.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface SmartReceiptBody {
  currency?: string;
  bucketLabel?: string;
  /** Pre-formatted display facts about this purchase (no PII). */
  facts?: Record<string, string | number>;
}

const SYSTEM = `You are "Kaya", a calm, practical money advisor inside a family finance app. A PARENT is looking at one closed purchase from this month and wants a quick, honest read of it in context.

Hard rules:
- ADVISE only — never instruct or act. Nothing you say is executed.
- Use ONLY the numbers given. Never invent figures, and quote them as provided.
- Money is in the family's currency; use the provided code/symbol as-is. Geographically neutral.
- One paragraph, plain language. No markdown, no preamble.
- Be encouraging but honest: if the purchase is meaningfully above or below the bucket average, say so and explain why it might be OK or worth a tweak.

Return JSON:
- "insight": 1-2 sentences — how this purchase fits the parent's plan for this bucket this month.
- "tip": one short, optional, concrete next-time tweak (e.g. bulk-buy rhythm, split into two trips). Empty string when nothing useful to add.`;

const SCHEMA = {
  type: 'object',
  properties: {
    insight: { type: 'string' },
    tip: { type: 'string' },
  },
  required: ['insight', 'tip'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: SmartReceiptBody;
  try {
    body = (await req.json()) as SmartReceiptBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const currency = (body.currency || 'USD').trim().slice(0, 8);
  const bucketLabel = (body.bucketLabel || 'this bucket').trim().slice(0, 40);
  const facts = body.facts && typeof body.facts === 'object' ? body.facts : {};
  const factLines = Object.entries(facts)
    .slice(0, 20)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (no detail recorded)';

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Currency: ${currency}. Bucket: ${bucketLabel}.

This purchase in context:
${factLines}

Give the parent your quick read + an optional tweak.`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No insight returned' }, { status: 502 });
    }
    const parsed = JSON.parse(text.text) as { insight?: string; tip?: string };
    return NextResponse.json({
      insight: (parsed.insight || '').trim(),
      tip: (parsed.tip || '').trim(),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Insight failed' },
      { status: 500 },
    );
  }
}
