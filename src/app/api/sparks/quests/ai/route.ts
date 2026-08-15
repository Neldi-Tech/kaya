// Kaya Sparks · Quests AI — pathway drafting + practice packs.
//
// Two generations, and the difference between them is the whole cost
// story (F11):
//
//   · `pathway` — drafts the WHOLE 4-8 week plan in ONE call. The parent
//     reviews it and approves it as a single batch. Daily steps then
//     cost nothing forever after. There is no daily generation.
//   · `pack`    — optional extra activities for one quest, capped at ONE
//     pack per quest per DAY, family-wide (D7). The second parent sees
//     who generated and when, and chooses to queue tomorrow's instead of
//     doubling up.
//
// D5 · NOTHING generated here reaches a child unapproved. Pack items are
//      written to `sparks_quest_pending` — a gateway-only collection, so
//      a kid cannot read them even by querying directly. Approval COPIES
//      the item into `sparks_materials`, which is the kid-visible
//      library (D6). There is no auto-publish setting, by design.
//
// D3 · the parent-only starting point IS sent to Claude (it is what
//      makes the plan good) but the system prompt forbids repeating it,
//      quoting it, or implying it back to the child. Kid-facing copy is
//      growth-voice only.
//
// D17 · AI drafting is a Home/Castle feature; Nest builds pathways by
//      hand (which works fully — see PathwayBuilder).

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;
const MODEL = 'claude-sonnet-4-6';
const TZ = process.env.SPARKS_REFLECTION_TZ || 'Africa/Dar_es_Salaam';

type DayOfWeek = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
const DOW_KEYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** D5 · only these hosts may ever be suggested as a link, and even then
 *  a parent must approve the item before a child sees it. Anything else
 *  Claude proposes is dropped server-side, silently and completely. */
const LINK_ALLOWLIST = [
  'wikipedia.org', 'wikimedia.org', 'khanacademy.org', 'ck12.org',
  'bbc.co.uk', 'natgeokids.com', 'nasa.gov', 'britannica.com',
  'youtube.com', 'youtu.be', 'ted.com', 'storyweaver.org.in',
  'gutenberg.org', 'openstax.org',
];

function hostAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return LINK_ALLOWLIST.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch { return false; }
}

function todayInTZ(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function shiftDay(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + n)).toISOString().slice(0, 10);
}

function dowOf(date: string): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return DOW_KEYS[new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay()];
}

// ── Prompts ─────────────────────────────────────────────────────────

const PATHWAY_SYSTEM = `You plan learning pathways for Kaya Quests — a family app where a parent sets one growth goal for their child and the child does one small step a day.

You will be given: the child's first name and age (if known), the GOAL, an optional PRIVATE starting point, the difficulty, minutes per day, and how many practice days the plan must fill.

Return JSON: { "steps": [ { "phase": string, "title": string, "how": string, "minutes": number, "tone": "fun" | "serious", "proofKindWanted": "note"|"photo"|"scan"|"audio"|"video" } ] }

Hard rules:
- Produce EXACTLY as many steps as the requested practiceDays count, in order.
- "phase" walks in this order across the plan: "Warm up", "Shape", "Stretch", "Perform". Roughly a quarter of the steps in each, always in that order, never going backwards.
- THE PRIVATE STARTING POINT IS CONFIDENTIAL. Use it to aim the plan. NEVER repeat it, quote it, paraphrase it, hint at it, or name the child's weakness in any "title" or "how" — the child reads every word you write here. Write only forward-looking, growth-voice instructions.
- "title" is short (under 60 characters) and reads like an instruction to the child: "Say the tongue twister 3× without tripping".
- "how" is one or two plain sentences telling the child exactly what to do. Kid-readable. No jargon.
- Alternate the mix: at least a third of the steps must be "fun" — a game, a joke, an audience, a silly constraint. A plan that is all drill gets abandoned in week two.
- "minutes" stays at or under the requested minutes per day.
- Choose "proofKindWanted" that genuinely fits: audio for anything spoken or musical, video for movement or performance, scan or photo for written or made things, note otherwise. Prefer audio over video where both would work — it is lighter on a mobile data bundle.
- Steps must build. Week 4 must be visibly harder than week 1.
- No emojis in title or how.`;

const PACK_SYSTEM = `You suggest extra practice activities for one Kaya Quest — a family app where a parent has set a growth goal for their child.

Return JSON: { "items": [ { "title": string, "why": string, "how": string, "link": string | null } ] }

Hard rules:
- Return between 3 and 5 items.
- "title" is short and concrete — what the child will actually do.
- "why" is ONE short sentence for the PARENT explaining what this builds. This is the line the parent reads while deciding whether to approve it, so make it genuinely informative, not marketing.
- "how" is one or two kid-readable sentences.
- "link" is optional and MUST be a real, stable https URL on one of: wikipedia.org, khanacademy.org, ck12.org, bbc.co.uk, natgeokids.com, nasa.gov, britannica.com, youtube.com, ted.com, storyweaver.org.in, gutenberg.org, openstax.org. If you are not confident a specific URL exists, return null. NEVER invent a URL.
- THE PRIVATE STARTING POINT IS CONFIDENTIAL: use it to aim the suggestions, never repeat or hint at it. The child reads "title" and "how".
- Age-appropriate, safe, and doable at home with ordinary things.
- No emojis.`;

const PATHWAY_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          phase: { type: 'string' },
          title: { type: 'string' },
          how: { type: 'string' },
          minutes: { type: 'number' },
          tone: { type: 'string', enum: ['fun', 'serious'] },
          proofKindWanted: { type: 'string', enum: ['note', 'photo', 'scan', 'audio', 'video'] },
        },
        required: ['phase', 'title', 'how', 'minutes', 'tone', 'proofKindWanted'],
        additionalProperties: false,
      },
    },
  },
  required: ['steps'],
  additionalProperties: false,
} as const;

const PACK_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          why: { type: 'string' },
          how: { type: 'string' },
          link: { type: ['string', 'null'] },
        },
        required: ['title', 'why', 'how', 'link'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const;

// ── Route ───────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }

  const action = String(body.action || '');
  const questId = String(body.questId || '').slice(0, 80);
  if (!questId) return NextResponse.json({ error: 'bad-quest' }, { status: 400 });

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; email?: string; displayName?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  // Everything in this route is a PARENT act: drafting a plan, generating
  // material, approving it. Kids never touch it.
  if (user?.role !== 'parent') return NextResponse.json({ error: 'parents-only' }, { status: 403 });
  const actorName = (user?.displayName || 'Parent').slice(0, 60);

  const famRef = db.collection('families').doc(familyId);
  const questRef = famRef.collection('sparks_quests').doc(questId);
  const questSnap = await questRef.get();
  if (!questSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const quest = questSnap.data() as Record<string, unknown>;
  const kidId = String(quest.kidId || '');

  // ── D17 · tier gate (operators bypass, as everywhere else) ────────
  if (action === 'pathway' || action === 'pack') {
    const fam = (await famRef.get()).data() as { tierId?: string } | undefined;
    const tierId = fam?.tierId || 'nest';
    let allowed = tierId === 'home' || tierId === 'castle';
    if (!allowed && user?.email) {
      allowed = (await db.collection('operators').doc(user.email.toLowerCase()).get()).exists;
    }
    if (!allowed) {
      return NextResponse.json({
        error: 'tier-locked',
        hint: 'AI pathway drafting and practice packs are part of Home and Castle. You can still build the whole pathway by hand on Nest — it works exactly the same once it is approved.',
      }, { status: 402 });
    }
    if (!client) return NextResponse.json({ error: 'ai-unavailable' }, { status: 503 });
  }

  // ── Pending list (parents only, always) ───────────────────────────
  if (action === 'pending') {
    const snap = await famRef.collection('sparks_quest_pending')
      .where('questId', '==', questId).get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      .sort((a, b) => Number((a as { at?: number }).at || 0) - Number((b as { at?: number }).at || 0));
    return NextResponse.json({ items });
  }

  if (action === 'approve' || action === 'reject') {
    const itemId = String(body.itemId || '').slice(0, 80);
    if (!itemId) return NextResponse.json({ error: 'bad-item' }, { status: 400 });
    const pendRef = famRef.collection('sparks_quest_pending').doc(itemId);
    const pendSnap = await pendRef.get();
    if (!pendSnap.exists) return NextResponse.json({ error: 'no-such-item' }, { status: 404 });

    if (action === 'reject') {
      await pendRef.delete();
      return NextResponse.json({ ok: true });
    }

    // D6 · approval COPIES the item into the kid-visible materials
    // library. Before that moment the item existed only in a
    // gateway-only collection, so no child could reach it at all.
    const p = pendSnap.data() as {
      title?: string; how?: string; why?: string; link?: string; questTitle?: string;
    };
    const matRef = famRef.collection('sparks_materials').doc();
    const data: Record<string, unknown> = {
      title: String(p.title || 'Practice activity').slice(0, 120),
      subject: 'Other',
      description: [p.how, p.why ? `Why: ${p.why}` : ''].filter(Boolean).join('\n\n').slice(0, 2000),
      kind: p.link ? 'link' : 'file',
      shared_with: [kidId],
      uploaded_by: uid,
      uploaded_by_name: actorName,
      // Provenance so a parent can always tell what came from AI (D6).
      source: 'ai',
      questId,
      approved_by: uid,
      approved_by_name: actorName,
      approved_at: Date.now(),
      created_at: FieldValue.serverTimestamp(),
      updated_at: FieldValue.serverTimestamp(),
    };
    if (p.link && hostAllowed(p.link)) {
      data.link_url = p.link;
      // R4 · snapshot what was approved, so a changed target can be
      // detected later rather than silently opening something new.
      data.link_snapshot = { url: p.link, approvedAt: Date.now() };
    } else {
      // A link that failed the allowlist is dropped; the activity itself
      // still stands on its own instructions.
      data.kind = 'file';
    }
    await matRef.set(data);
    await pendRef.delete();
    return NextResponse.json({ ok: true, materialId: matRef.id });
  }

  // ── Child context (first name + age) ──────────────────────────────
  const kidSnap = await famRef.collection('children').doc(kidId).get();
  const kidData = kidSnap.data() as { name?: string; birthday?: string } | undefined;
  const kidName = (kidData?.name || 'the child').split(' ')[0];
  const age = ageFrom(kidData?.birthday);

  // D3 · the confidential note. Sent to Claude, never returned to a kid.
  const priv = await famRef.collection('sparks_quest_private').doc(questId).get();
  const startingPoint = priv.exists ? String(priv.data()?.startingPoint || '') : '';

  if (action === 'pathway') {
    const weeks = clamp(Number(body.weeks), 1, 12, 6);
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate || ''))
      ? String(body.startDate) : todayInTZ();
    const activeDays: DayOfWeek[] = Array.isArray(quest.activeDays)
      ? (quest.activeDays as DayOfWeek[]).filter((d) => DOW_KEYS.includes(d))
      : ['mon', 'tue', 'wed', 'thu', 'fri'];

    const dates: string[] = [];
    for (let i = 0; i < weeks * 7; i++) {
      const date = shiftDay(startDate, i);
      if (activeDays.includes(dowOf(date))) dates.push(date);
    }
    if (!dates.length) return NextResponse.json({ error: 'no-active-days' }, { status: 400 });

    const minutes = clamp(Number(quest.minutesPerDay), 1, 120, 10);
    const userMsg = [
      `Child: ${kidName}${age ? `, age ${age}` : ''}`,
      `GOAL: ${String(quest.goal || '')}`,
      startingPoint ? `PRIVATE starting point (confidential — never repeat or hint at this): ${startingPoint}` : '',
      `Difficulty: ${String(quest.difficulty || 'medium')}`,
      `Minutes per day: ${minutes}`,
      `practiceDays: ${dates.length}`,
    ].filter(Boolean).join('\n');

    let steps: Array<Record<string, unknown>> = [];
    try {
      const r = await client!.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: [{ type: 'text', text: PATHWAY_SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: PATHWAY_SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
      });
      const t = r.content.find((b) => b.type === 'text');
      if (t && t.type === 'text') {
        steps = (JSON.parse(t.text) as { steps?: Array<Record<string, unknown>> }).steps ?? [];
      }
    } catch {
      return NextResponse.json({ error: 'ai-failed' }, { status: 502 });
    }
    if (!steps.length) return NextResponse.json({ error: 'ai-empty' }, { status: 502 });

    // Bind the model's ordered steps onto our real calendar. The dates
    // are ours, never the model's — that keeps the plan honest about
    // rest days no matter what the model returns.
    const drafts = dates.map((date, i) => {
      const s = steps[Math.min(i, steps.length - 1)] ?? {};
      return {
        date,
        phase: String(s.phase || 'Warm up').slice(0, 40),
        title: String(s.title || 'Practice').slice(0, 120),
        how: String(s.how || '').slice(0, 600),
        minutes: clamp(Number(s.minutes), 1, 120, minutes),
        tone: s.tone === 'fun' ? 'fun' : 'serious',
        proofKindWanted: ['note', 'photo', 'scan', 'audio', 'video'].includes(String(s.proofKindWanted))
          ? String(s.proofKindWanted) : 'note',
        source: 'ai' as const,
      };
    });

    // Returned for review only. Nothing is written until the parent
    // approves the batch through pathway-set (D4).
    return NextResponse.json({ drafts, weeks });
  }

  if (action === 'pack') {
    // ── D7 · one pack per quest per day, FAMILY-WIDE ────────────────
    const today = todayInTZ();
    const force = body.force === true;
    const queueForTomorrow = body.queue === true;
    const lastOn = String(quest.lastGeneratedOn || '');

    if (lastOn === today && !force && !queueForTomorrow) {
      return NextResponse.json({
        error: 'quota-used',
        by: String(quest.lastGeneratedByName || 'Someone'),
        at: Number(quest.lastGeneratedAt || 0),
        queuedForDate: quest.queuedForDate ?? null,
      }, { status: 429 });
    }

    const targetDate = queueForTomorrow ? shiftDay(today, 1) : today;

    const userMsg = [
      `Child: ${kidName}${age ? `, age ${age}` : ''}`,
      `GOAL: ${String(quest.goal || '')}`,
      startingPoint ? `PRIVATE starting point (confidential — never repeat or hint at this): ${startingPoint}` : '',
      `Difficulty: ${String(quest.difficulty || 'medium')}`,
      `Minutes available per activity: ${clamp(Number(quest.minutesPerDay), 1, 120, 10)}`,
    ].filter(Boolean).join('\n');

    let items: Array<Record<string, unknown>> = [];
    try {
      const r = await client!.messages.create({
        model: MODEL,
        max_tokens: 2000,
        system: [{ type: 'text', text: PACK_SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: PACK_SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
      });
      const t = r.content.find((b) => b.type === 'text');
      if (t && t.type === 'text') {
        items = (JSON.parse(t.text) as { items?: Array<Record<string, unknown>> }).items ?? [];
      }
    } catch {
      return NextResponse.json({ error: 'ai-failed' }, { status: 502 });
    }
    if (!items.length) return NextResponse.json({ error: 'ai-empty' }, { status: 502 });

    const now = Date.now();
    const col = famRef.collection('sparks_quest_pending');
    const batch = db.batch();
    const written: Array<Record<string, unknown>> = [];
    for (const raw of items.slice(0, 5)) {
      const link = typeof raw.link === 'string' && hostAllowed(raw.link) ? raw.link : '';
      const doc: Record<string, unknown> = {
        questId,
        kidId,
        title: String(raw.title || 'Practice activity').slice(0, 120),
        why: String(raw.why || '').slice(0, 300),
        how: String(raw.how || '').slice(0, 800),
        forDate: targetDate,
        source: 'ai',
        generatedBy: uid,
        generatedByName: actorName,
        at: now,
      };
      if (link) doc.link = link;
      const ref = col.doc();
      batch.set(ref, doc);
      written.push({ id: ref.id, ...doc });
    }
    await batch.commit();

    const patch: Record<string, unknown> = {
      lastGeneratedOn: today,
      lastGeneratedBy: uid,
      lastGeneratedByName: actorName,
      lastGeneratedAt: now,
    };
    if (queueForTomorrow) patch.queuedForDate = targetDate;
    await questRef.update(patch);

    return NextResponse.json({ items: written, forDate: targetDate });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}

function clamp(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function ageFrom(birthday: string | undefined): number | null {
  if (!birthday || !/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return null;
  const [y, m, d] = birthday.split('-').map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  const had = now.getMonth() + 1 > m || (now.getMonth() + 1 === m && now.getDate() >= d);
  if (!had) age -= 1;
  return age >= 0 && age < 25 ? age : null;
}
