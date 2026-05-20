// AI translation helper for the product catalogue.
//
// Given a list of English staple names + the family's local language
// (e.g. "Swahili"), returns the everyday native word for each — used to
// fill the optional `name2` field shown to helpers in their own language.
//
// Safe to ship before the key is configured: if ANTHROPIC_API_KEY is
// missing the route returns a no-op so the staples form keeps working
// (the parent can still type the local name by hand).
//
// v1 trust model matches /api/notify: small private family product, we
// trust the client and cap the batch size. Tighten with a Firebase ID
// token check in v2.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const MAX_NAMES = 100;

interface TranslateBody {
  names: string[];
  language: string;
}

const SYSTEM = `You translate grocery and household shopping-list item names into a target language for a family budgeting app.

Rules:
- Return the COMMON, everyday word a shopper would actually say in that language — not a literal, clinical, or scientific term.
- Keep it short: just the item name, no articles, no explanation.
- Preserve the singular/plural feel of the English term.
- If a term has no natural equivalent (e.g. a specific brand), return the English term unchanged.
- Translate every item you are given.`;

const SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          english: { type: 'string' },
          native: { type: 'string' },
        },
        required: ['english', 'native'],
        additionalProperties: false,
      },
    },
  },
  required: ['translations'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: TranslateBody;
  try {
    body = (await req.json()) as TranslateBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const language = (body?.language || '').trim();
  const names = Array.isArray(body?.names)
    ? Array.from(new Set(
        body.names
          .filter((n) => typeof n === 'string')
          .map((n) => n.trim())
          .filter(Boolean),
      )).slice(0, MAX_NAMES)
    : [];

  if (!language) {
    return NextResponse.json({ error: 'Missing target language' }, { status: 400 });
  }
  if (names.length === 0) {
    return NextResponse.json({ translations: {} });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 2000,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Target language: ${language}\n\nTranslate these items:\n${names.map((n) => `- ${n}`).join('\n')}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No translation returned' }, { status: 502 });
    }

    const parsed = JSON.parse(text.text) as { translations: { english: string; native: string }[] };
    const map: Record<string, string> = {};
    for (const t of parsed.translations ?? []) {
      if (t?.english && t?.native) map[t.english] = t.native;
    }
    return NextResponse.json({ translations: map });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Translation failed' },
      { status: 500 },
    );
  }
}
