// Kaya Business · AI business drafter (server). The "Create with Kaya AI" flow:
// a child types one line ("Nathan's Produce — selling fresh veg from our
// garden") and Kaya drafts a ready-to-tweak business — best type, a
// standardized name + mission + emoji, and a few starter products (each with a
// standardized name, a sensible unit, and a starter price the child can edit).
// A second mode suggests MORE products for an existing draft.
//
// The drafter only PROPOSES — nothing is written here; the New Business screen
// turns an accepted draft into the actual createBusiness() call. Trust +
// fallback like the coach: no-ops cleanly when ANTHROPIC_API_KEY is missing, so
// the screen still works (manual entry) without AI.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type Mode = 'draft' | 'suggest';

interface DraftBody {
  mode?: Mode;
  /** The child's free-text idea (draft mode). */
  idea?: string;
  /** Context for 'suggest' mode. */
  name?: string;
  type?: string;
  /** Product names the child already has — so suggestions don't repeat. */
  existing?: string[];
  currency?: string;
  coachName?: string;
}

const ALLOWED_TYPES = ['goods', 'service', 'adhoc'] as const;

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    unit: { type: 'string' },
    price: { type: 'number' },
  },
  required: ['name', 'unit', 'price'],
  additionalProperties: false,
} as const;

const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    type: { type: 'string', enum: ALLOWED_TYPES },
    name: { type: 'string' },
    mission: { type: 'string' },
    emoji: { type: 'string' },
    message: { type: 'string' },
    products: { type: 'array', items: PRODUCT_SCHEMA },
  },
  required: ['type', 'name', 'mission', 'emoji', 'message', 'products'],
  additionalProperties: false,
} as const;

const SUGGEST_SCHEMA = {
  type: 'object',
  properties: { products: { type: 'array', items: PRODUCT_SCHEMA } },
  required: ['products'],
  additionalProperties: false,
} as const;

const SYSTEM = `You help a CHILD start a tiny real micro-business inside the Kaya family app. From a one-line idea, you draft something they can run and tweak — you make the blank page easy.

How to draft:
- Pick the best TYPE: "goods" = sells physical things you keep stock of (produce, eggs, crafts, baked goods); "service" = does a job for people (car wash, dog walking, tutoring); "adhoc" = a one-off gig.
- Give a short, clear NAME (Title Case), a one-line MISSION, and ONE friendly emoji.
- List starter PRODUCTS: 3 for goods; 1-2 offerings for service/adhoc.
  • name: a STANDARDIZED, commonly-understood product name a kid would recognize — "Tomatoes", "Spinach", "Carrots", "Car wash" — not cute or vague ("my red ones").
  • unit: how it's sold — one short common unit like kg, g, bunch, dozen, pcs, litre, pack, box, plate, cup, wash, session, hour, job.
  • price: a SENSIBLE STARTER price per unit in the family's currency (a round, plausible number — the child WILL edit it).

Hard rules:
- Kid-level words. Warm, encouraging, specific. Never shame.
- Standardized names so a child is inspired and others understand them.
- Geographically + region neutral — no country framing, no real brands or shops.
- "message" is one warm sentence the coach says about the draft (plain text, no markdown).`;

interface RawProduct { name?: unknown; unit?: unknown; price?: unknown }

function cleanProducts(raw: unknown, max = 8): Array<{ name: string; unit: string; priceCents: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ name: string; unit: string; priceCents: number }> = [];
  for (const r of raw as RawProduct[]) {
    const name = typeof r?.name === 'string' ? r.name.trim().slice(0, 50) : '';
    if (!name) continue;
    const unit = typeof r?.unit === 'string' ? r.unit.trim().slice(0, 20) : '';
    const priceNum = typeof r?.price === 'number' && Number.isFinite(r.price) ? r.price : 0;
    const priceCents = priceNum > 0 ? Math.round(priceNum * 100) : 0;
    out.push({ name, unit, priceCents });
    if (out.length >= max) break;
  }
  return out;
}

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: DraftBody;
  try {
    body = (await req.json()) as DraftBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const mode: Mode = body?.mode === 'suggest' ? 'suggest' : 'draft';
  const currency = (body.currency || 'USD').trim().slice(0, 8);
  const coachName = (body.coachName || 'Kaya Coach').trim().slice(0, 40);

  if (mode === 'draft') {
    const idea = (body.idea || '').trim().slice(0, 280);
    if (!idea) return NextResponse.json({ error: 'Tell Kaya your idea first.' }, { status: 400 });

    try {
      const response = await client.messages.create({
        model: 'claude-opus-4-7',
        max_tokens: 900,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
        messages: [{
          role: 'user',
          content: `Your name is "${coachName}". Family currency: ${currency}.
Draft a tiny business for this child's idea:
"${idea}"`,
        }],
      });
      const text = response.content.find((b) => b.type === 'text');
      if (!text || text.type !== 'text') return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
      const p = JSON.parse(text.text) as Record<string, unknown>;
      const type = ALLOWED_TYPES.includes(p.type as typeof ALLOWED_TYPES[number]) ? (p.type as string) : 'goods';
      return NextResponse.json({
        type,
        name: (typeof p.name === 'string' ? p.name : '').trim().slice(0, 50),
        mission: (typeof p.mission === 'string' ? p.mission : '').trim().slice(0, 140),
        emoji: (typeof p.emoji === 'string' ? p.emoji : '').trim().slice(0, 4),
        message: (typeof p.message === 'string' ? p.message : '').trim().slice(0, 280),
        products: cleanProducts(p.products),
      });
    } catch (e: unknown) {
      if (e instanceof Anthropic.APIError) return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Draft failed' }, { status: 500 });
    }
  }

  // suggest mode
  const name = (body.name || '').trim().slice(0, 50);
  const type = ALLOWED_TYPES.includes(body.type as typeof ALLOWED_TYPES[number]) ? (body.type as string) : 'goods';
  const existing = Array.isArray(body.existing)
    ? body.existing.filter((s) => typeof s === 'string' && s.trim()).slice(0, 30).map((s) => s.trim())
    : [];
  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SUGGEST_SCHEMA } },
      messages: [{
        role: 'user',
        content: `Your name is "${coachName}". Family currency: ${currency}.
Suggest 3 MORE products that fit this ${type} business${name ? ` ("${name}")` : ''}.
Already added (do NOT repeat these): ${existing.length ? existing.join(', ') : '(none yet)'}
Return only the new products with standardized names, a unit, and a starter price in ${currency}.`,
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ error: 'No suggestions returned' }, { status: 502 });
    const p = JSON.parse(text.text) as Record<string, unknown>;
    const have = new Set(existing.map((s) => s.toLowerCase()));
    const products = cleanProducts(p.products, 6).filter((pr) => !have.has(pr.name.toLowerCase()));
    return NextResponse.json({ products });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Suggest failed' }, { status: 500 });
  }
}
