// Receipt scanning (server) — Claude Sonnet vision.
//
// Reads a photo of a receipt and extracts its line items (name · qty ·
// unit price) + the grand total, so a parent can snap instead of type.
// A human ALWAYS reviews before save (the client enforces this) — the
// model never writes to a request directly.
//
// Mirrors the trust model of /api/venue-search: no-ops (returns
// { skipped: true }) when ANTHROPIC_API_KEY is missing. First vision call
// in the app — the image is sent as a base64 content block.
//
// Amounts come back as PLAIN NUMBERS in the receipt's currency (e.g.
// 18000 or 12.50); the client multiplies by 100 to get the cents Kaya
// stores. We never trust the model's currency for storage — the family's
// currency governs; the returned `currency` is only a sanity hint.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60; // vision can take a few seconds on big receipts

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface ScanBody {
  imageBase64: string;
  mediaType?: string;
  currency?: string; // family currency, for context only
}

const SYSTEM = `You read a photo of a shopping / restaurant / service receipt for a family budgeting app and extract its line items plus the grand total.

Return:
- "items": one entry per purchased line — { "name": the item name as printed (lightly cleaned), "qty": quantity as a number (1 if not shown), "unitPrice": the PER-UNIT price as a plain number in the receipt's currency }.
- "total": the grand total actually paid, as a plain number in the same currency.
- "currency": the ISO code if you can tell (e.g. "TZS", "USD", "AED"), else "".

Rules:
- Keep DECIMAL quantities for weighed/measured items exactly as printed (e.g. 0.23 kg, 1.5 L, 0.5 dozen) — NEVER round a fractional quantity up to a whole number.
- Prices are PER UNIT. If a line shows a line-total for qty > 1, divide to get the unit price.
- Numbers only for qty / unitPrice / total — NEVER include currency symbols, spaces, or thousands separators. Use a decimal point only if the receipt shows decimals.
- EXCLUDE non-item lines from "items" (subtotal, tax/VAT, service charge, change, rounding, loyalty) — but "total" must still be the final amount paid.
- If the image is not a readable receipt, return empty items and total 0.
- Never invent items or prices you cannot actually read.`;

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          qty: { type: 'number' },
          unitPrice: { type: 'number' },
        },
        required: ['name', 'qty', 'unitPrice'],
        additionalProperties: false,
      },
    },
    total: { type: 'number' },
    currency: { type: 'string' },
  },
  required: ['items', 'total', 'currency'],
  additionalProperties: false,
} as const;

const EMPTY = { items: [], total: 0, currency: '' };

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: ScanBody;
  try {
    body = (await req.json()) as ScanBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const currency = (body?.currency || '').trim().slice(0, 8);
  if (!imageBase64) return NextResponse.json(EMPTY);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: currency ? `The family's currency is ${currency} — read this receipt.` : 'Read this receipt.' },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json(EMPTY);

    const parsed = JSON.parse(text.text) as {
      items?: { name?: string; qty?: number; unitPrice?: number }[];
      total?: number;
      currency?: string;
    };
    const items = (parsed.items ?? [])
      .filter((i) => i && typeof i.name === 'string' && i.name.trim())
      .map((i) => {
        // Preserve decimal quantities (0.23 kg, 1.5 L); round only float
        // noise to 3 dp. Fall back to 1 when missing/invalid, never force ≥1.
        const q = Number(i.qty);
        return {
          name: i.name!.trim().slice(0, 60),
          qty: q > 0 ? Math.round(q * 1000) / 1000 : 1,
          unitPrice: Math.max(0, Number(i.unitPrice) || 0),
        };
      })
      .slice(0, 60);
    return NextResponse.json({
      items,
      total: Math.max(0, Number(parsed.total) || 0),
      currency: String(parsed.currency || '').trim().slice(0, 8),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Receipt scan failed' },
      { status: 500 },
    );
  }
}
