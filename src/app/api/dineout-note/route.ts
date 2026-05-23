// Dine Out · AI note helper (server).
//
// Helps a parent write the short note ("occasion") on a Dine Out log —
// either polishing a draft they started or suggesting one from the
// context (venue, what they ate / liked, rating). Keeps it short + warm,
// in a family's own voice — this is a keepsake line, not a review.
//
// Mirrors /api/venue-search: no-ops (returns { skipped: true }) when
// ANTHROPIC_API_KEY is missing, and uses Haiku (light, latency-sensitive).

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface NoteBody {
  venue?: string;
  highlights?: string[];
  stars?: number;
  tag?: string;       // DineOutCategory label, e.g. "Restaurant"
  draft?: string;     // what the parent has typed so far (optional)
}

const SYSTEM = `You help a parent write a SHORT note for a family "dine out" memory log. It is a warm keepsake line they will read back later — not a restaurant review.

Rules:
- Return ONE short note, max ~12 words. No quotes around it. At most one emoji, usually none.
- Warm, natural, first-person family voice (e.g. "Birthday brunch — the kids loved the pancakes").
- If the parent gave a draft, gently polish it (fix wording, keep their meaning + voice). Do NOT change facts or invent details they didn't give.
- If there is no draft, suggest a note from the venue + what they ate/liked + rating.
- Never invent specific facts (people's names, exact dishes) that weren't provided.`;

const SCHEMA = {
  type: 'object',
  properties: { note: { type: 'string' } },
  required: ['note'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: NoteBody;
  try {
    body = (await req.json()) as NoteBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const venue = (body?.venue || '').trim().slice(0, 60);
  const draft = (body?.draft || '').trim().slice(0, 120);
  const tag = (body?.tag || '').trim().slice(0, 30);
  const stars = typeof body?.stars === 'number' ? Math.max(0, Math.min(5, Math.round(body.stars))) : 0;
  const highlights = Array.isArray(body?.highlights)
    ? body.highlights.map((h) => String(h).trim()).filter(Boolean).slice(0, 6)
    : [];

  // Need at least *some* context to write from.
  if (!venue && !draft && highlights.length === 0) {
    return NextResponse.json({ note: '' });
  }

  const ctx = [
    venue ? `Place: ${venue}` : '',
    tag ? `Type: ${tag}` : '',
    stars ? `Rating: ${stars}/5 stars` : '',
    highlights.length ? `Ate / liked: ${highlights.join(', ')}` : '',
    draft ? `Parent's draft to polish: "${draft}"` : 'No draft — suggest one.',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 120,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: ctx }],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ note: '' });
    }
    const parsed = JSON.parse(text.text) as { note: string };
    const note = (parsed.note || '').trim().replace(/^["']|["']$/g, '').slice(0, 80);
    return NextResponse.json({ note });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Note help failed' },
      { status: 500 },
    );
  }
}
