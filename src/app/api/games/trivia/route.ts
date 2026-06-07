// Kaya Games — AI trivia generator (server) — Claude Sonnet (text).
//
// UNIFIED generator for both:
//   • Family Trivia  → { subject }
//   • Local Trivia   → { country, discipline }
// Tuned to a difficulty level (easy/medium/hard), each question carries a
// playful one-line CONTEXT and a "Did you know?" FACT so kids learn. An
// optional `avoid` list lets the caller exclude already-seen questions (the
// never-repeats engine).
//
// Fails SAFE: { skipped: true } when ANTHROPIC_API_KEY is absent and
// { questions: [] } on any model/parse error — the client then falls back to
// its hand-authored bank, so trivia always works.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

const SUBJECT_LABELS: Record<string, string> = {
  animals: 'Animals & nature',
  science: 'Simple science, the human body & space',
  geography: 'World geography (oceans, continents, countries, landmarks)',
  sports: 'Sports & games',
  words: 'Words, spelling, grammar & popular kids books',
  mixed: 'Fun general knowledge — colours, shapes, numbers, food & everyday life',
};

const DISCIPLINE_LABELS: Record<string, string> = {
  geography: 'local geography — regions, cities, rivers, mountains, nature & landmarks',
  history: 'local history — key events, leaders, independence & heritage',
  culture: 'local culture & traditions — festivals, music, dress, customs',
  food: 'local food & famous dishes',
  sports: 'local sports & famous athletes',
  language: 'the local language(s) — greetings, common words & meanings',
  people: 'famous people from the country',
  mixed: 'a fun mix of local geography, culture, food, sport & history',
};

const LEVELS: Record<string, string> = {
  easy: 'EASY — for children about 5 to 8. Simple recall, very short words, everyday things.',
  medium: 'MEDIUM — for children about 8 to 12. A little reasoning, still friendly.',
  hard: 'HARD — for teenagers and adults. Deeper, lesser-known but fair facts.',
};

const SYSTEM = `You write multiple-choice trivia for a FAMILY game played by children (~5 to 12) together with their parents. Make every question fun AND a little educational.

Return JSON: { "questions": [ { "q": string, "choices": [string,string,string,string], "answer": number, "context": string, "fact": string } ] }

Rules:
- EXACTLY 4 choices; "answer" is the 0-based index (0 to 3) of the single correct choice. Factually correct, unambiguous — exactly one right, the other three clearly wrong.
- "context": a SHORT, playful framing for the question — max 6 words, and you MAY begin with ONE emoji (e.g. "🦁 At the savanna…", "🍲 In the kitchen…", "🇹🇿 Around Tanzania…"). It sets a fun little scene.
- "fact": a "Did you know?" style fun fact about the correct answer — max 28 words, kid-friendly, genuinely interesting, plain text.
- Match the requested DIFFICULTY exactly. Vary the position of the correct answer across the set. Plain text only (no markdown, no numbering). Do NOT repeat or paraphrase any question the user asks you to avoid. No dark or scary themes.`;

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 4 },
          answer: { type: 'integer', minimum: 0, maximum: 3 },
          context: { type: 'string' },
          fact: { type: 'string' },
        },
        required: ['q', 'choices', 'answer', 'context', 'fact'],
        additionalProperties: false,
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
} as const;

interface TriviaQ { q: string; choices: string[]; answer: number; context?: string; fact?: string }

function sanitize(raw: unknown): TriviaQ[] {
  const arr = (raw as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(arr)) return [];
  const out: TriviaQ[] = [];
  for (const item of arr) {
    const it = item as TriviaQ;
    const q = it?.q; const choices = it?.choices; const answer = it?.answer;
    if (typeof q !== 'string' || !q.trim()) continue;
    if (!Array.isArray(choices) || choices.length !== 4) continue;
    if (!choices.every((c) => typeof c === 'string' && c.trim())) continue;
    if (typeof answer !== 'number' || !Number.isInteger(answer) || answer < 0 || answer > 3) continue;
    out.push({
      q: q.trim().slice(0, 200),
      choices: choices.map((c) => c.trim().slice(0, 60)),
      answer,
      context: typeof it.context === 'string' ? it.context.trim().slice(0, 48) : '',
      fact: typeof it.fact === 'string' ? it.fact.trim().slice(0, 220) : '',
    });
  }
  return out;
}

interface Body {
  subject?: string;
  country?: string;     // Local Trivia — country NAME, e.g. "Tanzania"
  discipline?: string;  // Local Trivia — one of DISCIPLINE_LABELS
  difficulty?: string;  // easy | medium | hard
  count?: number;
  avoid?: string[];     // already-seen question texts to NOT repeat
}

export async function POST(req: NextRequest) {
  if (!client) return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  let body: Body;
  try { body = (await req.json()) as Body; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const difficulty = ['easy', 'medium', 'hard'].includes(String(body.difficulty)) ? String(body.difficulty) : 'medium';
  const levelLine = LEVELS[difficulty];
  const count = Math.max(4, Math.min(40, Number(body.count) || 8));
  const avoid = Array.isArray(body.avoid) ? body.avoid.filter((s) => typeof s === 'string').slice(0, 60) : [];
  const avoidLine = avoid.length ? `\nAlready asked — do NOT repeat or rephrase any of these: ${avoid.map((s) => s.slice(0, 80)).join(' | ')}` : '';

  const country = (body.country || '').toString().trim().slice(0, 60);
  let prompt: string;
  if (country) {
    const disc = DISCIPLINE_LABELS[String(body.discipline)] || DISCIPLINE_LABELS.mixed;
    prompt = `Country: ${country}\nTopic: ${disc}\nDifficulty: ${levelLine}\nWrite ${count} fresh trivia questions specifically about ${country}. Make them genuinely local and accurate.${avoidLine}`;
  } else {
    const label = SUBJECT_LABELS[(body.subject || 'mixed').toString().trim()] || SUBJECT_LABELS.mixed;
    prompt = `Subject: ${label}\nDifficulty: ${levelLine}\nWrite ${count} fresh, varied questions for this subject.${avoidLine}`;
  }

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: Math.min(8000, 500 + count * 150),
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ questions: [] });
    const qs = sanitize(JSON.parse(text.text)).slice(0, count);
    return NextResponse.json({ questions: qs });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Trivia generation failed' }, { status: 500 });
  }
}
