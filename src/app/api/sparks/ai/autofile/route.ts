// Kaya Sparks · AI Auto-File (server) — classify a scanned document into the
// right Sparks area + extract its details, so a scan can "file itself".
//
// Given a framed scan, returns { area, title, description, subject, date,
// confidence } — the parent/kid then confirms (always editable) and we
// create the Sparks item. Mirrors /api/sparks/ai/extract: no-ops with
// { skipped:true } when ANTHROPIC_API_KEY is missing.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type ImgMedia = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
const ALLOWED_MEDIA: ImgMedia[] = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

interface AutoFileBody { imageBase64: string; mediaType?: string; kidName?: string }

const SYSTEM = `You sort a child's scanned document into the right Sparks area and pull out its details, so it files itself.

Choose ONE area:
- "achievement"         — a certificate, award, medal, prize, or recognition.
- "school_project"      — schoolwork / a project / artwork done at school.
- "home_project"        — something the child made or did at home.
- "sports_subscription" — a sports club / academy / training enrolment or schedule.
- "revision"            — homework, a worksheet, a test/exam, or practice questions.

Return JSON: {
  "area": one of the five above,
  "title": short human title (e.g. "Kipchoge Award · Mile Run", "Term 2 Maths Test"),
  "description": one short sentence, or "",
  "subject": school subject if obvious (Maths/English/Science/…), else "",
  "date": ISO "YYYY-MM-DD" if a date is printed; else "",
  "confidence": 0..1
}

Rules:
- Pick the single best area. A certificate/award → achievement. A worksheet/test → revision.
- Keep the title short + specific; never invent text you can't read.
- date: only when clearly printed; partial like "June 2026" → "2026-06-01".`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['area', 'title', 'description', 'subject', 'date', 'confidence'],
  properties: {
    area: { type: 'string', enum: ['achievement', 'school_project', 'home_project', 'sports_subscription', 'revision'] },
    title: { type: 'string' },
    description: { type: 'string' },
    subject: { type: 'string' },
    date: { type: 'string' },
    confidence: { type: 'number' },
  },
} as const;

export async function POST(req: NextRequest) {
  if (!client) return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  let body: AutoFileBody;
  try { body = (await req.json()) as AutoFileBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const imageBase64 = (body?.imageBase64 || '').trim();
  const mediaType: ImgMedia = (ALLOWED_MEDIA as string[]).includes(body?.mediaType || '')
    ? (body!.mediaType as ImgMedia) : 'image/jpeg';
  if (!imageBase64) return NextResponse.json({ error: 'Missing imageBase64' }, { status: 400 });
  const kidName = (body?.kidName || '').trim().slice(0, 60);

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: kidName ? `This belongs to ${kidName}. File it.` : 'File this document.' },
        ],
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ skipped: true, reason: 'no-text' });
    return NextResponse.json(JSON.parse(text.text));
  } catch (e) {
    return NextResponse.json({ skipped: true, reason: e instanceof Error ? e.message : 'autofile failed' });
  }
}
