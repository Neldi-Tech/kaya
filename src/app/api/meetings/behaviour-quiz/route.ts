// POST — warm up the Learn & Grow quiz wording (SM3.1 · #4a).
//
// The client builds DETERMINISTIC questions from the kid's real week
// (lib/meetingQuiz) — answers are known before AI is involved. This route
// only rephrases `q` and `explain` in a warm, family-meeting voice.
// Options, order and correctIndex are returned UNCHANGED, so a hallucination
// can't break correctness. No-ops ({ skipped: true }) without an API key or
// on any model error — the template wording is always good enough to run.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebaseAdmin';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;

interface QuizQIn {
  kind: string;
  q: string;
  options: string[];
  correctIndex: number;
  explain: string;
}

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  if (!auth) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  try { await auth.verifyIdToken(token); }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  if (!apiKey) return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  let body: { kids?: Array<{ kidId?: string; kidName?: string; questions?: QuizQIn[] }> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const kids = (body.kids || []).filter((k) => k.kidId && Array.isArray(k.questions) && k.questions.length > 0).slice(0, 8);
  if (kids.length === 0) return NextResponse.json({ skipped: true, reason: 'no-questions' });

  try {
    const client = new Anthropic({ apiKey });
    const input = kids.map((k) => ({
      kidId: k.kidId,
      kidName: k.kidName || 'the kid',
      questions: (k.questions || []).slice(0, 3).map((q) => ({ kind: q.kind, q: q.q, explain: q.explain })),
    }));
    const msg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content:
          `You warm up quiz questions for a family Sunday meeting with kids (ages ~6-14). ` +
          `Rephrase each "q" and "explain" to be warm, encouraging and playful — never shaming; ` +
          `a slip is "let's remember together", a win is celebrated. Keep them SHORT (q ≤ 90 chars, ` +
          `explain ≤ 120 chars), keep any day-dates and routine names EXACTLY as written, keep emojis light. ` +
          `Return ONLY JSON: {"kids":[{"kidId":"...","questions":[{"q":"...","explain":"..."}]}]} ` +
          `with questions in the SAME ORDER as given.\n\nINPUT:\n${JSON.stringify({ kids: input })}`,
      }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const jsonStart = text.indexOf('{');
    const parsed = JSON.parse(text.slice(jsonStart)) as { kids?: Array<{ kidId?: string; questions?: Array<{ q?: string; explain?: string }> }> };

    // Merge: texts from AI, structure (options/correctIndex/kind) from input.
    const out = kids.map((k) => {
      const ai = (parsed.kids || []).find((x) => x.kidId === k.kidId);
      return {
        kidId: k.kidId,
        questions: (k.questions || []).slice(0, 3).map((q, i) => ({
          ...q,
          q: (ai?.questions?.[i]?.q || q.q).slice(0, 140),
          explain: (ai?.questions?.[i]?.explain || q.explain).slice(0, 180),
        })),
      };
    });
    return NextResponse.json({ ok: true, kids: out });
  } catch {
    return NextResponse.json({ skipped: true, reason: 'model-error' });
  }
}
