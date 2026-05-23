// Moments · ✨ event-tag suggestion (server, 2026-05-23).
//
// Given a caption + the family's existing tags, returns ONE short event
// tag — preferring an existing tag when it fits, otherwise proposing a
// new {emoji,label}. Mirrors /api/catalogue-suggest's trust + fallback
// model: no-ops cleanly when ANTHROPIC_API_KEY is missing so the picker
// still works (just without the ✨ suggestion). Uses Haiku — the task is
// tiny, so we keep it fast + cheap (one small call per tap).

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface SuggestBody {
  caption: string;
  tags?: { emoji: string; label: string }[];
}

const SYSTEM = `You pick ONE short "event tag" for a family photo, from its caption.

Return:
- "emoji": a single emoji that fits the moment.
- "label": a 1-2 word Title Case label, max 18 chars (e.g. "First Day", "Beach", "Sports Day", "Sleepover").
- "matchedExisting": true if your label matches one of the family's existing tags (case-insensitive), else false.

PREFER one of the family's existing tags when it genuinely fits — reusing keeps their set tight. Only invent a new tag when none fit. Be concrete and warm; never explain, never add punctuation.`;

const SCHEMA = {
  type: 'object',
  properties: {
    emoji: { type: 'string' },
    label: { type: 'string' },
    matchedExisting: { type: 'boolean' },
  },
  required: ['emoji', 'label', 'matchedExisting'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: SuggestBody;
  try {
    body = (await req.json()) as SuggestBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const caption = (body?.caption || '').trim().slice(0, 500);
  const tags = Array.isArray(body?.tags)
    ? body.tags.filter((t) => t && typeof t.label === 'string').slice(0, 24)
    : [];

  if (!caption) return NextResponse.json({ error: 'Missing caption' }, { status: 400 });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Caption: "${caption}"\n\nExisting tags: ${tags.length ? tags.map((t) => `${t.emoji} ${t.label}`).join(', ') : '(none yet)'}\n\nSuggest one tag.`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No suggestion returned' }, { status: 502 });
    }

    const parsed = JSON.parse(text.text) as { emoji?: string; label?: string; matchedExisting?: boolean };
    const label = (parsed.label || '').trim().slice(0, 18);
    if (!label) return NextResponse.json({ error: 'No suggestion returned' }, { status: 502 });

    return NextResponse.json({
      suggestion: {
        emoji: (parsed.emoji || '✨').trim() || '✨',
        label,
        matchedExisting: !!parsed.matchedExisting,
      },
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Suggestion failed' },
      { status: 500 },
    );
  }
}
