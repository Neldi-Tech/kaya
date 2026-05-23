// Dine Out · AI venue name search (server).
//
// A parent types a rough place name ("nandos", "the pizza place downtown")
// while logging a meal; this returns up to 3 normalised candidates with
// the correct global/official spelling + a cuisine emoji + a one-word
// cuisine tag, so the saved venue (and its Diamond reputation) carries a
// clean, consistent name.
//
// Mirrors /api/catalogue-suggest's trust model: no-ops (returns
// { skipped: true }) when ANTHROPIC_API_KEY is missing so the page still
// works as a plain text field. Haiku — this is a light, latency-sensitive
// normalisation, not a reasoning task.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const MAX_QUERY_LEN = 80;

interface SearchBody {
  query: string;
  country?: string; // optional ISO alpha-2 to bias toward local chains
}

const SYSTEM = `You normalise the name of a restaurant, café, hotel, bar or food place that a parent typed into a family budgeting app, so it is saved with its correct, well-known name.

Return up to 3 candidates, best match first. For each:
- "name": the proper, officially-branded name with correct casing (e.g. "nandos" -> "Nando's", "kfc" -> "KFC", "mcdonalds" -> "McDonald's", "starbux" -> "Starbucks"). Keep it the globally recognised name.
- "emoji": ONE emoji that best represents the place's food or type (🍕 🍔 🍣 ☕️ 🍗 🍜 🌮 🏨 🍦 🥐 🍺 🍽️). Use 🍽️ only if nothing fits.
- "cuisine": ONE lowercase word for the type (e.g. "pizza", "burgers", "sushi", "coffee", "chicken", "indian", "hotel", "bakery").

Rules:
- If the input is already a clear, specific name, return it normalised as the top candidate.
- Prefer real, well-known places. Do NOT invent obscure places. If you cannot confidently identify a real place, return a single candidate that is just the user's text cleaned up (trimmed, sensible capitalisation) with a best-guess emoji.
- Never return more than 3.`;

const SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          emoji: { type: 'string' },
          cuisine: { type: 'string' },
        },
        required: ['name', 'emoji', 'cuisine'],
        additionalProperties: false,
      },
    },
  },
  required: ['candidates'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: SearchBody;
  try {
    body = (await req.json()) as SearchBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const queryText = (body?.query || '').trim().slice(0, MAX_QUERY_LEN);
  const country = (body?.country || '').trim().slice(0, 2);
  if (queryText.length < 2) return NextResponse.json({ candidates: [] });

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `Parent typed: "${queryText}"${country ? `\nThey are in country (ISO): ${country} — prefer chains/places known there if relevant.` : ''}`,
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ candidates: [] });
    }

    const parsed = JSON.parse(text.text) as {
      candidates: { name: string; emoji: string; cuisine: string }[];
    };
    const candidates = (parsed.candidates ?? [])
      .filter((c) => c && typeof c.name === 'string' && c.name.trim())
      .slice(0, 3)
      .map((c) => ({
        name: c.name.trim().slice(0, 60),
        emoji: (c.emoji || '🍽️').trim().slice(0, 4) || '🍽️',
        cuisine: (c.cuisine || '').trim().toLowerCase().slice(0, 20),
      }));
    return NextResponse.json({ candidates });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Search failed' },
      { status: 500 },
    );
  }
}
