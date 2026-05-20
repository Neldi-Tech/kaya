// Master Catalogue v2 · Phase 2 — AI country enrichment (server).
//
// Given catalogue items + a country + language, returns the everyday
// local/native name AND the brands a shopper in that country would
// recognise, for each item. Powers the "going global" engine: any
// item, any country gets localised on demand + cached on the catalogue.
//
// Mirrors /api/translate's trust + fallback model: no-ops when
// ANTHROPIC_API_KEY is missing so the catalogue still works (curated /
// English-only). Caps the batch size.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const MAX_ITEMS = 40;

interface SuggestBody {
  items: { id: string; globalName: string }[];
  country: string;   // ISO alpha-2
  language: string;  // free-text label, e.g. "Swahili"
}

const SYSTEM = `You localise grocery / household / vehicle / outdoor shopping items for a family budgeting app, for a specific country.

For each item, return:
- "localName": the COMMON everyday word a shopper in that country would actually say (in the given language). Short — just the item name, no articles, no explanation. If there is no natural local word (or the language is English), return the English name unchanged.
- "brands": up to 4 brand names a shopper in THAT country would actually recognise + buy for this item, most-common first. Real, locally-sold brands only. If you are not confident about real local brands, return an empty array — do NOT invent brands.

Be accurate and conservative. Wrong brands are worse than no brands.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          localName: { type: 'string' },
          brands: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'localName', 'brands'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
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

  const country = (body?.country || '').trim();
  const language = (body?.language || 'English').trim();
  const items = Array.isArray(body?.items)
    ? body.items
        .filter((i) => i && typeof i.id === 'string' && typeof i.globalName === 'string')
        .slice(0, MAX_ITEMS)
    : [];

  if (!country) return NextResponse.json({ error: 'Missing country' }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ suggestions: {} });

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 4000,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Country: ${country}\nLanguage: ${language}\n\nLocalise these items (return the same id for each):\n${items.map((i) => `- [${i.id}] ${i.globalName}`).join('\n')}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No suggestions returned' }, { status: 502 });
    }

    const parsed = JSON.parse(text.text) as {
      items: { id: string; localName: string; brands: string[] }[];
    };
    const suggestions: Record<string, { localName?: string; brands?: string[] }> = {};
    for (const it of parsed.items ?? []) {
      if (!it?.id) continue;
      suggestions[it.id] = {
        localName: it.localName?.trim() || undefined,
        brands: Array.isArray(it.brands) ? it.brands.filter(Boolean).slice(0, 4) : undefined,
      };
    }
    return NextResponse.json({ suggestions });
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
