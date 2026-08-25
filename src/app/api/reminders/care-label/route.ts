// 💊 v5 — AI medicine-label read (approved Logic close #5: TRANSCRIPTION
// ONLY). The parent snaps the box/bottle; Kaya reads what is PRINTED —
// name, strength, pack size, printed instructions — into editable fields
// the parent confirms. Never dosage advice, never drug recommendations.
//
// Mirrors the Treasures cupboard vision gateway (Bearer ID token, base64
// in body, json_schema output). Every failure degrades to { found: false,
// reason } so the form simply stays manual — nothing blocks.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;

const ALLOWED_MEDIA = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
type ImgMedia = (typeof ALLOWED_MEDIA)[number];

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

const LABEL_SYSTEM = `You transcribe medicine packaging for a family app. Read ONLY what is printed on the label in the photo.

Rules:
- Transcribe faithfully: product name, strength (e.g. "250mg"), the count printed on the pack (e.g. "20 tablets" → 20), the pharmaceutical form, and any short printed instruction like "take with food" or "shake well".
- NEVER invent, infer, or suggest a dosage, schedule, or any medical advice. If it is not printed, leave it empty.
- If the photo is not a medicine label or is unreadable, return found = false.`;

const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['found', 'name', 'strength', 'form', 'packCount', 'instructions', 'withFood'],
  properties: {
    found: { type: 'boolean' },
    name: { type: 'string', description: 'Product name as printed, e.g. "Amoxicillin"' },
    strength: { type: 'string', description: 'As printed, e.g. "250mg" — empty if absent' },
    form: { type: 'string', enum: ['tablet', 'capsule', 'syrup', 'drops', 'inhaler', 'cream', 'other', ''] },
    packCount: { type: 'integer', description: 'Units printed on the pack (0 = not printed)' },
    instructions: { type: 'string', description: 'Short printed instruction, e.g. "take with food" — empty if none' },
    withFood: { type: 'boolean', description: 'True ONLY if the label literally says to take with food' },
  },
} as const;

export interface CareLabelRead {
  found: boolean;
  name?: string;
  strength?: string;
  form?: string;
  packCount?: number;
  instructions?: string;
  withFood?: boolean;
  reason?: string;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ found: false, reason: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }
  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string; role?: string } | undefined;
  if (!user?.familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  if (user.role && user.role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const imageBase64 = str(body.imageBase64, 12_000_000);
  const mediaType: ImgMedia = (ALLOWED_MEDIA as readonly string[]).includes(str(body.mediaType, 20))
    ? (str(body.mediaType, 20) as ImgMedia) : 'image/jpeg';
  if (!imageBase64) return NextResponse.json({ found: false, reason: 'no-image' });
  if (!anthropic) return NextResponse.json({ found: false, reason: 'vision-unavailable' });

  try {
    const response = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 400,
      system: [{ type: 'text', text: LABEL_SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: LABEL_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
          { type: 'text', text: 'Transcribe this medicine label.' },
        ],
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ found: false, reason: 'no-read' });
    const j = JSON.parse(text.text) as CareLabelRead;
    if (!j.found || !String(j.name || '').trim()) return NextResponse.json({ found: false, reason: 'not-a-label' });
    return NextResponse.json({
      found: true,
      name: str(j.name, 120).trim(),
      strength: str(j.strength, 40).trim(),
      form: str(j.form, 20),
      packCount: Number.isFinite(Number(j.packCount)) && Number(j.packCount) > 0 && Number(j.packCount) <= 999
        ? Math.round(Number(j.packCount)) : 0,
      instructions: str(j.instructions, 160).trim(),
      withFood: j.withFood === true,
    });
  } catch {
    return NextResponse.json({ found: false, reason: 'read-failed' });
  }
}
