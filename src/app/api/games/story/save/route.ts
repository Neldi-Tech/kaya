// Kaya Games — save + AI-score a Story Builder keepsake (Admin SDK).
//
// The host POSTs the sessionId after a collaborative Story Builder game. The
// route reads the story straight from the session (forge-proof — kids can't
// fake the text OR the score), asks Claude for a warm score + a fun title,
// stamps an expiry from the family's storyRetentionDays setting, and writes it
// to families/{fid}/stories. Idempotent via session.storySaved.
//
// Fails SAFE: if the AI key is missing or the model errors, the story is still
// saved with score:null + a default title, so the keepsake is never lost.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { resolveGamesConfig } from '@/lib/games';
import type { StoryScore, StorySentence } from '@/lib/stories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const ai = apiKey ? new Anthropic({ apiKey }) : null;

interface Body { sessionId?: string }

const SYSTEM = `You are the warm, encouraging story coach for Kaya, a family app. A family (kids roughly ages 5 to 12, together with their parents) just wrote a collaborative story one sentence at a time. Celebrate their work — this is a keepsake, never an exam.

Return JSON: { "title": string, "stars": number, "praise": string, "creativity": number, "teamwork": number, "imagination": number }

Rules:
- "title": a short, fun, child-friendly title for THIS story (max 6 words). No surrounding quotes.
- "stars": overall 1 to 5 (whole number). Be generous — most stories are 4 or 5; only go below 3 if the story is essentially empty.
- "praise": 1 to 2 warm sentences a child would love to read. Mention something specific that happened in the story. No criticism, no "but". Plain text; at most ONE emoji.
- "creativity", "teamwork", "imagination": 0 to 100 each, encouraging (aim 70 to 100).
- Keep everything kind, positive and age-appropriate.`;

const SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    stars: { type: 'integer', minimum: 1, maximum: 5 },
    praise: { type: 'string' },
    creativity: { type: 'integer', minimum: 0, maximum: 100 },
    teamwork: { type: 'integer', minimum: 0, maximum: 100 },
    imagination: { type: 'integer', minimum: 0, maximum: 100 },
  },
  required: ['title', 'stars', 'praise', 'creativity', 'teamwork', 'imagination'],
  additionalProperties: false,
} as const;

function clampInt(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return dflt;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

async function scoreStory(text: string): Promise<StoryScore | null> {
  if (!ai) return null;
  try {
    const r = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: `The family's story:\n\n${text}` }] }],
    });
    const t = r.content.find((b) => b.type === 'text');
    if (!t || t.type !== 'text') return null;
    const p = JSON.parse(t.text) as Partial<StoryScore>;
    return {
      title: (typeof p.title === 'string' && p.title.trim()) ? p.title.trim().slice(0, 60) : 'A Family Story',
      praise: (typeof p.praise === 'string' && p.praise.trim()) ? p.praise.trim().slice(0, 280) : 'What a lovely story you made together!',
      stars: clampInt(p.stars, 1, 5, 4),
      creativity: clampInt(p.creativity, 0, 100, 80),
      teamwork: clampInt(p.teamwork, 0, 100, 85),
      imagination: clampInt(p.imagination, 0, 100, 80),
    };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ skipped: true, reason: 'admin-sdk-not-configured' });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const sessionId = (body.sessionId || '').trim();
  if (!sessionId) return NextResponse.json({ error: 'no-session' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; displayName?: string; name?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const sRef = db.collection('families').doc(familyId).collection('gameSessions').doc(sessionId);
  const sSnap = await sRef.get();
  if (!sSnap.exists) return NextResponse.json({ error: 'no-session' }, { status: 404 });
  const s = sSnap.data() as {
    gameId?: string; players?: { uid: string; name: string }[];
    state?: { sentences?: StorySentence[] };
    storySaved?: boolean; storyId?: string;
  };

  // Requester must be one of the players in this session.
  const players = s.players || [];
  if (!players.some((p) => p.uid === uid)) {
    return NextResponse.json({ error: 'not-a-player' }, { status: 403 });
  }
  if (s.storySaved && s.storyId) {
    return NextResponse.json({ ok: true, alreadySaved: true, storyId: s.storyId });
  }

  const sentences = (s.state?.sentences || []).filter((x) => x && typeof x.text === 'string' && x.text.trim());
  if (sentences.length === 0) return NextResponse.json({ error: 'empty-story' }, { status: 400 });

  const text = sentences.map((x) => x.text.trim()).join(' ');
  const contributors = Array.from(new Set(sentences.map((x) => x.name).filter(Boolean)));

  // Retention window from the family's games config.
  const fam = (await db.collection('families').doc(familyId).get()).data() as { gamesConfig?: unknown } | undefined;
  const cfg = resolveGamesConfig((fam?.gamesConfig as Parameters<typeof resolveGamesConfig>[0]) || null);
  const days = Math.max(0, Math.round(Number(cfg.storyRetentionDays) || 0));
  const now = Date.now();
  const expiresAt = days > 0 ? now + days * 86_400_000 : null;

  const score = await scoreStory(text);
  const savedByName = user?.displayName || user?.name || players.find((p) => p.uid === uid)?.name || 'A player';

  const storyRef = db.collection('families').doc(familyId).collection('stories').doc();
  const story = {
    id: storyRef.id,
    gameId: s.gameId || 'story-builder',
    createdAt: now,
    expiresAt,
    contributors,
    sentences: sentences.map((x) => ({ uid: x.uid, name: x.name, text: x.text.trim() })),
    text,
    title: score?.title || 'A Family Story',
    score,
    savedByUid: uid,
    savedByName,
  };

  const batch = db.batch();
  batch.set(storyRef, story);
  batch.update(sRef, { storySaved: true, storyId: storyRef.id });
  try { await batch.commit(); }
  catch (e) { return NextResponse.json({ error: 'save-failed', detail: String(e) }, { status: 500 }); }

  return NextResponse.json({ ok: true, storyId: storyRef.id, score });
}
