// Subscription receipt parsing (server) — Claude Sonnet.
//
// Reads an App Store / Google Play / direct-service receipt — as a
// pasted email body (text) OR a screenshot/PDF-page image — and
// extracts the recurring subscriptions it describes, so a parent can
// scan instead of typing each one. A human ALWAYS reviews the result
// before anything is written (the client enforces this).
//
// Powers Phase 1 of the subscription auto-detect (2026-05-30). Phase 2
// (Gmail read-only connect) reuses this same parser server-side.
//
// Mirrors /api/receipt-scan: no-ops with { skipped: true } when
// ANTHROPIC_API_KEY is missing. Amounts come back as PLAIN NUMBERS in
// the receipt's currency; the client multiplies by 100 for cents.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface ScanBody {
  /** One of imageBase64 / text is required. */
  imageBase64?: string;
  mediaType?: string;
  text?: string;
  currency?: string; // family currency, for context only
}

const SYSTEM = `You read a receipt or billing email from the Apple App Store, Google Play, or a subscription service (Netflix, Spotify, YouTube, iCloud, a gym, a SaaS tool) for a family budgeting app, and extract the RECURRING subscriptions it describes so a parent doesn't have to type them.

Return JSON: {
  "subscriptions": [ one entry per distinct recurring subscription found:
    {
      "name":        the product / service name as printed (e.g. "Netflix Premium", "iCloud+ 200GB", "YouTube Premium"). 2-6 words, no store boilerplate.
      "amount":      the per-cycle price as a PLAIN number in the receipt currency (e.g. 9.99 or 1800). Numbers only — no symbols, spaces, or thousands separators.
      "currency":    ISO code if readable ("USD", "TZS", "AED", "KES"), else "".
      "cadence":     one of "monthly" | "annual" | "quarterly" | "weekly" | "semi_annual" | "one_off" — best fit from the receipt wording ("/month", "per year", "annual plan"). Default "monthly" when a recurring charge has no period.
      "platform":    "ios" if it's an Apple receipt, "android" if Google Play, else "web".
      "nextBilling": next renewal date as ISO "YYYY-MM-DD" if the receipt states one, else "".
      "vendor":      the billing vendor if distinct from name (e.g. "Apple", "Google"), else "".
    }
  ]
}

Rules:
- ONLY include recurring subscriptions. EXCLUDE one-off app purchases, in-app consumables, taxes, and order totals.
- If a single receipt lists several subs (an Apple monthly statement often does), return one entry each.
- Never invent a subscription, price, or date you cannot actually read.
- If the input isn't a recognisable receipt / billing email, return an empty list.`;

const SCHEMA = {
  type: 'object',
  properties: {
    subscriptions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          currency: { type: 'string' },
          cadence: { type: 'string', enum: ['monthly', 'annual', 'quarterly', 'weekly', 'semi_annual', 'one_off'] },
          platform: { type: 'string', enum: ['ios', 'android', 'web'] },
          nextBilling: { type: 'string' },
          vendor: { type: 'string' },
        },
        required: ['name', 'amount', 'currency', 'cadence', 'platform', 'nextBilling', 'vendor'],
        additionalProperties: false,
      },
    },
  },
  required: ['subscriptions'],
  additionalProperties: false,
} as const;

const EMPTY = { subscriptions: [] };

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
  const text = (body?.text || '').trim().slice(0, 12000);
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const currency = (body?.currency || '').trim().slice(0, 8);
  if (!imageBase64 && !text) return NextResponse.json(EMPTY);

  const ctxLine = currency ? `The family's currency is ${currency}. ` : '';
  const userContent: Anthropic.MessageParam['content'] = imageBase64
    ? [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
        { type: 'text', text: `${ctxLine}Read this receipt image and extract the recurring subscriptions.` },
      ]
    : [
        { type: 'text', text: `${ctxLine}Here is a receipt / billing email. Extract the recurring subscriptions.\n\n---\n${text}\n---` },
      ];

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: userContent }],
    });

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') return NextResponse.json(EMPTY);

    const parsed = JSON.parse(block.text) as {
      subscriptions?: Array<Record<string, unknown>>;
    };
    const subscriptions = (parsed.subscriptions ?? [])
      .filter((s) => s && typeof s.name === 'string' && (s.name as string).trim())
      .map((s) => ({
        name: String(s.name).trim().slice(0, 80),
        amount: Math.max(0, Number(s.amount) || 0),
        currency: String(s.currency || '').trim().slice(0, 8),
        cadence: ['monthly', 'annual', 'quarterly', 'weekly', 'semi_annual', 'one_off'].includes(String(s.cadence))
          ? String(s.cadence)
          : 'monthly',
        platform: ['ios', 'android', 'web'].includes(String(s.platform)) ? String(s.platform) : 'web',
        nextBilling: /^\d{4}-\d{2}-\d{2}$/.test(String(s.nextBilling)) ? String(s.nextBilling) : '',
        vendor: String(s.vendor || '').trim().slice(0, 40),
      }))
      .slice(0, 30);
    return NextResponse.json({ subscriptions });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Receipt parse failed' },
      { status: 500 },
    );
  }
}
