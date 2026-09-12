// ✨ Kaya Writes · Award Points — drafts the "Tell them why" note (server).
//
// A parent has picked the kid(s), a category, a points type + amount and
// maybe typed a few words. Kaya offers THREE short, kid-facing lines the
// parent can use as-is or edit. The note is what the child reads on the
// award card, in the points email and on their Stats feed — so it speaks
// TO the child, stays specific, never invents facts, and for deductions /
// improvement notes it is kind and ends with a way forward (Elia's rule:
// every parent note to a kid carries a way forward, never a scolding).
//
// Mirrors the other Kaya AI routes: { skipped: true } without the key; the
// structured-output schema carries NO array-count / length constraints
// ("exactly 3" lives in the prompt + slice); failures are logged, never a
// bare catch.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 30;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type Kind = 'regular' | 'diamond' | 'reducing' | 'kudos' | 'improvement_note';
const KINDS: Kind[] = ['regular', 'diamond', 'reducing', 'kudos', 'improvement_note'];

interface DraftBody {
  /** First names of the kid(s) receiving the award (1-6). */
  kidNames?: string[];
  /** Category label as shown on the page, e.g. "Kindness". */
  category?: string;
  kind?: Kind;
  /** Signed points (0 for kudos / improvement notes). */
  points?: number;
  /** Whatever the parent already typed — Kaya shapes it, never discards it. */
  hint?: string;
  /** 'en' (default) or 'sw'. */
  lang?: string;
  /** Optional refinement: "Shorter" · "Warmer" · "More specific" · "different angle". */
  refine?: string;
}

const KIND_BRIEF: Record<Kind, string> = {
  regular: 'This is PRAISE with points. Name the deed and why it mattered to the family. Proud, warm, specific.',
  diamond: 'This is a 💎 DIAMOND award — reserved for something exceptional. Say plainly what made it stand out and why it earned the bigger bonus.',
  kudos: 'This is a KUDOS — a quick thank-you with no points. One short, genuine cheer.',
  reducing: 'This is a DEDUCTION. Be kind and clear: name the behaviour (not the child), say why it matters, and END with the way forward — what to do next time. No shaming, no sarcasm, no threats.',
  improvement_note: 'This is an IMPROVEMENT NOTE — no points taken, a gentle heads-up. Name the one thing to work on, say you believe they can, and end with a concrete next step.',
};

const SYSTEM = `You are Kaya Writes inside a family app. A PARENT is awarding (or noting) points for a CHILD and needs the short note the child will read. Write it TO the child ("you"), as the parent speaking.

Rules:
- 1-2 sentences, at most 160 characters. Plain words a child understands.
- Specific to the category and the parent's own words. NEVER invent facts, names, places or events not given — if the parent gave no details, write from the category honestly and keep it easy to edit.
- Use the child's first name at most once (or "you all" for several children). No hashtags, no quotes around the text, at most one emoji and only if it fits.
- Warm and honest. For deductions and improvement notes: kind, behaviour-focused, and always end with a way forward.
- Kiswahili, when asked, must be natural Tanzanian Swahili.
Return JSON { "suggestions": [ string, string, string ] } — exactly 3 varied options.`;

const SCHEMA = {
  type: 'object',
  properties: {
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['suggestions'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }
  let body: DraftBody;
  try { body = (await req.json()) as DraftBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const kidNames = (Array.isArray(body.kidNames) ? body.kidNames : [])
    .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
    .map((n) => n.trim().slice(0, 40))
    .slice(0, 6);
  const category = (body.category || '').trim().slice(0, 40);
  const kind: Kind = KINDS.includes(body.kind as Kind) ? (body.kind as Kind) : 'regular';
  const points = Number.isFinite(body.points) ? Math.round(Number(body.points)) : 0;
  const hint = (body.hint || '').trim().slice(0, 300);
  const lang = body.lang === 'sw' ? 'sw' : 'en';
  const refine = (body.refine || '').trim().slice(0, 60);
  if (!category) return NextResponse.json({ error: 'Pick a category first' }, { status: 400 });

  const who = kidNames.length === 0 ? 'the child' : kidNames.length === 1 ? kidNames[0] : `${kidNames.join(', ')} (several children — address them together)`;
  const pointsLine = kind === 'kudos' || kind === 'improvement_note'
    ? 'Points: none (0).'
    : `Points: ${points > 0 ? '+' : ''}${points}${kind === 'diamond' ? ' diamond' : ''}.`;
  const userMsg = [
    `Child: ${who}.`,
    `Category: ${category}.`,
    `Type: ${kind}. ${KIND_BRIEF[kind]}`,
    pointsLine,
    hint ? `The parent's own words (keep their meaning, make it read well): "${hint}".` : 'The parent has not typed anything yet — write from the category, honestly.',
    lang === 'sw' ? 'Language: Kiswahili.' : 'Language: English.',
    refine ? `Refinement requested: ${refine}.` : '',
  ].filter(Boolean).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
    });
    const out = response.content.find((b) => b.type === 'text');
    if (!out || out.type !== 'text') return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
    const parsed = JSON.parse(out.text) as { suggestions?: unknown };
    const suggestions = (Array.isArray(parsed.suggestions) ? parsed.suggestions : [])
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().replace(/^["“]|["”]$/g, '').slice(0, 220))
      .slice(0, 3);
    if (suggestions.length === 0) return NextResponse.json({ error: 'No draft returned' }, { status: 502 });
    return NextResponse.json({ suggestions });
  } catch (e: unknown) {
    const status = e instanceof Anthropic.APIError ? e.status ?? 500 : 500;
    console.error('[awards/draft-reason] ai failed', status, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Draft failed' }, { status });
  }
}
