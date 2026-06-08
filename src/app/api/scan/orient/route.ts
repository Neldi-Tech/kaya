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

const SYSTEM = `You are given a photo of a document/page (certificate, worksheet, report, receipt). Tell the software how to rotate it so the TEXT reads upright, left-to-right.

Return JSON: { "rotate": 0 | 90 | 180 | 270 }

- "rotate" is the number of degrees CLOCKWISE to apply so the writing is the right way up.
- 0   = already upright.
- 90  = the page is currently rotated 90° counter-clockwise (text runs bottom-to-top) → rotate 90° clockwise to fix.
- 180 = upside down.
- 270 = the page is currently rotated 90° clockwise (text runs top-to-bottom) → rotate 270° clockwise to fix.
- Judge by the printed/handwritten text direction (and logos/headings). If unsure, return 0.`;

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
