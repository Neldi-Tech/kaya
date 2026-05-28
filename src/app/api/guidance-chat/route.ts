// Kaya Guide · in-app onboarding & help chatbot (server).
//
// A single conversational helper that guides BOTH kids and parents around
// the app — "what is the Hive?", "how do I rate the day?", "where do
// rewards live?". It only ever EXPLAINS and POINTS; it never executes
// anything (no writes happen here).
//
// Mirrors /api/business-coach's trust + fallback model: no-ops cleanly when
// ANTHROPIC_API_KEY is missing, so the help bubble degrades to a friendly
// "not switched on yet" note rather than breaking any screen.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

type Role = 'parent' | 'helper' | 'kid' | 'guest';
type Turn = { role: 'user' | 'assistant'; content: string };

interface ChatBody {
  /** The conversation so far, oldest first. The latest turn is the user's
   *  new question. Capped server-side to keep the prompt small. */
  messages?: Turn[];
  /** Who is asking + where they are, so the guide can match tone + context. */
  context?: {
    role?: Role;
    displayName?: string;
    /** Friendly name of the section the user is currently on, e.g. "Kaya Hive". */
    module?: string;
    familyName?: string;
  };
}

// A compact glossary of the app so the guide can answer "what is X?" without
// hallucinating. Kept short on purpose — it's a map, not a manual.
const APP_GUIDE = `Kaya is a family app that gamifies daily routines, teaches money skills, and runs light family governance. The sections:
- Home: each person's dashboard — today's snapshot for their role.
- Rate the day: morning & evening, a parent rates each kid's routine; good behaviour earns Kaya points.
- Rewards: kids spend earned points on family-set rewards.
- Kaya Hive: the money-learning centre — the Honey Pot savings wallet, savings goals, and simple planning.
- Kaya Pulse: the household budget & expense tracker (parents).
- Kaya Sparks: a kid's schoolwork & achievement portfolio (photos of projects, milestones).
- Business: a kid's tiny real micro-enterprise (lemonade, eggs, crafts) with its own AI coach.
- Messages: private family chat between members.
- Moments: family photo & activity sharing.
- Pantry: household inventory and grocery lists.
- Meetings: a guided 6-step family meeting facilitator.
- Workplan: a kid's chores/tasks plan with daily ticks.
- Settings / Admin: family setup, members, invite codes, branding.`;

const SYSTEM = `You are "Kaya Guide", a warm, concise in-app helper inside the Kaya family app. You help people find their way around and understand how things work.

Hard rules:
- You EXPLAIN and POINT; you never act, write data, or claim to have changed anything. Nothing you say is executed.
- Ground every answer in the Kaya feature map below. If something genuinely isn't covered, say you're not sure and suggest where they might look or to ask a parent — never invent features, buttons, or screens.
- Adapt to WHO is asking. For a kid: very simple words, short, friendly, encouraging, no money jargon. For a parent/helper: clear and practical, a little more detail is fine.
- Be brief: 1-4 short sentences. Point to the section by its name (e.g. "open Kaya Hive") rather than guessing exact pixel locations.
- Use the family's and people's names if given. Stay geographically and religiously neutral.
- For anything sensitive (spending real money, deleting things, account/settings changes), gently suggest checking with a parent.

Kaya feature map:
${APP_GUIDE}

Return JSON: a short "message" (your reply, plain text, no markdown) and "suggestions" (0-3 very short follow-up question chips the user might tap next, <= 5 words each, written in the user's voice).`;

const SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['message', 'suggestions'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const turns = Array.isArray(body.messages) ? body.messages : [];
  // Keep the last 12 turns (6 exchanges) — plenty of context, small prompt.
  const recent = turns
    .filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.content === 'string' && t.content.trim())
    .slice(-12)
    .map((t) => ({ role: t.role, content: t.content.trim().slice(0, 2000) }));

  if (recent.length === 0 || recent[recent.length - 1].role !== 'user') {
    return NextResponse.json({ error: 'Expected a user message' }, { status: 400 });
  }

  const ctx = body.context || {};
  const who = ctx.role === 'kid' ? 'a CHILD' : ctx.role === 'helper' ? 'a family helper' : ctx.role === 'guest' ? 'a guest trying the app' : 'a parent';
  const name = (ctx.displayName || '').trim().slice(0, 40);
  const where = (ctx.module || '').trim().slice(0, 60);
  const family = (ctx.familyName || '').trim().slice(0, 60);

  const contextLine = [
    `The person asking is ${who}${name ? ` named ${name}` : ''}.`,
    where ? `They are currently on the "${where}" screen — assume their question is likely about it unless they say otherwise.` : '',
    family ? `Their family is called "${family}".` : '',
  ].filter(Boolean).join(' ');

  try {
    const response = await client.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 600,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        { role: 'user', content: `(context for this conversation — do not repeat it back) ${contextLine}` },
        { role: 'assistant', content: 'Got it — I\'ll keep that in mind. How can I help?' },
        ...recent,
      ],
    });

    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No reply returned' }, { status: 502 });
    }
    const parsed = JSON.parse(text.text) as { message?: string; suggestions?: string[] };
    return NextResponse.json({
      message: (parsed.message || '').trim(),
      suggestions: Array.isArray(parsed.suggestions)
        ? parsed.suggestions.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3)
        : [],
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Guide failed' },
      { status: 500 },
    );
  }
}
