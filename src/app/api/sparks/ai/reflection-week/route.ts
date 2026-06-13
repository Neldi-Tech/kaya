// Slice 7o · Daily Reflection · weekly review (Section C of design).
//
// Given a kid's 7 days of reflection entries, Claude Sonnet returns
// a structured summary: streak status, themes Kaya read, verbatim
// highlight quotes, per-day mood emojis, and a 1-line tip for the
// week ahead. Output is persisted by the Sunday cron (see
// /api/cron/sparks-reflection-weekly) at
//   /families/{f}/sparks_reflection_weeks/{kidId}_{YYYY-WW}.
//
// Skips with `{ skipped: true }` when ANTHROPIC_API_KEY is absent.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

interface WeekBody {
  kidName: string;
  /** YYYY-WW the review covers (e.g. 2026-W24). */
  weekKey: string;
  /** Up to 7 entries · oldest → newest. */
  entries: Array<{ date: string; text: string }>;
}

const SYSTEM = `You read a child's 5–7 daily reflections from one school week and write a structured weekly review for Kaya Sparks. The output is shown on the kid's reflection page and emailed to parents — keep it warm, specific, and never preachy.

Return JSON: {
  "themes":       [ { "label": "short noun", "emoji": "single emoji", "count": int } ],   // 2-4 top themes you noticed across the week
  "highlights":   [ { "date": "YYYY-MM-DD", "quote": "verbatim sentence the kid wrote" } ],  // 1-3 of the best lines, exact words
  "mood_by_day":  [ { "date": "YYYY-MM-DD", "emoji": "single emoji" } ],  // one per entry the kid logged · skip days they missed
  "mood_summary": "1 short sentence on the week's mood arc — gentle, never alarming",
  "tip":          "1 short sentence — one specific thing to try writing about next week",
  "highlight_for_parent": "1 short sentence the parent reads first in an email — names the kid + the standout moment"
}

Rules:
- Specific over generic: cite topics the kid actually wrote about.
- Highlights MUST be verbatim sentences from the entries — never paraphrase.
- Mood is read from the kid's own words; if they wrote about a low day, name it gently ("Wednesday was quieter").
- Tip is constructive ("try writing about something that surprised you"), never a lecture.
- Use the kid's first name at most once across the whole response.`;

const SCHEMA = {
  type: 'object',
  properties: {
    themes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          emoji: { type: 'string' },
          count: { type: 'number' },
        },
        required: ['label', 'emoji', 'count'],
        additionalProperties: false,
      },
    },
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          quote: { type: 'string' },
        },
        required: ['date', 'quote'],
        additionalProperties: false,
      },
    },
    mood_by_day: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string' },
          emoji: { type: 'string' },
        },
        required: ['date', 'emoji'],
        additionalProperties: false,
      },
    },
    mood_summary: { type: 'string' },
    tip: { type: 'string' },
    highlight_for_parent: { type: 'string' },
  },
  required: ['themes', 'highlights', 'mood_by_day', 'mood_summary', 'tip', 'highlight_for_parent'],
  additionalProperties: false,
} as const;

export async function POST(req: NextRequest) {
  if (!client) {
    return NextResponse.json({ skipped: true, reason: 'ANTHROPIC_API_KEY not set' });
  }

  let body: WeekBody;
  try {
    body = (await req.json()) as WeekBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const kidName = (body?.kidName || '').trim().slice(0, 60) || 'the child';
  const weekKey = (body?.weekKey || '').trim();
  const entries = Array.isArray(body?.entries) ? body.entries.slice(0, 7) : [];
  if (entries.length === 0) {
    return NextResponse.json({ error: 'No entries to review' }, { status: 400 });
  }

  const entriesText = entries
    .map((e) => `[${e.date}] ${e.text.replace(/\s+/g, ' ').trim()}`)
    .join('\n');
  const userText = `Kid: ${kidName}\nWeek: ${weekKey}\n${entries.length} entry/entries:\n\n${entriesText}`;

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') {
      return NextResponse.json({ error: 'No response' }, { status: 500 });
    }
    return NextResponse.json(JSON.parse(text.text));
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) {
      return NextResponse.json({ error: e.message }, { status: e.status ?? 500 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Weekly review failed' },
      { status: 500 },
    );
  }
}
