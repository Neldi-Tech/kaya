// Sparks AI · describe a parent's uploaded study material — Claude
// Sonnet vision.
//
// Distinct from /api/sparks/ai/describe (which describes the CHILD's
// work). Materials are PARENT-uploaded reference docs the kids will
// study FROM. Tone shifts accordingly — clear, factual, with a hint
// of "when to use this" for the parent's note to the kid.
//
// Up to 4 photos · returns a single 1–3 sentence description the
// parent can edit before saving. Skipped path matches the rest of the
// /api/sparks/ai/* family when ANTHROPIC_API_KEY is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface DescribeMaterialBody {
  imageBase64s?: string[];
  mediaType?: string;
  title?: string;
  subject?: string;
  /** Names of kids this material is for ("Earlnathan, Diella"). */
  kidNames?: string[];
}

const SYSTEM = `You write a short, friendly description of a study material a PARENT is uploading for their child(ren) in Kaya Sparks Home Practice. The description ends up in a "Description" field the parent can edit before saving.

Return JSON: { "description": string }

Rules:
- 1–3 sentences. Plain English. Friendly + factual.
- Describe what the material is (e.g. "Grade 4 long-division worksheet"), and add a brief "when to use this" hint when natural (e.g. "Good for Friday practice").
- If the photos look like a worksheet, mention what it covers.
- If they look like notes / a study guide / a textbook page, label that.
- Reference the subject or kid names only when they help. Don't pile names on.
- Keep it short — this is a label, not a summary.
- Never invent dates, page numbers, or instructions you can't read.`;

const SCHEMA = {
  type: 'object',
  properties: { description: { type: 'string' } },
  required: ['description'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: DescribeMaterialBody;
  try {
    body = (await req.json()) as DescribeMaterialBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const images = (body?.imageBase64s ?? []).filter((s) => typeof s === 'string' && s.length > 0).slice(0, 4);
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const title = (body?.title || '').trim().slice(0, 200);
  const subject = (body?.subject || '').trim().slice(0, 60);
  const kidNames = (body?.kidNames ?? []).filter((n) => typeof n === 'string').slice(0, 6);

  if (images.length === 0) {
    return NextResponse.json({ error: 'No images provided · upload an image-mode material to use AI describe.' }, { status: 400 });
  }

  const context = [
    title    ? `Title: ${title}` : '',
    subject  ? `Subject: ${subject}` : '',
    kidNames.length > 0 ? `For: ${kidNames.join(', ')}` : 'For: every kid in the family',
  ].filter(Boolean).join('\n');

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
            ...images.map((data) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: mediaType, data },
            })),
            { type: 'text' as const, text: context || 'Untitled material.' },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ description: '' });
    const parsed = JSON.parse(text.text) as { description?: string };
    return NextResponse.json({
      description: (parsed.description || '').trim().slice(0, 600),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Material describe failed' },
      { status: 500 },
    );
  }
}
