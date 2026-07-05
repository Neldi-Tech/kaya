// Service-card / sticker scanning (server) — Claude vision (Drivers
// v2.2, 2026-07-05).
//
// Workshops hand back a card or windshield sticker with the NEXT
// service written on it — usually the odometer ("NEXT SERVICE:
// 95,000 KM"), often a date too. This route reads a photo and
// extracts those numbers so the parent taps 📷 instead of typing.
// A human ALWAYS reviews before save (the client pre-fills the 🎯
// fields; nothing writes to the vehicle without the Save tap).
//
// Mirrors /api/receipt-scan's trust model: no-ops ({ skipped: true })
// when ANTHROPIC_API_KEY is missing; base64 image content block;
// strict JSON-schema output.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface ScanBody {
  imageBase64: string;
  mediaType?: string;
}

const SYSTEM = `You read a photo of a VEHICLE SERVICE reminder — a workshop service card, windshield/door-jamb sticker, service-book stamp, or garage invoice footer — and extract when the NEXT service is due.

Return:
- "nextServiceOdo": the NEXT-service odometer reading as a plain number (e.g. 95000), or 0 if not shown. This is usually labelled "next service", "next oil change", "huduma ijayo", or is the larger odometer figure on the sticker.
- "odoUnit": "km" or "mi" if the sticker states the unit, else "".
- "nextServiceDate": the NEXT-service due date normalized to YYYY-MM-DD, or "" if not shown. Interpret ambiguous day/month order using context (many stickers are DD/MM/YYYY outside the US); if the year is 2-digit, assume 20xx.
- "serviceDoneOdo": the odometer AT the service just done, as a plain number, or 0 if not shown (some stickers print both "at" and "next").

Rules:
- Numbers only — no separators, units, or symbols inside the number fields.
- If both an "at service" and a "next service" odometer appear, nextServiceOdo MUST be the larger/next one.
- If the image is not a readable service card/sticker, return zeros and "".
- Never invent values you cannot actually read.`;

const SCHEMA = {
  type: 'object',
  properties: {
    nextServiceOdo: { type: 'number' },
    odoUnit: { type: 'string' },
    nextServiceDate: { type: 'string' },
    serviceDoneOdo: { type: 'number' },
  },
  required: ['nextServiceOdo', 'odoUnit', 'nextServiceDate', 'serviceDoneOdo'],
  additionalProperties: false,
} as const;

const EMPTY = { nextServiceOdo: 0, odoUnit: '', nextServiceDate: '', serviceDoneOdo: 0 };

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
  if (!imageBase64) return NextResponse.json(EMPTY);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Read this vehicle service card / sticker.' },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json(EMPTY);

    const parsed = JSON.parse(text.text) as {
      nextServiceOdo?: number; odoUnit?: string; nextServiceDate?: string; serviceDoneOdo?: number;
    };
    const dateRaw = String(parsed.nextServiceDate || '').trim();
    return NextResponse.json({
      nextServiceOdo: Math.max(0, Math.round(Number(parsed.nextServiceOdo) || 0)),
      odoUnit: parsed.odoUnit === 'km' || parsed.odoUnit === 'mi' ? parsed.odoUnit : '',
      nextServiceDate: /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : '',
      serviceDoneOdo: Math.max(0, Math.round(Number(parsed.serviceDoneOdo) || 0)),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json({ error: 'Service-card scan failed' }, { status: 500 });
  }
}
