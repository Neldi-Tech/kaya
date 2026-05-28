// Sparks AI · description seed (server) — Claude Sonnet vision.
//
// Looks at one or more photos of a kid's project / achievement /
// activity and drafts a warm, factual 1–3 sentence description the
// parent can edit before saving. Pulled in by the "✨ Help me
// describe" button on the CaptureSheet.
//
// Mirrors the trust model of /api/receipt-scan: no-ops with
// { skipped: true } when ANTHROPIC_API_KEY is missing (Vercel preview
// without the env var). Parent ALWAYS reviews + edits before save.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

type SparksArea = 'school_project' | 'home_project' | 'achievement' | 'sports_subscription';

interface DescribeBody {
  imageBase64s?: string[];
  mediaType?: string;
  area: SparksArea;
  kidName: string;
  title: string;
  subject?: string;
  date?: string; // YYYY-MM-DD
}

const SYSTEM_WITH_TITLE = `You write warm, factual 1–3 sentence descriptions of a child's school work / home project / achievement / activity for a family education app called Kaya Sparks. The description is a STARTING POINT a parent will edit.

Rules:
- 1–3 sentences. Plain English. Specific, not generic.
- Reference what you actually see in the photos (e.g. "watercolour", "model bridge with red supports", "Best in Mathematics certificate from St. Mary's").
- Celebratory but never gushing. No "amazing", "incredible", "wonderful" pile-ups.
- Avoid trite phrases like "absolutely loves" or "shows great promise".
- When the area is 'achievement', include the issuer / award name if visible.
- When the area is 'sports_subscription', describe the activity factually — venue, schedule cue, what's pictured.
- Use the kid's name once at most.
- Output JSON: { "description": string }.`;

// Slice 7h · "what is this image about?" variant. Fired when the kid
// has uploaded photos but hasn't typed a title yet, so the AI can
// propose a concept the kid will then ✓ confirm or ✏️ rewrite in
// their own words.
const SYSTEM_NO_TITLE = `You read 1–4 photos a child uploaded to Kaya Sparks and write a SHORT first guess at what the work is about. The child will either confirm your read or rewrite it in their own words — this is a thinking prompt, not the final caption.

Rules:
- 1 sentence. Plain English. Specific to what you see — don't generalise.
- Describe the SUBJECT of the image (what it is), not the child's feelings about it.
- E.g. "A watercolour sunset with mountains and a pink sky." / "A model bridge made of popsicle sticks with red triangular supports." / "A Best-in-Mathematics certificate from St. Mary's Primary."
- No flattery, no "amazing", no "wonderful".
- Use the kid's name at most once, only if it adds context.
- Output JSON: { "description": string }.`;

const SCHEMA = {
  type: 'object',
  properties: {
    description: { type: 'string' },
  },
  required: ['description'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: DescribeBody;
  try {
    body = (await req.json()) as DescribeBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const images = (body?.imageBase64s ?? []).filter((s) => typeof s === 'string' && s.length > 0).slice(0, 4);
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia)
    : 'image/jpeg';
  const area = body?.area;
  const kidName = (body?.kidName || '').trim().slice(0, 60) || 'the child';
  const title = (body?.title || '').trim().slice(0, 200);
  const subject = (body?.subject || '').trim().slice(0, 60);
  const date = (body?.date || '').trim().slice(0, 10);

  // Slice 7h · title is now optional. With a title we fall through to
  // the original "write a description AROUND the title" path; without,
  // we switch to the "what is this image about?" prompt so the kid
  // gets a confirm-or-rewrite chip on the capture sheet.
  if (!area) {
    return NextResponse.json({ error: 'Missing area' }, { status: 400 });
  }
  if (!title && images.length === 0) {
    return NextResponse.json({ error: 'Need title or at least one photo' }, { status: 400 });
  }

  const hasTitle = title.length > 0;
  const contextParts = [
    `Area: ${area}`,
    `Kid: ${kidName}`,
    hasTitle ? `Title: ${title}` : '(No title yet — propose what this image is about.)',
    subject ? `Subject: ${subject}` : '',
    date ? `Date: ${date}` : '',
    images.length === 0 ? '(No photos attached — write from the title + subject.)' : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: [{
        type: 'text',
        text: hasTitle ? SYSTEM_WITH_TITLE : SYSTEM_NO_TITLE,
        cache_control: { type: 'ephemeral' },
      }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: [
            ...images.map((data) => ({
              type: 'image' as const,
              source: { type: 'base64' as const, media_type: mediaType, data },
            })),
            { type: 'text' as const, text: contextParts },
          ],
        },
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ description: '' });
    const parsed = JSON.parse(text.text) as { description?: string };
    return NextResponse.json({
      description: (parsed.description || '').trim().slice(0, 800),
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Description failed' },
      { status: 500 },
    );
  }
}
