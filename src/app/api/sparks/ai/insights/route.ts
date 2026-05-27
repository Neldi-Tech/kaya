// Sparks AI · dashboard insights (server) — Claude Sonnet.
//
// Reads a snapshot of a kid's Sparks state (counts per area, recent
// ratings, latest item titles) and returns four short cards the
// dashboard renders verbatim:
//
//   Strength  — what's working (e.g. "Mathematics has averaged 4.6 ⭐
//               over the last 6 ratings")
//   Watch     — what's slipping (e.g. "Handwriting dropped from 80% to
//               64% across the last 3 sessions")
//   Trend     — the longest-arc pattern (e.g. "Engineering captures
//               doubled this month — bridges, planes, LEGO builds")
//   Suggest   — one concrete next step (e.g. "Try the LEGO Architecture
//               set — Daniella's drawings keep going architectural")
//
// No images, no PII beyond first name + area counts. Output JSON shaped
// for the dashboard's <AiInsightsPanel>. Skips with { skipped: true }
// when ANTHROPIC_API_KEY is missing.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface InsightsBody {
  kidName: string;
  /** YYYY-MM-DD range — passed for context, the model doesn't filter. */
  windowLabel: string;
  itemCountsByArea: Record<string, number>;
  recentRatings: Array<{
    date: string;
    area: string;
    title: string;
    stars?: number;
    percent?: number;
    notes?: string;
  }>;
  recentItemTitles: Array<{ area: string; title: string; date: string }>;
  academicSnapshot: Array<{
    term: string;
    year: number;
    subjects: Array<{ name: string; grade?: string; percent?: number }>;
  }>;
}

const SYSTEM = `You are the AI companion in Kaya Sparks, the kids-education module of a family app. You read a JSON snapshot of one child's Sparks state — area counts, recent ratings, latest item titles, latest term grades — and return FOUR short insight cards for the parent dashboard.

Return JSON: {
  "strength": { "title": string, "body": string },   // What's working — celebrate something specific.
  "watch":    { "title": string, "body": string },   // What's slipping or needs attention — gentle, evidence-based.
  "trend":    { "title": string, "body": string },   // A longer-arc pattern — emerging talent, recurring theme.
  "suggest":  { "title": string, "body": string }    // One concrete next step — activity, conversation, follow-up.
}

Rules:
- "title" is 3-6 words, sentence case.
- "body" is 1-2 sentences, ≤ 220 chars. Specific. Reference real numbers / titles from the snapshot when possible.
- Tone: warm but precise. Never gushing. No emojis in the strings.
- When there's not enough data for a card, return a gentle placeholder body ("Not enough ratings yet — capture a few more home projects to spot a trend.") rather than inventing.
- Use the child's first name once across the whole response, not per card.`;

const SCHEMA = {
  type: 'object',
  properties: {
    strength: cardSchema(),
    watch:    cardSchema(),
    trend:    cardSchema(),
    suggest:  cardSchema(),
  },
  required: ['strength', 'watch', 'trend', 'suggest'],
  additionalProperties: false,
} as const;

function cardSchema() {
  return {
    type: 'object',
    properties: {
      title: { type: 'string' },
      body:  { type: 'string' },
    },
    required: ['title', 'body'],
    additionalProperties: false,
  } as const;
}

const EMPTY = {
  strength: { title: 'Strength', body: 'Capture a few more items + ratings so insights have something to read.' },
  watch:    { title: 'Watch',    body: 'Nothing flagged yet.' },
  trend:    { title: 'Trend',    body: 'Patterns appear after 2-3 weeks of data.' },
  suggest:  { title: 'Suggest',  body: 'Start by rating recent Home Projects — the dashboard fills in fast.' },
};

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: InsightsBody;
  try {
    body = (await req.json()) as InsightsBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const totalSignal =
    Object.values(body.itemCountsByArea || {}).reduce((s, n) => s + (n || 0), 0)
    + (body.recentRatings?.length ?? 0)
    + (body.academicSnapshot?.length ?? 0);
  if (totalSignal === 0) return NextResponse.json(EMPTY);

  // Cap payload so we don't accidentally ship a huge ratings backlog.
  const payload = {
    ...body,
    recentRatings: (body.recentRatings ?? []).slice(0, 30),
    recentItemTitles: (body.recentItemTitles ?? []).slice(0, 30),
    academicSnapshot: (body.academicSnapshot ?? []).slice(0, 6),
  };

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Snapshot for ${body.kidName} · window: ${body.windowLabel}` },
            { type: 'text', text: '```json\n' + JSON.stringify(payload) + '\n```' },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json(EMPTY);
    return NextResponse.json(JSON.parse(text.text));
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Insights failed' },
      { status: 500 },
    );
  }
}
