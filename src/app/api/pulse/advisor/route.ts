// Kaya Pulse · "Ask Kaya" advisor (server, Claude API). §2(b).
//
// On-demand, parent-only financial read of the month's household spend:
// the client POSTs already-formatted facts (priced consumption + caps +
// run-rate + anomalies — display strings only), and Claude returns a
// plain-language insight + one concrete action, in the family currency.
//
// Mirrors /api/business-coach: same SDK + caching shape, and no-ops
// cleanly when ANTHROPIC_API_KEY is unset so the Dashboard still works
// without AI. The card caches the result per month client-side, so this
// runs on tap ("Get advice" / "Refresh"), not on every Dashboard load.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface AdvisorBody {
  currency?: string;
  monthLabel?: string;
  /** Pre-formatted display facts about the month (no PII). */
  facts?: Record<string, string | number>;
}

const SYSTEM = `You are "Kaya", a calm, practical money advisor inside a family finance app. A PARENT is looking at this month's household spending and wants a quick, honest read.

Hard rules:
- ADVISE only — never instruct or act. Nothing you say is executed.
- Use ONLY the numbers given. Never invent figures, and quote them as provided.
- Money is in the family's currency; use the provided currency code/symbol as-is. Geographically neutral — no country/region framing.
- Plain language for a busy parent. Short and specific. No markdown, no preamble.
- Be encouraging but straight: name the biggest overshoot or risk, and the single highest-leverage thing to do about it.

Return JSON:
- "insight": 1-3 sentences — where the money is going this month, and the biggest cut opportunity, grounded in the numbers.
- "action": one concrete, doable next step (e.g. trim a bucket, set/adjust a cap, watch a spiking meter), phrased for a parent.`;

const SCHEMA = {
  type: 'object',
  properties: {
    insight: { type: 'string' },
    action: { type: 'string' },
  },
  required: ['insight', 'action'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: AdvisorBody;
  try {
    body = (await req.json()) as AdvisorBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const currency = (body.currency || 'USD').trim().slice(0, 8);
  const monthLabel = (body.monthLabel || 'this month').trim().slice(0, 40);
  const facts = body.facts && typeof body.facts === 'object' ? body.facts : {};
  const factLines = Object.entries(facts)
    .slice(0, 40)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n') || '- (no spend recorded yet)';

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 700,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Currency: ${currency}. Month: ${monthLabel}.

This month's household numbers (cash spend vs caps, run-rate projection, and metered consumption):
${factLines}

Give the parent their read + one action.`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No advice returned' }, { status: 502 });
    }
    const parsed = JSON.parse(text.text) as { insight?: string; action?: string };
    return NextResponse.json({
      insight: (parsed.insight || '').trim(),
      action: (parsed.action || '').trim(),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Advice failed' },
      { status: 500 },
    );
  }
}
