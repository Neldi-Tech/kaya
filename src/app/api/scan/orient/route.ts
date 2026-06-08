// Kaya · Scanning 2.0 — AI page-orientation (server).
//
// After the page is cropped + flattened, this tells the client how many
// degrees CLOCKWISE to rotate it so the text reads upright (a landscape
// certificate shot in portrait comes back sideways otherwise). Mirrors the
// other scan routes: returns { skipped:true } (→ no rotation) when the key
// is absent or anything fails, so a scan is never blocked.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 20;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface OrientBody { imageBase64: string; mediaType?: string }

const SYSTEM = `You decide how to rotate a scanned document/page (certificate, worksheet, report, receipt) so its TEXT reads upright, left-to-right.

Method: find the largest heading/title (and body lines), and determine which way the letters actually face. Base the answer on the TEXT direction — not the page shape.

Return JSON: { "rotate": 0 | 90 | 180 | 270 } — the degrees CLOCKWISE to apply so the writing is the right way up.
- 0   = text already reads normally, left-to-right.
- 90  = text currently runs BOTTOM-TO-TOP (you'd tilt your head left to read) → rotate 90° clockwise.
- 180 = text is upside-down.
- 270 = text currently runs TOP-TO-BOTTOM (you'd tilt your head right to read) → rotate 270° clockwise.

Important: a landscape certificate photographed in a portrait frame is almost always sideways — do NOT default to 0. Only answer 0 when the text genuinely reads normally. Decide confidently from the letter orientation.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['rotate'],
  properties: { rotate: { type: 'integer', enum: [0, 90, 180, 270] } },
} as const;

export async function POST(req: NextRequest) {
  if (!client) return NextResponse.json({ skipped: true, rotate: 0 });

  let body: OrientBody;
  try { body = (await req.json()) as OrientBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia) : 'image/jpeg';
  if (!imageBase64) return NextResponse.json({ error: 'Missing imageBase64' }, { status: 400 });

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 60,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Which way is up? Return the clockwise rotation to make the text upright.' },
        ],
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ skipped: true, rotate: 0 });
    const parsed = JSON.parse(text.text) as { rotate?: number };
    const rotate = [0, 90, 180, 270].includes(parsed?.rotate ?? 0) ? parsed.rotate : 0;
    return NextResponse.json({ rotate });
  } catch (e) {
    return NextResponse.json({ skipped: true, rotate: 0, reason: e instanceof Error ? e.message : 'orient failed' });
  }
}
