// ✨ Meeting note drafts (Sunday Meeting upgrade · approved 2026-09-21).
//
// Two modes behind the RichNote AI button on the meeting screens:
//
//   • `tidy`     — "✨ Help me say it" on the outgoing leader's advice line
//                  (Passing the Crown, R25). It ONLY tidies the child's own
//                  words — grammar, spelling, one clear sentence. It never
//                  adds an idea and never writes the advice for them: no
//                  words typed → nothing to tidy.
//   • `decision` — "✨ Draft with AI" on a parent's note when they approve /
//                  adjust / decline a kid-proposed meeting award (R16).
//                  Three short kid-facing lines; a decline is kind and ends
//                  with a way forward (Elia's standing rule).
//
// Mirrors the other Kaya AI routes: { skipped: true } without the key; the
// structured-output schema carries NO array-count / length constraints;
// failures are logged, never a bare catch. Signed-in callers only whenever
// the Admin SDK is configured (it isn't on previews — those just skip auth).

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const TIDY_SYSTEM = `You help a child say their OWN advice clearly. The child has just finished a week as their family's "Leader of the Week" and is giving one line of advice to the sibling who leads next.

Rules — these matter more than style:
- Keep the child's meaning and as many of THEIR words as you can. Fix spelling, grammar and run-ons only.
- NEVER add a new idea, reason, example or moral. NEVER make it sound like an adult wrote it.
- One sentence (two at most), 25 words or fewer, warm, spoken to the next leader.
- If the text is not advice, is empty, or you are unsure, return it unchanged.
- Same language as the input.

Return JSON { "text": string }.`;

const DECISION_SYSTEM = `You draft a parent's short note to their children about a Sunday family-meeting award.

Context: in this family a child who leads the Sunday meeting can PROPOSE the meeting awards (the Star podium, the Excellent Belt, the Ladder bonus). A parent then approves, adjusts the points, or declines — always with a note the children read on the shared meeting screen and in their notifications.

Rules:
- Speak warmly TO the child who receives the award (use their first name). One or two short sentences, 30 words or fewer.
- Be specific to the evidence given. Never invent facts.
- approve → celebrate what earned it.
- adjust  → celebrate, and say in one calm clause why the points changed.
- decline → kind, no scolding, and ALWAYS end with a clear way forward.
- If the parent typed words already, keep their meaning and make it read well.
- Plain text only. No emojis unless the parent used them.

Return JSON { "suggestions": [ string, string, string ] } — exactly 3 varied options.`;

const TIDY_SCHEMA = {
  type: 'object',
  properties: { text: { type: 'string' } },
  required: ['text'],
  additionalProperties: false,
} as const;

const DECISION_SCHEMA = {
  type: 'object',
  properties: { suggestions: { type: 'array', items: { type: 'string' } } },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

interface Body {
  mode?: string;
  text?: string;
  to?: string;
  lang?: string;
  decision?: string;
  awardLabel?: string;
  kidName?: string;
  proposerName?: string;
  points?: number;
  proposedPoints?: number;
  evidence?: string;
  refine?: string;
}

export async function POST(req: NextRequest) {
  if (!client) return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  const adminAuth = getAdminAuth();
  if (adminAuth) {
    const authz = req.headers.get('authorization') || '';
    const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
    if (!token) return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 });
    try { await adminAuth.verifyIdToken(token); }
    catch { return NextResponse.json({ error: 'Please sign in again.' }, { status: 401 }); }
  }

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const lang = body.lang === 'sw' ? 'sw' : 'en';

  try {
    if (body.mode === 'tidy') {
      const text = (body.text || '').trim().slice(0, 300);
      if (text.split(/\s+/).filter(Boolean).length < 3) {
        return NextResponse.json({ error: 'Say it in your own words first — then Kaya can tidy it.' }, { status: 400 });
      }
      const to = (body.to || '').trim().slice(0, 40);
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 200,
        system: [{ type: 'text', text: TIDY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: TIDY_SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: `${to ? `The next leader's name: ${to}.\n` : ''}The child's own words: "${text}"` }] }],
      });
      const out = response.content.find((b) => b.type === 'text');
      if (!out || out.type !== 'text') return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
      const parsed = JSON.parse(out.text) as { text?: unknown };
      const tidy = typeof parsed.text === 'string' ? parsed.text.trim().replace(/^["“]|["”]$/g, '').slice(0, 200) : '';
      if (!tidy) return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
      return NextResponse.json({ text: tidy });
    }

    if (body.mode === 'decision') {
      const decision = body.decision === 'decline' ? 'decline' : body.decision === 'adjust' ? 'adjust' : 'approve';
      const awardLabel = (body.awardLabel || '').trim().slice(0, 80);
      const kidName = (body.kidName || '').trim().slice(0, 40);
      if (!awardLabel || !kidName) return NextResponse.json({ error: 'Missing the award details' }, { status: 400 });
      const points = Number.isFinite(body.points) ? Math.round(Number(body.points)) : 0;
      const proposed = Number.isFinite(body.proposedPoints) ? Math.round(Number(body.proposedPoints)) : points;
      const hint = (body.text || '').trim().slice(0, 300);
      const evidence = (body.evidence || '').trim().slice(0, 240);
      const proposer = (body.proposerName || '').trim().slice(0, 40);
      const refine = (body.refine || '').trim().slice(0, 60);
      const userMsg = [
        `Award: ${awardLabel}.`,
        `Child receiving it: ${kidName}.`,
        proposer ? `Proposed at the meeting by: ${proposer}.` : '',
        `Parent's decision: ${decision}.`,
        decision === 'decline' ? '' : `Points: +${points}${decision === 'adjust' ? ` (the proposal was +${proposed})` : ''}.`,
        evidence ? `Evidence Kaya checked: ${evidence}` : '',
        hint ? `The parent's own words (keep their meaning): "${hint}".` : 'The parent has not typed anything yet.',
        lang === 'sw' ? 'Language: Kiswahili.' : 'Language: English.',
        refine ? `Refinement requested: ${refine}.` : '',
      ].filter(Boolean).join('\n');
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        system: [{ type: 'text', text: DECISION_SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: DECISION_SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
      });
      const out = response.content.find((b) => b.type === 'text');
      if (!out || out.type !== 'text') return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
      const parsed = JSON.parse(out.text) as { suggestions?: unknown };
      const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
        .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        .map((s) => s.trim().replace(/^["“]|["”]$/g, '').slice(0, 240))
        .slice(0, 3);
      if (suggestions.length === 0) return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
      return NextResponse.json({ suggestions });
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 });
  } catch (e: unknown) {
    const status = e instanceof Anthropic.APIError ? e.status ?? 500 : 500;
    console.error('[meetings/note-draft] ai failed', status, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'Kaya couldn’t write just now — try again in a moment.' }, { status });
  }
}
