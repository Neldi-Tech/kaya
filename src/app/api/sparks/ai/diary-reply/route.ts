// Kaya Sparks · Diary 💌 Dear Kaya (Slice 8f · 2026-07-21).
//
// Opt-in pen-pal: a kid addresses a diary page to Kaya and gets a
// short, warm reply. Guardrails (from the approved design):
//   · opt-in PER PAGE (the kid ticks 💌 on the composer)
//   · parent-toggleable: sparks_profiles.{kid}.diary_dear_kaya
//     (default ON; OFF hides the option and this route refuses)
//   · NEVER on locked or sealed pages
//   · same reflective, never-preachy voice as the reflection AI-read
//
// The reply is written onto the entry (kaya_reply) with the Admin SDK
// after verifying the caller owns the entry.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const SYSTEM = `You are Kaya, a warm pen-pal replying to a child's diary page they chose to address to you. 1–2 SHORT sentences. Reference something they actually wrote. Reflect, don't direct: no advice unless they asked, no moralizing, no "amazing/incredible" pile-ups. If the page is sad, sit with them kindly ("That sounds heavy — thank you for telling me."). Use their first name at most once. Return JSON: { "reply": "1-2 sentences" }.`;

const SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  if (!client) return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: { ownerId?: string; entryId?: string; firstName?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const ownerId = String(body.ownerId ?? '');
  const entryId = String(body.entryId ?? '');
  if (!ownerId || !entryId) return NextResponse.json({ error: 'bad-args' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string; email?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  // Owner check (kid or parent-own diary) — same resolution as the gateway.
  let isOwner = false;
  if (user?.role === 'parent' && ownerId === uid) isOwner = true;
  else if (user?.role === 'kid') {
    if (user.childId && user.childId === ownerId) isOwner = true;
    else {
      const child = (await db.collection('families').doc(familyId).collection('children').doc(ownerId).get()).data() as
        { uid?: string; email?: string } | undefined;
      if (child && ((child.uid && child.uid === uid)
        || (child.email && user?.email && child.email.toLowerCase() === user.email.toLowerCase()))) isOwner = true;
    }
  }
  if (!isOwner) return NextResponse.json({ error: 'owner-only' }, { status: 403 });

  // Parent toggle (kids only — parents replying to themselves is fine).
  if (user?.role === 'kid') {
    const prof = (await db.collection('families').doc(familyId).collection('sparks_profiles').doc(ownerId).get()).data() as
      { diary_dear_kaya?: boolean } | undefined;
    if (prof?.diary_dear_kaya === false) {
      return NextResponse.json({ error: 'dear-kaya-off' }, { status: 403 });
    }
  }

  const ref = db.collection('families').doc(familyId).collection('sparks_diary').doc(entryId);
  const snap = await ref.get();
  const entry = snap.data() as {
    ownerId?: string; locked?: boolean; sealed_until?: string;
    blocks?: Array<{ kind?: string; text?: string }>; feeling?: string;
  } | undefined;
  if (!snap.exists || entry?.ownerId !== ownerId) {
    return NextResponse.json({ error: 'not-found' }, { status: 404 });
  }
  // Guardrail: never on locked or sealed pages.
  if (entry?.locked === true || (entry?.sealed_until && entry.sealed_until.length > 0)) {
    return NextResponse.json({ error: 'page-private' }, { status: 403 });
  }

  const text = (entry?.blocks ?? [])
    .filter((b) => b.kind === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .slice(0, 1500);
  if (!text) return NextResponse.json({ error: 'no-text' }, { status: 400 });

  const firstName = String(body.firstName ?? '').slice(0, 40) || 'the writer';
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [{ type: 'text', text: `Writer: ${firstName} · feeling ${entry?.feeling ?? ''}\nPage: """${text}"""` }],
      }],
    });
    const t = response.content.find((b) => b.type === 'text');
    if (!t || t.type !== 'text') return NextResponse.json({ error: 'no-reply' }, { status: 500 });
    const reply = (JSON.parse(t.text) as { reply?: string }).reply?.slice(0, 500) || '';
    if (!reply) return NextResponse.json({ error: 'no-reply' }, { status: 500 });
    await ref.update({ kaya_reply: reply, updatedAt: FieldValue.serverTimestamp() });
    return NextResponse.json({ reply });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Reply failed' },
      { status: 500 },
    );
  }
}
