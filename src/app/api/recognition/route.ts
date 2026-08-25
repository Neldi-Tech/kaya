// 🌟 Recognition Rounds — Admin gateway (RR PR-2).
//
// ALL Shine-Card + round reads/writes flow through here (Diary idiom):
// the Admin SDK bypasses client rules, so NO firestore.rules changes are
// needed for the new `shineCards` / `recognitionRounds` collections.
// Authorisation happens in this file: Bearer ID token → users/{uid} must
// belong to the family; per-action role/ownership checks below.
//
// Cards are the MEMORY layer only — the award itself (points, badges,
// kid email) always rides the existing award rail before a card exists.

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import {
  isDismissCode, dismissKey, dismissReason, DISMISS_NOTE_MAX, ROUND_WINDOW_MS, DISMISS_MEMORY_DAYS,
  type RoundDismissal,
} from '@/lib/recognitionDismiss';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Action =
  | 'card-create' | 'card-list' | 'card-theme' | 'card-note' | 'card-echo'
  | 'card-set-post' | 'card-email' | 'card-delete' | 'card-gift' | 'card-lang'
  | 'round-get' | 'round-list'
  | 'round-dismiss' | 'round-undismiss' | 'dismissals-list' | 'helper-round-get';

const CARD_LIMIT = 120;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) {
    return NextResponse.json({ error: 'admin-sdk-not-configured' }, { status: 503 });
  }

  let uid: string;
  try {
    const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    uid = (await adminAuth.verifyIdToken(token)).uid;
  } catch {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as Action;
  const familyId = String(body.familyId || '');
  if (!action || !familyId) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.data() as { familyId?: string; role?: string; childId?: string; displayName?: string } | undefined;
  if (!user || user.familyId !== familyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const isParent = user.role === 'parent';
  const isAdult = isParent || user.role === 'helper';
  const famRef = db.collection('families').doc(familyId);
  const cardsCol = famRef.collection('shineCards');

  // Kid login uid for a childId (bells go to login uids).
  const kidLoginUid = async (childId: string): Promise<string | null> => {
    const s = await db.collection('users')
      .where('familyId', '==', familyId)
      .where('childId', '==', childId)
      .limit(1).get();
    return s.empty ? null : s.docs[0].id;
  };
  const bell = async (forUserId: string, note: { type: string; title: string; message: string; link: string }) => {
    await famRef.collection('notifications').add({
      ...note, forUserId, read: false, createdAt: new Date(),
    }).catch(() => { /* best-effort */ });
  };

  try {
    switch (action) {
      case 'card-create': {
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { kidId, kidName, kidEmoji, awardId, theme, quote, kindLabel, pointsLabel, category, roundDate, gift, giftMeta } = body;
        if (!kidId || !quote) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

        // 🧡 HR PR-2 — Asante cards celebrate a HELPER. Parents only,
        // own № series (asanteCount), no Double-Shine / kid milestones.
        const isHelperCard = body.subject === 'helper';
        if (isHelperCard && (!isParent || !body.helperUid)) {
          return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        }
        const counterField = isHelperCard ? 'recognitionStats.asanteCount' : 'recognitionStats.cardCount';

        // № via transactional counter on the family doc.
        const n = await db.runTransaction(async (tx) => {
          const famSnap = await tx.get(famRef);
          const stats = (famSnap.data() as { recognitionStats?: { cardCount?: number; asanteCount?: number } })?.recognitionStats;
          const next = ((isHelperCard ? stats?.asanteCount : stats?.cardCount) || 0) + 1;
          tx.update(famRef, { [counterField]: next });
          return next;
        });

        // 🤝 Double Shine — another adult celebrated this kid today.
        // Equality-only query (auto index); the day filter runs in code.
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const partner = isHelperCard ? undefined : (await cardsCol.where('kidId', '==', kidId).get()).docs.find((d) => {
          const c = d.data() as { by?: string; at?: number };
          return c.by !== uid && (c.at || 0) >= dayStart.getTime();
        });
        const doubleShine = !!partner;

        const card = {
          n,
          kidId,
          kidName: String(kidName || 'Kid'),
          kidEmoji: String(kidEmoji || '🧒'),
          ...(awardId ? { awardId: String(awardId) } : {}),
          theme: String(theme || 'classic'),
          quote: String(quote).slice(0, 400),
          by: uid,
          byName: String(user.displayName || 'Parent').split(' ')[0],
          at: Date.now(),
          kindLabel: String(kindLabel || '⭐ Award'),
          pointsLabel: String(pointsLabel || ''),
          ...(category ? { category: String(category) } : {}),
          ...(roundDate ? { roundDate: String(roundDate) } : {}),
          ...(gift ? { gift: String(gift).slice(0, 80) } : {}),
          // 🎁 FX PR-5 — structured record so gift statistics can be
          // computed later (label + store/custom/surprise + rewardId).
          ...(giftMeta && typeof giftMeta === 'object' ? {
            giftMeta: {
              label: String((giftMeta as { label?: string }).label || gift || '').slice(0, 80),
              source: ['store', 'custom', 'surprise'].includes(String((giftMeta as { source?: string }).source)) ? String((giftMeta as { source?: string }).source) : 'custom',
              ...((giftMeta as { rewardId?: string }).rewardId ? { rewardId: String((giftMeta as { rewardId?: string }).rewardId) } : {}),
              // FX PR-8 — the pathway seals the record: 💎 Treasures,
              // 💰 Hive (with the amount), or 🎈 simple.
              ...(['treasure', 'hive', 'simple'].includes(String((giftMeta as { pathway?: string }).pathway)) ? { pathway: String((giftMeta as { pathway?: string }).pathway) } : {}),
              ...(Number.isInteger((giftMeta as { amountCents?: number }).amountCents) && ((giftMeta as { amountCents?: number }).amountCents as number) > 0 ? { amountCents: (giftMeta as { amountCents?: number }).amountCents } : {}),
            },
          } : {}),
          doubleShine,
          notes: [] as unknown[],
          ...(isHelperCard ? { subject: 'helper', helperUid: String(body.helperUid) } : {}),
          ...(body.lang === 'sw' || body.lang === 'en' ? { lang: body.lang } : {}),
          // 💬 HR PR-4 — a kid's own words on the card.
          ...(typeof body.kidsLine === 'string' && body.kidsLine.trim() ? { kidsLine: String(body.kidsLine).trim().slice(0, 140) } : {}),
        };
        const ref = await cardsCol.add(card);
        if (doubleShine && partner) {
          await partner.ref.update({ doubleShine: true }).catch(() => {});
        }

        if (isHelperCard) {
          // The helper's bell — bilingual to match the card.
          await bell(String(body.helperUid), body.lang === 'sw'
            ? { type: 'reward', title: `🧡 Kadi ya Asante №${n} kwa ajili yako!`, message: card.quote.slice(0, 90), link: '/pantry/workplan' }
            : { type: 'reward', title: `🧡 Asante Card №${n} for you!`, message: card.quote.slice(0, 90), link: '/pantry/workplan' });
        } else {
          const kidUid = await kidLoginUid(kidId);
          if (kidUid) {
            await bell(kidUid, doubleShine
              ? { type: 'reward', title: '🎊 Double Shine!', message: 'Mum AND Dad noticed — a golden Shine Card is on your wall!', link: '/profiles' }
              : { type: 'reward', title: `🌟 Shine Card №${n} for you!`, message: card.quote.slice(0, 90), link: '/profiles' });
          }
        }

        // 🏆 RR PR-4 — Shine milestones: the family's 25th/50th/100th/…
        // card is worth celebrating itself. Golden moment: everyone's
        // bells + an automatic Moments post from Kaya.
        const MILESTONES = new Set([10, 25, 50, 100, 150, 200, 300, 400, 500]);
        if (!isHelperCard && MILESTONES.has(n)) {
          try {
            const membersSnap = await db.collection('users').where('familyId', '==', familyId).get();
            await Promise.all(membersSnap.docs.map((m) => bell(m.id, {
              type: 'reward',
              title: `🏆 Shine milestone — card №${n}!`,
              message: `${n} times this family stopped to say “we see you.” Keep shining! 🎊`,
              link: '/parent/rewards#recognition-hitmap',
            })));
            // Same seed set the birthdays keepsake post uses.
            const REACTIONS = ['❤️', '👏', '😂', '🎉'];
            await famRef.collection('posts').add({
              authorUid: 'kaya',
              authorName: 'Kaya 🌟',
              caption: `🏆 Shine milestone! This family has now given ${n} Shine Cards — ${n} moments someone stopped to say “we see you.” Card №${n} went to ${card.kidName}: “${card.quote.slice(0, 140)}” 🎊👏`,
              photos: [],
              kidTags: [kidId],
              visibility: 'family',
              pending: false,
              reactionCount: 0,
              reactionsByType: Object.fromEntries(REACTIONS.map((e) => [e, 0])),
              commentCount: 0,
              createdAt: FieldValue.serverTimestamp(),
            });
          } catch { /* the milestone never blocks the card */ }
        }
        return NextResponse.json({ ok: true, id: ref.id, n, doubleShine });
      }

      case 'card-list': {
        // Per-kid = equality-only (auto index) with the sort done in code,
        // so no composite index is ever needed.
        const { kidId } = body;
        const snap = kidId
          ? await cardsCol.where('kidId', '==', String(kidId)).get()
          : await cardsCol.orderBy('n', 'desc').limit(CARD_LIMIT).get();
        const cards = snap.docs.map((d) => ({ id: d.id, ...(d.data() as { n?: number }) }))
          .sort((a, b) => (b.n || 0) - (a.n || 0))
          .slice(0, CARD_LIMIT);
        return NextResponse.json({ ok: true, cards });
      }

      case 'card-theme': {
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId, theme } = body;
        if (!cardId || !theme) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        await cardsCol.doc(String(cardId)).update({ theme: String(theme) });
        return NextResponse.json({ ok: true });
      }

      case 'card-gift': {
        // 🎁 FX PR-9 — record a gift on an EXISTING card (Elia: cards
        // minted before the feature had no way to receive one). Same
        // validation as card-create's giftMeta; the record seals in place.
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId, gift, giftMeta } = body;
        if (!cardId || !String(gift || '').trim()) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        const gm = (giftMeta && typeof giftMeta === 'object' ? giftMeta : {}) as { label?: string; source?: string; rewardId?: string; pathway?: string; amountCents?: number };
        await cardsCol.doc(String(cardId)).update({
          gift: String(gift).slice(0, 80),
          giftMeta: {
            label: String(gm.label || gift).slice(0, 80),
            source: ['store', 'custom', 'surprise'].includes(String(gm.source)) ? String(gm.source) : 'custom',
            ...(gm.rewardId ? { rewardId: String(gm.rewardId) } : {}),
            ...(['treasure', 'hive', 'simple'].includes(String(gm.pathway)) ? { pathway: String(gm.pathway) } : {}),
            ...(Number.isInteger(gm.amountCents) && (gm.amountCents as number) > 0 ? { amountCents: gm.amountCents } : {}),
          },
        });
        return NextResponse.json({ ok: true });
      }

      case 'card-lang': {
        // 🧡 HR PR-2 — persist the card's EN↔SW chrome choice.
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId, lang } = body;
        if (!cardId || !['en', 'sw'].includes(String(lang))) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        await cardsCol.doc(String(cardId)).update({ lang: String(lang) });
        return NextResponse.json({ ok: true });
      }

      case 'card-delete': {
        // 🗑 FX PR-6 — remove a WRONG recognition card (parents only).
        // The underlying award/points are untouched — this deletes the
        // memory record, not the rail entry.
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId } = body;
        if (!cardId) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        await cardsCol.doc(String(cardId)).delete();
        return NextResponse.json({ ok: true });
      }

      case 'card-set-post': {
        // 📣 FX PR-3 — remember which Moments post carries this card.
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId, postId } = body;
        if (!cardId || !postId) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        await cardsCol.doc(String(cardId)).update({ momentsPostId: String(postId) });
        return NextResponse.json({ ok: true });
      }

      case 'card-note': {
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId, text } = body;
        if (!cardId || !String(text || '').trim()) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        await cardsCol.doc(String(cardId)).update({
          notes: FieldValue.arrayUnion({
            text: String(text).trim().slice(0, 300),
            byUid: uid,
            byName: String(user.displayName || 'Parent').split(' ')[0],
            at: Date.now(),
          }),
        });
        return NextResponse.json({ ok: true });
      }

      case 'card-echo': {
        // 💌 Kid-owner only — reaction / one line back to the giver.
        const { cardId, reaction, text } = body;
        if (!cardId || !reaction) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        const cardSnap = await cardsCol.doc(String(cardId)).get();
        const card = cardSnap.data() as { kidId?: string; by?: string; kidName?: string; n?: number } | undefined;
        if (!card) return NextResponse.json({ error: 'not-found' }, { status: 404 });
        if (user.childId !== card.kidId) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        await cardSnap.ref.update({
          echo: {
            reaction: String(reaction).slice(0, 8),
            ...(String(text || '').trim() ? { text: String(text).trim().slice(0, 200) } : {}),
            at: Date.now(),
          },
        });
        if (card.by) {
          await bell(card.by, {
            type: 'reward',
            title: `💌 ${card.kidName || 'Your kid'} answered Shine Card №${card.n}`,
            message: String(text || '').trim() || `They reacted ${reaction}`,
            link: `/profiles?child=${card.kidId}`,
          });
        }
        return NextResponse.json({ ok: true });
      }

      case 'card-email': {
        // 📧 FX PR-5 — send the card BY EMAIL to the kid (COPPA-resolved
        // address) + the family mailing list (adults w/ award emails on
        // + external contacts opted in). Traced in alertLog.
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { cardId, imageUrl } = body;
        if (!cardId || !imageUrl || !/^https:\/\//.test(String(imageUrl))) {
          return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        }
        const cardSnap = await cardsCol.doc(String(cardId)).get();
        const cardDoc = cardSnap.data() as {
          kidId?: string; kidName?: string; n?: number; quote?: string;
          byName?: string; gift?: string; subject?: string; helperUid?: string; lang?: string;
        } | undefined;
        if (!cardDoc) return NextResponse.json({ error: 'not-found' }, { status: 404 });
        const isHelperCard = cardDoc.subject === 'helper';

        const famSnap = await famRef.get();
        const famData = famSnap.data() as {
          externalContacts?: Array<{ name?: string; email?: string; notifyOnAward?: boolean }>;
        } | undefined;

        const to = new Set<string>();
        if (isHelperCard) {
          // 🧡 Asante card — the helper themselves + the parents. Kids'
          // pipeline and external contacts stay out of helper mail.
          if (cardDoc.helperUid) {
            const hSnap = await db.collection('users').doc(cardDoc.helperUid).get();
            const hEmail = (hSnap.data() as { email?: string } | undefined)?.email;
            if (hEmail) to.add(hEmail);
          }
          const membersSnap = await db.collection('users').where('familyId', '==', familyId).get();
          for (const m of membersSnap.docs) {
            const u = m.data() as { role?: string; email?: string; notifyOnAward?: boolean };
            if (u.role === 'parent' && u.email && u.notifyOnAward !== false) to.add(u.email);
          }
        } else {
        // Kid's own address (COPPA source pointer — absent = no send).
        try {
          const { resolveKidEmailAddress } = await import('@/lib/kidEmails.server');
          const kidEmail = cardDoc.kidId
            ? await resolveKidEmailAddress(db, familyId, cardDoc.kidId, famData as never)
            : null;
          if (kidEmail?.email) to.add(kidEmail.email);
        } catch { /* kid address is best-effort */ }
        // Family mailing list.
        const membersSnap = await db.collection('users').where('familyId', '==', familyId).get();
        for (const m of membersSnap.docs) {
          const u = m.data() as { role?: string; email?: string; notifyOnAward?: boolean; helperListed?: boolean };
          // 🤝 2026-08-25 — outside helpers (no kid assigned) are not
          // mailed about a kid's recognition. Mirrors the client wizard.
          if (u.role === 'helper' && u.helperListed === false) continue;
          if ((u.role === 'parent' || u.role === 'helper') && u.email && u.notifyOnAward !== false) to.add(u.email);
        }
        for (const c of famData?.externalContacts || []) {
          if (c.email && c.notifyOnAward) to.add(c.email);
        }
        }
        if (to.size === 0) return NextResponse.json({ error: 'no-recipients' }, { status: 400 });

        const { Resend } = await import('resend');
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 });
        const resend = new Resend(apiKey);
        const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
        const subject = isHelperCard
          ? (cardDoc.lang === 'sw' ? `🧡 Kadi ya Asante №${cardDoc.n} — ${cardDoc.kidName}` : `🧡 Asante Card №${cardDoc.n} — ${cardDoc.kidName}`)
          : `🌟 Shine Card №${cardDoc.n} — ${cardDoc.kidName}`;
        const headerLine = isHelperCard ? '🧡 Kaya · Asante Card' : '🌟 Kaya · Shine Card';
        const html =
          `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:420px;margin:0 auto;padding:20px;text-align:center">
            <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9B8A72;font-weight:800;margin:0 0 12px">${headerLine}</p>
            <img src="${String(imageUrl)}" alt="Shine Card №${cardDoc.n}" style="width:100%;max-width:360px;border-radius:14px"/>
            <p style="font-size:13px;color:#1E120B;margin:14px 0 0">&ldquo;${String(cardDoc.quote || '').slice(0, 200)}&rdquo; — ${cardDoc.byName || 'family'}</p>
            ${cardDoc.gift ? `<p style="font-size:12.5px;color:#A87D0F;font-weight:800;margin:8px 0 0">🎁 ${String(cardDoc.gift)}</p>` : ''}
            <p style="font-size:11px;color:#9B8A72;margin:14px 0 0">Kept forever on the Shine Wall · www.ourkaya.com</p>
          </div>`;
        let sent = false; let error: string | undefined;
        try {
          await resend.emails.send({ from: FROM, to: [...to], subject, html });
          sent = true;
        } catch (e) { error = e instanceof Error ? e.message : 'send failed'; }
        await famRef.collection('alertLog').add({
          kind: 'shine_card_email',
          firedAt: Date.now(),
          trigger: `card №${cardDoc.n} emailed by ${user.displayName || uid}`,
          sourceLabel: '🌟 Shine Card email',
          channels: { email: { on: true, sent, ...(error ? { error } : {}), to: [...to].map((e) => ({ name: '', email: e })), subject, templateVersion: 1 } },
        }).catch(() => {});
        if (!sent) return NextResponse.json({ error: error || 'send-failed' }, { status: 500 });
        return NextResponse.json({ ok: true, count: to.size });
      }

      case 'helper-round-get': {
        // 🤝 HR PR-3 — this month's helper spotlight (parents only; the
        // round is reward-planning material, not helper-visible).
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const month = /^\d{4}-\d{2}$/.test(String(body.month)) ? String(body.month) : new Date().toISOString().slice(0, 7);
        const snap = await famRef.collection('helperRounds').doc(month).get();
        return NextResponse.json({ ok: true, round: snap.exists ? { id: snap.id, ...snap.data() } : null });
      }

      case 'round-get': {
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { date } = body;
        if (!date) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        const snap = await famRef.collection('recognitionRounds').doc(String(date)).get();
        return NextResponse.json({ ok: true, round: snap.exists ? { id: snap.id, ...snap.data() } : null });
      }

      case 'round-list': {
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const snap = await famRef.collection('recognitionRounds')
          .orderBy('date', 'desc').limit(120).get();
        return NextResponse.json({ ok: true, rounds: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }

      case 'round-dismiss': {
        // ✕ DL PR-A — a parent says "this proposal isn't right" + why.
        // Writes the round's `dismissed` map (one-read rendering) AND a
        // learning-log record (the engine's memory). Parents only; nothing
        // minted, nobody notified; kids never see it.
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { date, kidId, kind, code } = body;
        const note = typeof body.note === 'string' ? body.note.trim().slice(0, DISMISS_NOTE_MAX) : '';
        if (!date || !kidId || !kind || !isDismissCode(code)) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        if (dismissReason(code).noteRequired && !note) return NextResponse.json({ error: 'note-required' }, { status: 400 });
        const roundRef = famRef.collection('recognitionRounds').doc(String(date));
        const roundSnap = await roundRef.get();
        if (!roundSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
        const round = roundSnap.data() as {
          lens?: string;
          items?: Array<{ kidId: string; kind: string; line?: string; daysSince?: number; termId?: string; giftIdea?: { rewardId?: string } }>;
          dismissed?: Record<string, RoundDismissal>;
        };
        const item = (round.items || []).find((i) => i.kidId === String(kidId) && i.kind === String(kind));
        if (!item) return NextResponse.json({ error: 'item-not-found' }, { status: 404 });
        const key = dismissKey(String(kidId), String(kind));
        if (round.dismissed?.[key]) return NextResponse.json({ ok: true, already: true });
        const now = Date.now();
        const dismissal: RoundDismissal = {
          by: uid, byName: (user.displayName || 'Parent').split(' ')[0], at: now, code,
          ...(note ? { note } : {}),
        };
        const logRef = famRef.collection('recognitionDismissals').doc();
        await logRef.set({
          ...dismissal,
          kidId: String(kidId), kind: String(kind), roundDate: String(date),
          ...(item.line ? { line: item.line } : {}),
          ...(typeof item.daysSince === 'number' ? { daysSince: item.daysSince } : {}),
          ...(round.lens ? { lens: round.lens } : {}),
          ...(item.termId ? { termId: item.termId } : {}),
          ...(item.giftIdea?.rewardId ? { giftRewardId: item.giftIdea.rewardId } : {}),
          ...(code === 'data_wrong' ? { flag: true } : {}),
        });
        await roundRef.update({ [`dismissed.${key}`]: { ...dismissal, logId: logRef.id } });
        return NextResponse.json({ ok: true, id: logRef.id });
      }

      case 'round-undismiss': {
        // ↩︎ any parent, while the round's 72h window is open. Removes the
        // map entry AND the learning record (Kaya un-learns it).
        if (!isParent) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const { date, kidId, kind } = body;
        if (!date || !kidId || !kind) return NextResponse.json({ error: 'bad-request' }, { status: 400 });
        const start = new Date(`${String(date)}T00:00:00`).getTime();
        if (Date.now() >= start + ROUND_WINDOW_MS) return NextResponse.json({ error: 'window-closed' }, { status: 409 });
        const roundRef = famRef.collection('recognitionRounds').doc(String(date));
        const roundSnap = await roundRef.get();
        if (!roundSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
        const key = dismissKey(String(kidId), String(kind));
        const entry = (roundSnap.data() as { dismissed?: Record<string, RoundDismissal & { logId?: string }> }).dismissed?.[key];
        if (!entry) return NextResponse.json({ ok: true, already: true });
        if (entry.logId) await famRef.collection('recognitionDismissals').doc(entry.logId).delete().catch(() => { /* best-effort */ });
        await roundRef.update({ [`dismissed.${key}`]: FieldValue.delete() });
        return NextResponse.json({ ok: true });
      }

      case 'dismissals-list': {
        // 🧠 the learning log (adults; parents + helpers in audience read
        // the same round anyway). Single-field range — no composite index.
        if (!isAdult) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
        const since = Date.now() - DISMISS_MEMORY_DAYS * 86400_000;
        const snap = await famRef.collection('recognitionDismissals').where('at', '>=', since).get();
        return NextResponse.json({ ok: true, records: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
      }

      default:
        return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
