// ✉️ Greeting Cards gateway (Reminders 2.0, approved 22-Aug-2026).
// One Admin-SDK route switched on `action` — the ONLY read/write path for
// `families/{id}/greetingCards` (default-deny in rules; zero rules deploy).
//   list · get · save · ready · line · decide · delete · image · post ·
//   link · revoke-link · email · chat · log · write (Kaya Writes)
// Roles: parents do everything; helpers + kids draft + co-sign; a kid/helper
// card to an OUTSIDE honoree waits for a parent nod (pending_parent); kids
// never send externally themselves (R12). Never writes `undefined`.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import {
  CARD_THEMES, cardIdFor, cardHeadline, defaultOneLiner, defaultMessage, whatsappText,
  ONE_LINER_MAX, MESSAGE_MAX, LINE_MAX,
  type GreetingCard, type CardTheme, type CardLine, type CardStatus, type DeliveryChannel,
} from '@/lib/greetingCards';
import {
  buildSignature, nthFor, displayTitle, type ReminderEvent, type GreetTo, type FamilyContact, type GreetingSignature, type ReminderType,
} from '@/lib/reminders';
import {
  APP_URL, ensureCardToken, sendCardEmail, postCardToChat, bell, kidLoginUid, familyParents, appendDelivery,
} from '@/lib/greetingCards.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const THEMES = new Set(CARD_THEMES.map((t) => t.id));
const CHANNELS: DeliveryChannel[] = ['email', 'whatsapp', 'chat', 'moments', 'link', 'download', 'share', 'nudge'];

function clamp(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function prune<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => prune(v)) as unknown as T;
  if (value && typeof value === 'object' && (value as object).constructor === Object) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) { if (v !== undefined) out[k] = prune(v); }
    return out as unknown as T;
  }
  return value;
}

type FamilySlice = {
  name?: string; contacts?: FamilyContact[]; greetingSignature?: GreetingSignature;
  greetingConfig?: { kayaWrites?: boolean };
};

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; } catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; displayName?: string; childId?: string; email?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = (user?.role === 'kid' || user?.role === 'helper') ? user.role : 'parent';
  const isParent = role === 'parent';
  const isAdult = role !== 'kid';
  const me = { uid, name: user?.displayName || (role === 'kid' ? 'A kid' : 'A parent'), role, email: user?.email || '' };

  const famRef = db.collection('families').doc(familyId);
  const cardsCol = famRef.collection('greetingCards');
  const evCol = famRef.collection('reminders');

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const action = clamp(body.action, 40);

  const loadFamily = async (): Promise<FamilySlice> => ((await famRef.get()).data() || {}) as FamilySlice;
  const loadCard = async (id: string): Promise<{ ref: FirebaseFirestore.DocumentReference; card: GreetingCard } | null> => {
    if (!id || id.length > 240) return null;
    const ref = cardsCol.doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    return { ref, card: { id: snap.id, ...(snap.data() as Omit<GreetingCard, 'id'>) } };
  };
  const canEdit = (c: GreetingCard) => isParent || c.authorUid === uid;
  const canSee = (c: GreetingCard) => isParent || c.authorUid === uid || (c as unknown as { visibility?: string }).visibility !== 'private';

  // ── list ──────────────────────────────────────────────────────────────
  if (action === 'list') {
    const snap = await cardsCol.orderBy('updatedAt', 'desc').limit(200).get().catch(() => null);
    const all = snap ? snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GreetingCard, 'id'>) })) : [];
    return NextResponse.json({ cards: all.filter(canSee) });
  }

  if (action === 'get') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ card: null });
    return NextResponse.json({ card: got.card });
  }

  // ── save (create or update editable fields) ───────────────────────────
  if (action === 'save') {
    const raw = (body.card && typeof body.card === 'object' ? body.card : {}) as Record<string, unknown>;
    const eventId = clamp(raw.eventId, 200);
    const dateKey = clamp(raw.dateKey, 10);
    if (!eventId || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return NextResponse.json({ error: 'eventId + dateKey required' }, { status: 400 });
    const id = cardIdFor(eventId, dateKey);
    const existing = await loadCard(id);
    if (existing && !canEdit(existing.card)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

    // Event truth: stored events carry type/title/greetTo; `auto:` mirrors are
    // in-family (client supplies type/title/honoree; relationship forced family).
    let type: ReminderType = 'birthday';
    let eventTitle = '';
    let honoree: GreetTo | null = null;
    let nth: number | null = null;
    let visibility: 'private' | 'shared' = 'shared';
    const fam = await loadFamily();
    if (eventId.startsWith('auto:')) {
      type = raw.type === 'anniversary' ? 'anniversary' : 'birthday';
      eventTitle = clamp(raw.eventTitle, 120) || 'Birthday';
      const h = (raw.honoree && typeof raw.honoree === 'object' ? raw.honoree : {}) as Record<string, unknown>;
      const name = clamp(h.name, 80).trim();
      if (!name) return NextResponse.json({ error: 'honoree required' }, { status: 400 });
      honoree = { name, relationship: 'family', autoSend: false, ccParents: false };
      const ch = clamp(h.childId, 128); if (ch) honoree.childId = ch;
      const mu = clamp(h.memberUid, 128); if (mu) honoree.memberUid = mu;
      const n = Number(raw.nth); if (Number.isFinite(n) && n > 0 && n < 200) nth = Math.round(n);
    } else {
      const ev = (await evCol.doc(eventId).get()).data() as ReminderEvent | undefined;
      if (!ev) return NextResponse.json({ error: 'event-not-found' }, { status: 404 });
      if (ev.type !== 'birthday' && ev.type !== 'anniversary' && ev.type !== 'event') return NextResponse.json({ error: 'not-card-eligible' }, { status: 400 });
      if (!ev.greetTo) return NextResponse.json({ error: 'no-honoree' }, { status: 400 });
      type = ev.type; eventTitle = displayTitle({ ...ev, id: eventId }, dateKey); honoree = ev.greetTo; visibility = ev.visibility;
      nth = nthFor({ ...ev, id: eventId }, dateKey);
    }

    const lang: 'en' | 'sw' = raw.lang === 'sw' ? 'sw' : 'en';
    const theme: CardTheme = THEMES.has(raw.theme as CardTheme) ? (raw.theme as CardTheme) : (existing?.card.theme || 'classic');
    const accentRaw = clamp(raw.accent, 9);
    const accent = /^#[0-9A-Fa-f]{6}$/.test(accentRaw) ? accentRaw : undefined;
    const stickers = Array.isArray(raw.stickers) ? (raw.stickers as unknown[]).filter((s) => typeof s === 'string').map((s) => (s as string).slice(0, 8)).slice(0, 6) : (existing?.card.stickers || []);
    const photoRaw = clamp(raw.photoUrl, 1000);
    const photoUrl = /^https:\/\//.test(photoRaw) ? photoRaw : undefined;
    const oneLiner = clamp(raw.oneLiner, ONE_LINER_MAX).trim();
    const message = clamp(raw.message, MESSAGE_MAX).trim();

    // Signature — server computes from family truth (R9).
    const parents = await familyParents(db, familyId);
    const kidsSnap = await famRef.collection('children').get();
    const kidNames = kidsSnap.docs.map((d) => (d.data() as { name?: string }).name || '').filter(Boolean);
    const authorName = existing?.card.authorName || me.name;
    const authorRole = existing?.card.authorRole || role;
    const sig = buildSignature({
      parentNames: parents.map((p) => p.name), familyName: fam.name || '', kidNames,
      authorName, authorRole, relationship: honoree.relationship, lang, signature: fam.greetingSignature,
    });

    const keepStatus: CardStatus = existing?.card.status === 'sent' || existing?.card.status === 'belated' ? existing.card.status : (existing?.card.status === 'pending_parent' ? 'pending_parent' : 'draft');
    const now = Date.now();
    const base: Record<string, unknown> = prune({
      familyId, eventId, dateKey, type, eventTitle, nth, honoree, visibility,
      theme, accent, stickers, photoUrl, oneLiner, message, lang,
      signatureLine: sig.line, signatureRoster: sig.roster,
      status: existing ? keepStatus : 'draft',
      isDefault: false,
      updatedAt: now,
    });
    if (!existing) {
      Object.assign(base, { lines: [], authorUid: uid, authorName: me.name, authorRole: role, createdAt: now, sentKeys: [], deliveries: [] });
    } else {
      // Clearing optional fields on edit.
      if (!accent) base.accent = FieldValue.delete();
      if (!photoUrl) base.photoUrl = FieldValue.delete();
    }
    await cardsCol.doc(id).set(base, { merge: true });
    const saved = await loadCard(id);
    return NextResponse.json({ card: saved?.card });
  }

  // ── ready / draft toggle ──────────────────────────────────────────────
  if (action === 'ready') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (!canEdit(got.card)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    const ready = body.ready !== false;
    let status: CardStatus = ready ? 'ready' : 'draft';
    if (ready && !isParent && got.card.honoree.relationship !== 'family') {
      status = 'pending_parent';
      for (const p of await familyParents(db, familyId)) {
        await bell(db, familyId, p.uid, { title: '✉️ Card needs your nod', message: `${me.name} made a card for ${got.card.honoree.name}. Review it before it goes out.`, link: '/reminders' });
      }
    }
    await got.ref.set({ status, updatedAt: Date.now() }, { merge: true });
    return NextResponse.json({ card: { ...got.card, status } });
  }

  // ── co-sign line ──────────────────────────────────────────────────────
  if (action === 'line') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const text = clamp(body.text, LINE_MAX).trim();
    if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });
    if ((got.card.lines || []).length >= 12) return NextResponse.json({ error: 'too-many-lines' }, { status: 400 });
    const line: CardLine = { uid, name: me.name, text, at: Date.now(), ...(role === 'kid' ? { kid: true } : {}) };
    await got.ref.set({ lines: FieldValue.arrayUnion(line), updatedAt: Date.now() }, { merge: true });
    if (got.card.authorUid !== uid) {
      await bell(db, familyId, got.card.authorUid, { title: '🖋️ Someone signed the card', message: `${me.name} added a line to ${got.card.honoree.name}'s card.`, link: '/reminders' });
    }
    return NextResponse.json({ card: { ...got.card, lines: [...(got.card.lines || []), line] } });
  }

  // ── parent decide ─────────────────────────────────────────────────────
  if (action === 'decide') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const got = await loadCard(clamp(body.id, 240));
    if (!got) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const approve = body.decision === 'approve';
    const status: CardStatus = approve ? 'ready' : 'draft';
    await got.ref.set({ status, decidedBy: uid, decidedAt: Date.now(), updatedAt: Date.now() }, { merge: true });
    await bell(db, familyId, got.card.authorUid, {
      title: approve ? '✅ Your card is approved' : '✏️ Card sent back',
      message: approve ? `${me.name} approved your card for ${got.card.honoree.name}. It's ready to go.` : `${me.name} sent your card for ${got.card.honoree.name} back for a tweak.`,
      link: '/reminders',
    });
    return NextResponse.json({ card: { ...got.card, status } });
  }

  if (action === 'delete') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got) return NextResponse.json({ ok: true });
    if (!canEdit(got.card)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    await got.ref.delete();
    return NextResponse.json({ ok: true });
  }

  if (action === 'image') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const imageUrl = clamp(body.imageUrl, 1200);
    if (!/^https:\/\//.test(imageUrl)) return NextResponse.json({ error: 'bad-url' }, { status: 400 });
    await got.ref.set({ imageUrl, updatedAt: Date.now() }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  if (action === 'post') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const postId = clamp(body.postId, 120);
    await got.ref.set({ momentsPostId: postId, updatedAt: Date.now() }, { merge: true });
    await appendDelivery(got.ref, { channel: 'moments', at: Date.now(), ok: true, by: me.name, mode: 'manual' });
    return NextResponse.json({ ok: true });
  }

  if (action === 'link') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const r = await ensureCardToken(db, got.ref, got.card);
    return NextResponse.json(r);
  }

  if (action === 'revoke-link') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canEdit(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (got.card.publicToken) await db.collection('shareTokens').doc(got.card.publicToken).delete().catch(() => {});
    await got.ref.set({ publicToken: FieldValue.delete(), publicTokenAt: FieldValue.delete(), updatedAt: Date.now() }, { merge: true });
    return NextResponse.json({ ok: true });
  }

  // ── email now (manual) ────────────────────────────────────────────────
  if (action === 'email') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    if (!isAdult) return NextResponse.json({ error: 'parent-needed' }, { status: 403 });
    if (got.card.status === 'pending_parent' && !isParent) return NextResponse.json({ error: 'awaiting-parent' }, { status: 403 });
    if (got.card.honoree.relationship === 'family') return NextResponse.json({ error: 'in-family' }, { status: 400 });
    const fam = await loadFamily();
    const r = await sendCardEmail({ db, familyId, familyName: fam.name || '', cardRef: got.ref, card: got.card, contacts: fam.contacts, sender: me, mode: 'manual' });
    if (!r.ok) return NextResponse.json({ error: r.skipped || r.error || 'send-failed' }, { status: 400 });
    return NextResponse.json({ ok: true, to: r.to });
  }

  // ── drop in family chat ───────────────────────────────────────────────
  if (action === 'chat') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const link = got.card.publicToken ? `${APP_URL}/c/${got.card.publicToken}` : null;
    const head = cardHeadline(got.card.type, got.card.nth, got.card.lang, got.card.eventTitle);
    const text = got.card.honoree.relationship === 'family'
      ? `✉️ ${head}, ${got.card.honoree.name}! “${got.card.oneLiner || defaultOneLiner(got.card)}” — ${got.card.signatureLine}`
      : `💌 Card for ${got.card.honoree.name} — ${head}. “${got.card.oneLiner || defaultOneLiner(got.card)}”${link ? ` · ${link}` : ''}`;
    const ok = await postCardToChat(db, familyId, got.card, me, text, got.card.imageUrl);
    if (!ok) return NextResponse.json({ error: 'no-family-chat' }, { status: 400 });
    await appendDelivery(got.ref, { channel: 'chat', at: Date.now(), ok: true, by: me.name, mode: 'manual' });
    return NextResponse.json({ ok: true });
  }

  if (action === 'log') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const channel = clamp(body.channel, 16) as DeliveryChannel;
    if (!CHANNELS.includes(channel)) return NextResponse.json({ error: 'bad-channel' }, { status: 400 });
    const to = clamp(body.to, 160);
    const extra: Record<string, unknown> = {};
    // WhatsApp tap-to-send on/after the day counts as delivered (Phase A).
    if (channel === 'whatsapp' && got.card.status !== 'sent' && got.card.status !== 'belated') extra.status = 'sent';
    await appendDelivery(got.ref, { channel, at: Date.now(), ok: true, by: me.name, mode: 'manual', ...(to ? { to } : {}) }, extra);
    return NextResponse.json({ ok: true });
  }

  if (action === 'whatsapp-text') {
    const got = await loadCard(clamp(body.id, 240));
    if (!got || !canSee(got.card)) return NextResponse.json({ error: 'not-found' }, { status: 404 });
    const r = await ensureCardToken(db, got.ref, got.card);
    return NextResponse.json({ text: whatsappText(got.card, r.url), url: r.url, phone: got.card.honoree.whatsapp || null });
  }

  // ── ✨ Kaya Writes ────────────────────────────────────────────────────
  if (action === 'write') {
    const fam = await loadFamily();
    if (fam.greetingConfig?.kayaWrites === false) return NextResponse.json({ suggestions: [], skipped: true, reason: 'off' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return NextResponse.json({ suggestions: [], skipped: true, reason: 'ANTHROPIC_API_KEY not set' });

    const eventId = clamp(body.eventId, 200);
    const dateKey = clamp(body.dateKey, 10);
    const voice = body.voice === 'funny' ? 'funny' : body.voice === 'formal' ? 'formal' : 'warm';
    const lang = body.lang === 'sw' ? 'sw' : body.lang === 'mix' ? 'mix' : 'en';
    const length = body.length === 'one' ? 'one' : body.length === 'long' ? 'long' : 'short';
    const refine = clamp(body.refine, 120).trim();
    const seed = clamp(body.seed, 400).trim();

    // Context: event + honoree (+ relation label) + last year's card (album).
    let type: ReminderType = 'birthday'; let title = ''; let nth: number | null = null; let honoree: GreetTo | null = null;
    if (eventId.startsWith('auto:')) {
      const existing = await loadCard(cardIdFor(eventId, dateKey));
      if (existing) { type = existing.card.type; title = existing.card.eventTitle; nth = existing.card.nth || null; honoree = existing.card.honoree; }
      else { title = clamp(body.eventTitle, 120); const h = (body.honoree || {}) as Record<string, unknown>; honoree = { name: clamp(h.name, 80) || 'our family member', relationship: 'family', autoSend: false, ccParents: false }; const n = Number(body.nth); if (Number.isFinite(n) && n > 0) nth = n; type = body.type === 'anniversary' ? 'anniversary' : 'birthday'; }
    } else {
      const ev = (await evCol.doc(eventId).get()).data() as ReminderEvent | undefined;
      if (!ev || !ev.greetTo) return NextResponse.json({ error: 'no-honoree' }, { status: 400 });
      type = ev.type; title = displayTitle({ ...ev, id: eventId }, dateKey); nth = nthFor({ ...ev, id: eventId }, dateKey); honoree = ev.greetTo;
    }
    const contact = honoree.contactId ? (fam.contacts || []).find((c) => c.id === honoree!.contactId) : undefined;
    const relation = contact?.relation || (honoree.relationship === 'kid-friend' ? "a kid's friend" : honoree.relationship === 'family' ? 'family member' : 'adult relative/friend');
    // Album — previous cards to the same person.
    let lastYear = '';
    try {
      const prev = await cardsCol.where('honoree.name', '==', honoree.name).orderBy('dateKey', 'desc').limit(3).get();
      const older = prev.docs.map((d) => d.data() as GreetingCard).filter((c) => c.dateKey < dateKey && c.oneLiner);
      if (older[0]) lastYear = older[0].oneLiner;
    } catch { /* index-less fallback: skip */ }
    const parents = await familyParents(db, familyId);
    const kidsSnap = await famRef.collection('children').get();
    const kidNames = kidsSnap.docs.map((d) => (d.data() as { name?: string }).name || '').filter(Boolean);
    const sig = buildSignature({ parentNames: parents.map((p) => p.name), familyName: fam.name || '', kidNames, authorName: me.name, authorRole: role, relationship: honoree.relationship, lang: lang === 'sw' ? 'sw' : 'en', signature: fam.greetingSignature });
    const headline = cardHeadline(type, nth, lang === 'sw' ? 'sw' : 'en', title);

    const SYSTEM = `You are Kaya Writes — the greeting-card pen of a warm family app used in East Africa and worldwide. You draft a ONE-LINER for the front of a card (max ${ONE_LINER_MAX} characters, no quotes, no emoji unless playful voice) and a short inside MESSAGE. Rules: be specific to the relationship and milestone; never invent facts (no names of people, places, gifts, illnesses, or events not given); no clichés stacked; no hashtags; end the message warmly without a signature line (the card signs itself). Kiswahili must be natural Tanzanian Swahili. Return exactly 3 suggestions in the requested voice (vary them), each with oneLiner + message. ${role === 'kid' ? 'The AUTHOR IS A CHILD: write in first person as that child, short simple words, only shape what the child said in the seed — if the seed is empty, offer gentle age-appropriate lines a child could say.' : ''}`;
    const lengthNote = length === 'one' ? 'message: ONE sentence.' : length === 'long' ? 'message: 4–6 sentences.' : 'message: 2–3 sentences.';
    const langNote = lang === 'sw' ? 'Language: Kiswahili.' : lang === 'mix' ? 'Language: English with a warm Kiswahili phrase woven in (e.g. tunakupenda sana, heri ya kuzaliwa).' : 'Language: English.';
    const userMsg = [
      `Occasion: ${headline} (${type}${nth ? `, the ${nth}th` : ''}) — event title "${title}", date ${dateKey}.`,
      `Honoree: ${honoree.name} — ${relation} (${honoree.relationship}).`,
      `Author: ${me.name} (${role}). Card will be signed: "${sig.line}".`,
      `Voice: ${voice}. ${langNote} ${lengthNote}`,
      lastYear ? `Last year's one-liner to this person (do NOT repeat, be fresh): "${lastYear}".` : '',
      seed ? `Seed from the author (shape this, keep its meaning): "${seed}".` : '',
      refine ? `Refinement requested: ${refine}.` : '',
    ].filter(Boolean).join('\n');

    const SCHEMA = {
      type: 'object',
      properties: {
        suggestions: {
          type: 'array', minItems: 3, maxItems: 3,
          items: { type: 'object', properties: { voice: { type: 'string' }, oneLiner: { type: 'string' }, message: { type: 'string' } }, required: ['voice', 'oneLiner', 'message'], additionalProperties: false },
        },
      },
      required: ['suggestions'], additionalProperties: false,
    } as const;
    try {
      const { default: Anthropic } = await import('@anthropic-ai/sdk');
      const client = new Anthropic({ apiKey });
      const r = await client.messages.create({
        model: 'claude-sonnet-4-6', max_tokens: 1200,
        system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{ role: 'user', content: [{ type: 'text', text: userMsg }] }],
      } as unknown as Parameters<typeof client.messages.create>[0]);
      const t = (r as unknown as { content: Array<{ type: string; text?: string }> }).content.find((b) => b.type === 'text');
      if (!t?.text) return NextResponse.json({ error: 'ai-empty' }, { status: 502 });
      const parsed = JSON.parse(t.text) as { suggestions?: Array<{ voice?: string; oneLiner?: string; message?: string }> };
      const suggestions = (parsed.suggestions || []).slice(0, 3).map((s) => ({
        voice: clamp(s.voice, 20) || voice,
        oneLiner: clamp(s.oneLiner, ONE_LINER_MAX).replace(/^["“]|["”]$/g, '').trim(),
        message: clamp(s.message, MESSAGE_MAX).trim(),
      })).filter((s) => s.oneLiner);
      return NextResponse.json({ suggestions });
    } catch (e) {
      return NextResponse.json({ error: 'ai-failed', detail: e instanceof Error ? e.message.slice(0, 200) : '' }, { status: 502 });
    }
  }

  // ── default card materialiser (used by the cron; exposed for tests) ───
  if (action === 'ensure-default') {
    if (!isParent) return NextResponse.json({ error: 'parents-only' }, { status: 403 });
    const eventId = clamp(body.eventId, 200); const dateKey = clamp(body.dateKey, 10);
    const ev = (await evCol.doc(eventId).get()).data() as ReminderEvent | undefined;
    if (!ev?.greetTo) return NextResponse.json({ error: 'no-honoree' }, { status: 400 });
    const id = cardIdFor(eventId, dateKey);
    const existing = await loadCard(id);
    if (existing) return NextResponse.json({ card: existing.card });
    const fam = await loadFamily();
    const parents = await familyParents(db, familyId);
    const sig = buildSignature({ parentNames: parents.map((p) => p.name), familyName: fam.name || '', kidNames: [], authorName: 'Kaya', authorRole: 'parent', relationship: ev.greetTo.relationship, lang: 'en', signature: fam.greetingSignature });
    const nth = nthFor({ ...ev, id: eventId }, dateKey);
    const partial = { type: ev.type, nth, lang: 'en' as const, honoree: ev.greetTo };
    const card: Omit<GreetingCard, 'id'> = {
      familyId, eventId, dateKey, type: ev.type, eventTitle: displayTitle({ ...ev, id: eventId }, dateKey), nth, honoree: ev.greetTo,
      theme: ev.type === 'anniversary' ? 'night' : 'classic', stickers: ev.type === 'birthday' ? ['✨', '🎈'] : ['✨'],
      oneLiner: defaultOneLiner(partial), message: defaultMessage(partial, sig.line), lines: [], lang: 'en',
      signatureLine: sig.line, ...(sig.roster ? { signatureRoster: sig.roster } : {}),
      status: 'ready', authorUid: 'kaya', authorName: 'Kaya', authorRole: 'parent', isDefault: true, sentKeys: [], deliveries: [], createdAt: Date.now(), updatedAt: Date.now(),
    };
    await cardsCol.doc(id).set(prune(card));
    return NextResponse.json({ card: { id, ...card } });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
