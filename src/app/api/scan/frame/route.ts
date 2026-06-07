// Kaya · Scanning 2.0 — AI document auto-framing (server).
//
// Claude Sonnet vision locates the dominant page in a photo and returns
// its 4 corners as fractions of the image (0..1) + a confidence score, so
// the CLIENT can perspective-warp the page flat and crop the background
// out BEFORE the OCR pass. This is the "detect the frame + reshape" step
// the old clean-only pipeline was missing.
//
// Mirrors /api/sparks/ai/extract + /api/receipt-scan: returns
// { skipped: true } (never an error that blocks a scan) when the key is
// absent or anything goes wrong — the client then falls back to the
// existing clean-only enhance, so a scan is never worse than before.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface FrameBody {
  imageBase64: string;
  mediaType?: string;
}

const SYSTEM = `You locate a single document/page in a photo so software can crop and flatten it.

The "document" is the dominant sheet of paper, worksheet, exam/question paper, certificate, report card, receipt, or printed/handwritten page in the photo.

Return JSON:
{
  "isDocument": boolean,        // true ONLY if a clear four-sided page is present
  "confidence": number,         // 0..1, how sure you are of the four corners
  "corners": {                  // the page's four corners as FRACTIONS of the image (0..1)
    "topLeft":     { "x": number, "y": number },
    "topRight":    { "x": number, "y": number },
    "bottomRight": { "x": number, "y": number },
    "bottomLeft":  { "x": number, "y": number }
  }
}

Rules:
- Follow the PAGE's physical edges, even if the page is rotated, tilted, or skewed — NOT the image border.
- x = horizontal fraction from the LEFT (0) to the RIGHT (1). y = vertical fraction from the TOP (0) to the BOTTOM (1).
- topLeft / topRight / bottomRight / bottomLeft are relative to how a human would read the page (its own orientation).
- If there is NO clear page (a 3D object, a scene, a screen, a face), set isDocument=false, confidence=0, and return the full image as corners: topLeft (0,0), topRight (1,0), bottomRight (1,1), bottomLeft (0,1).
- Never guess wildly. If one edge is partly out of frame, use the visible page boundary / image edge for that corner.`;

const PT = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y'],
  properties: { x: { type: 'number' }, y: { type: 'number' } },
} as const;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isDocument', 'confidence', 'corners'],
  properties: {
    isDocument: { type: 'boolean' },
    confidence: { type: 'number' },
    corners: {
      type: 'object',
      additionalProperties: false,
      required: ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'],
      properties: { topLeft: PT, topRight: PT, bottomRight: PT, bottomLeft: PT },
    },
  },
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: FrameBody;
  try {
    body = (await req.json()) as FrameBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  if (!imageBase64) {
    return NextResponse.json({ error: 'Missing imageBase64' }, { status: 400 });
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
            { type: 'text', text: 'Find the document and return its four corners.' },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      // Treat as "no document" — client falls back to clean-only.
      return NextResponse.json({ skipped: true, reason: 'no-text' });
    }
    return NextResponse.json(JSON.parse(text.text));
  } catch (e: unknown) {
    // Never block a scan: degrade to clean-only on the client.
    const msg = e instanceof Error ? e.message : 'frame failed';
    return NextResponse.json({ skipped: true, reason: msg });
  }
}
