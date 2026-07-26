// 🪄 Badge Studio (BDG PR5 · B21) — describe a badge in words, Kaya proposes
// the whole thing: name, icon, tier, area, a fair threshold, and WHICH signal
// tracks it. Nothing is saved here — the route only returns a proposal; the
// parent taps Release in the Boutique, which writes it to badgeConfig.customs.
//
// The signal choice is constrained to the counters Kaya actually keeps, so a
// Studio badge is as real as a catalog one. If the description isn't something
// Kaya can measure, the model must answer `parent_confirm` and say so — an
// honest "you'll award this by hand" beats a badge that never fires.
//
// Fails SAFE: { skipped: true } without ANTHROPIC_API_KEY so the Studio just
// tells the parent to fill the fields in manually.

import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { BADGE_AREAS } from '@/lib/badgeLib';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

// The counters each area's flow really bumps (BDG PR3) — the model may only
// pick from these, or say parent_confirm.
const TRACKERS = `
- lifetime_points (threshold = points) — total House Points ever earned
- streak_days (threshold = days) — perfect daily-routine streak
- quiz_correct (threshold = count) — correct daily questions
- workplan_done (threshold = count) — workplan/chore items completed
- meetings (threshold = count) — family meetings attended
- conversions (threshold = count) — House Points converted to Coins
- goals_reached (threshold = count) — family goals reached together
- diamonds (threshold = count) — Diamond awards received
- award_kindness / award_helping / award_giving / award_workplan / award_game (threshold = count) — awards in that category
- parent_confirm (no threshold) — Kaya cannot measure it; a parent awards it by hand
`;

const SYSTEM = `You design achievement badges for Kaya, a warm family app used by kids aged ~4–17.

Rules:
- Speak to kids: the "how" line is short, second-person, and concrete ("Read 10 books this term").
- Pick ONE tracker from the list the app gives you. Choose parent_confirm ONLY when nothing on the list could ever measure the description — never as a lazy default.
- The threshold must be reachable by a real child in weeks, not years. Prefer a number the family would recognise as fair.
- icon: exactly one emoji. name: 1–3 words, title case, no quotes.
- tier: easy (weeks), medium (a month or two), hard (a term), legendary (a rare, standout achievement).
- area: the closest match from the app's list.
- The description may be in any language (English, Swahili…). Reply in the SAME language the parent used for name/how.
- note: one short sentence for the parent explaining what will be tracked, or why it must be awarded by hand.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'icon', 'tier', 'area', 'how', 'tracker', 'note'],
  properties: {
    name: { type: 'string', maxLength: 40 },
    icon: { type: 'string', maxLength: 8 },
    tier: { type: 'string', enum: ['easy', 'medium', 'hard', 'legendary'] },
    area: { type: 'string', enum: BADGE_AREAS.map((a) => a.id) },
    how: { type: 'string', maxLength: 90 },
    tracker: {
      type: 'string',
      enum: [
        'lifetime_points', 'streak_days', 'quiz_correct', 'workplan_done', 'meetings',
        'conversions', 'goals_reached', 'diamonds',
        'award_kindness', 'award_helping', 'award_giving', 'award_workplan', 'award_game',
        'parent_confirm',
      ],
    },
    threshold: { type: 'integer', minimum: 1, maximum: 100000 },
    note: { type: 'string', maxLength: 160 },
  },
} as const;

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  // Designing badges is a parent's job — a kid uses 💭 wishes instead.
  const prof = (await db.collection('users').doc(uid).get()).data() as { role?: string; familyId?: string } | undefined;
  if (!prof?.familyId) return NextResponse.json({ ok: false, error: 'no-family' }, { status: 403 });
  if (prof.role !== 'parent') return NextResponse.json({ ok: false, error: 'parents-only' }, { status: 403 });

  let body: { description?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const description = (body.description || '').trim().slice(0, 400);
  if (!description) return NextResponse.json({ ok: false, error: 'missing-description' }, { status: 400 });

  if (!client) return NextResponse.json({ ok: true, skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

  const areaList = BADGE_AREAS.map((a) => `${a.id} (${a.emoji} ${a.label})`).join(', ');
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [{
          type: 'text',
          text: `Trackers available:${TRACKERS}\nAreas: ${areaList}\n\nParent's description of the badge they want:\n"""${description}"""`,
        }],
      }],
    });
    const text = response.content.find((b) => b.type === 'text');
    if (!text || text.type !== 'text') return NextResponse.json({ ok: false, error: 'no-proposal' }, { status: 502 });
    const p = JSON.parse(text.text) as Record<string, unknown>;

    // A measurable tracker with no usable threshold is not measurable — fall
    // back to parent_confirm rather than shipping a badge that never fires.
    const tracker = String(p.tracker || 'parent_confirm');
    const thresholdRaw = Number(p.threshold);
    const threshold = Number.isFinite(thresholdRaw) && thresholdRaw >= 1 ? Math.floor(thresholdRaw) : 0;
    const usable = tracker !== 'parent_confirm' && threshold > 0;

    return NextResponse.json({
      ok: true,
      proposal: {
        name: String(p.name || '').slice(0, 40) || 'New Badge',
        icon: String(p.icon || '🏅').slice(0, 8),
        tier: String(p.tier || 'medium'),
        area: String(p.area || 'family'),
        how: String(p.how || '').slice(0, 90),
        tracker: usable ? tracker : 'parent_confirm',
        threshold: usable ? threshold : 0,
        note: String(p.note || '').slice(0, 160),
      },
    });
  } catch (e: unknown) {
    if (e instanceof Anthropic.APIError) return NextResponse.json({ ok: false, error: e.message }, { status: e.status ?? 500 });
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'studio-failed' }, { status: 500 });
  }
}
