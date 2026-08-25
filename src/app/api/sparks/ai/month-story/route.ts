import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

// Timeline 2.0 · 📖 Kaya Writes — Month Story (design v2 innovation #3-kept).
//
// One warm paragraph per active month, written from that month's notes
// and cached on families/{f}/sparks_month_stories/{surface}_{kidId}_{YYYY-MM}.
// Generated on first open by any family member; force-regenerate is
// parents-only. Locked/sealed diary pages never reach the model. The
// family kill-switch greetingConfig.kayaWrites === false turns it off.
//
// POST { action: 'get' | 'write', kidId, surface, monthKey, lang?, force? }

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['story'],
  properties: {
    story: { type: 'string', description: 'The 3–4 sentence month story.' },
  },
} as const;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const body = await req.json().catch(() => ({})) as {
    action?: string; kidId?: string; surface?: 'reflection' | 'diary';
    monthKey?: string; lang?: string; force?: boolean;
  };
  const { kidId, surface, monthKey } = body;
  if (!kidId || (surface !== 'reflection' && surface !== 'diary')
    || !monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
    return NextResponse.json({ error: 'bad-args' }, { status: 400 });
  }

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = user?.role === 'kid' || user?.role === 'helper' ? user.role : 'parent';
  if (role === 'helper') return NextResponse.json({ error: 'family-only' }, { status: 403 });
  if (role === 'kid' && user?.childId !== kidId) {
    return NextResponse.json({ error: 'own-journal-only' }, { status: 403 });
  }

  const famRef = db.collection('families').doc(familyId);
  const cacheRef = famRef.collection('sparks_month_stories').doc(`${surface}_${kidId}_${monthKey}`);

  if (body.action === 'get') {
    const c = (await cacheRef.get()).data() as { story?: string; generatedAt?: number } | undefined;
    return NextResponse.json({ story: c?.story ?? null, generatedAt: c?.generatedAt ?? null });
  }
  if (body.action !== 'write') return NextResponse.json({ error: 'bad-action' }, { status: 400 });

  // Force-regenerate is parents-only; a plain write reuses the cache.
  const force = body.force === true;
  if (force && role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });
  if (!force) {
    const c = (await cacheRef.get()).data() as { story?: string; generatedAt?: number } | undefined;
    if (c?.story) return NextResponse.json({ story: c.story, generatedAt: c.generatedAt ?? null, cached: true });
  }

  // Family kill-switch — same as every Kaya Writes surface.
  const fam = (await famRef.get()).data() as
    { greetingConfig?: { kayaWrites?: boolean } } | undefined;
  if (fam?.greetingConfig?.kayaWrites === false) {
    return NextResponse.json({ story: null, skipped: true, reason: 'off' });
  }

  // ── the month's notes, read server-side (locked/sealed never leak) ──
  const lines: string[] = [];
  let kidName = 'the kid';
  if (surface === 'reflection') {
    const snap = await famRef.collection('sparks_reflections').where('kidId', '==', kidId).get();
    for (const d of snap.docs) {
      const e = d.data() as { date?: string; text?: string; ai_read?: { mood_emoji?: string }; parent_rating?: { soundness_percent?: number } };
      if (!e.date?.startsWith(monthKey) || !e.text?.trim()) continue;
      lines.push(`[${e.date}]${e.ai_read?.mood_emoji ? ` ${e.ai_read.mood_emoji}` : ''} ${e.text.trim().slice(0, 400)}`);
    }
  } else {
    const snap = await famRef.collection('sparks_diary').where('ownerId', '==', kidId).get();
    const today = new Date().toISOString().slice(0, 10);
    for (const d of snap.docs) {
      const e = d.data() as { date?: string; locked?: boolean; sealed_until?: string; feeling?: string; blocks?: Array<{ kind?: string; text?: string }> };
      if (!e.date?.startsWith(monthKey) || e.locked === true) continue;
      if (e.sealed_until && e.sealed_until > today) continue;
      const text = (e.blocks ?? []).filter((b) => b.kind === 'text' && b.text?.trim()).map((b) => (b.text as string).trim()).join(' ');
      if (!text) continue;
      lines.push(`[${e.date}]${e.feeling ? ` ${e.feeling}` : ''} ${text.slice(0, 400)}`);
    }
  }
  const kidSnap = await famRef.collection('children').doc(kidId).get();
  if (kidSnap.exists) kidName = ((kidSnap.data() as { name?: string }).name || kidName).split(' ')[0];
  else {
    const u = (await db.collection('users').doc(kidId).get()).data() as { displayName?: string } | undefined;
    if (u?.displayName) kidName = u.displayName.split(' ')[0];
  }

  if (lines.length < 2) {
    return NextResponse.json({ story: null, skipped: true, reason: 'not-enough' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ story: null, skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  const sw = body.lang === 'sw';
  const SYSTEM = `You are Kaya Writes — the warm family pen of the Kaya app, used in East Africa and worldwide.
Write a MONTH STORY: one warm paragraph (3–4 sentences) about ${kidName}'s month of journal notes, third person, present-perfect warmth — the kind of paragraph a parent would read aloud.
Rules: be specific to what the notes actually say; NEVER invent facts, names, places, gifts, illnesses or events not in the notes; no clichés stacked; no hashtags; mention at most one standout day; end warm, no signature.
${sw ? 'Write in natural Tanzanian Swahili.' : 'Write in warm simple English.'}`;
  const userMsg = `Month: ${monthKey} · ${lines.length} notes\n\n${lines.sort().join('\n')}`.slice(0, 12000);

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const r = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
    } as unknown as Parameters<typeof client.messages.create>[0]);
    const t = (r as unknown as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === 'text');
    const parsed = t?.text ? (JSON.parse(t.text) as { story?: string }) : {};
    const story = (parsed.story ?? '').trim().slice(0, 900);
    if (!story) return NextResponse.json({ error: 'ai-failed' }, { status: 502 });
    const generatedAt = Date.now();
    await cacheRef.set({ story, generatedAt, kidId, surface, monthKey, lang: sw ? 'sw' : 'en', notes: lines.length, by: uid });
    return NextResponse.json({ story, generatedAt });
  } catch (e) {
    return NextResponse.json({ error: 'ai-failed', detail: (e as Error).message.slice(0, 200) }, { status: 502 });
  }
}
