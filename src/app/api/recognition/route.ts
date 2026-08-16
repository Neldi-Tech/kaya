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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Action =
  | 'card-create' | 'card-list' | 'card-theme' | 'card-note' | 'card-echo'
  | 'card-set-post' | 'card-email' | 'round-get' | 'round-list';

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

        // № via transactional counter on the family doc.
        const n = await db.runTransaction(async (tx) => {
          const famSnap = await tx.get(famRef);
          const next = (((famSnap.data() as { recognitionStats?: { cardCount?: number } })?.recognitionStats?.cardCount) || 0) + 1;
          tx.update(famRef, { 'recognitionStats.cardCount': next });
          return next;
        });

        // 🤝 Double Shine — another adult celebrated this kid today.
        // Equality-only query (auto index); the day filter runs in code.
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const kidCardsSnap = await cardsCol.where('kidId', '==', kidId).get();
        const partner = kidCardsSnap.docs.find((d) => {
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
            },
          } : {}),
          doubleShine,
          notes: [] as unknown[],
        };
        const ref = await cardsCol.add(card);
        if (doubleShine && partner) {
          await partner.ref.update({ doubleShine: true }).catch(() => {});
        }

        const kidUid = await kidLoginUid(kidId);
        if (kidUid) {
          await bell(kidUid, doubleShine
            ? { type: 'reward', title: '🎊 Double Shine!', message: 'Mum AND Dad noticed — a golden Shine Card is on your wall!', link: '/profiles' }
            : { type: 'reward', title: `🌟 Shine Card №${n} for you!`, message: card.quote.slice(0, 90), link: '/profiles' });
        }

        // 🏆 RR PR-4 — Shine milestones: the family's 25th/50th/100th/…
        // card is worth celebrating itself. Golden moment: everyone's
        // bells + an automatic Moments post from Kaya.
        const MILESTONES = new Set([10, 25, 50, 100, 150, 200, 300, 400, 500]);
        if (MILESTONES.has(n)) {
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
          byName?: string; gift?: string;
        } | undefined;
        if (!cardDoc) return NextResponse.json({ error: 'not-found' }, { status: 404 });

        const famSnap = await famRef.get();
        const famData = famSnap.data() as {
          externalContacts?: Array<{ name?: string; email?: string; notifyOnAward?: boolean }>;
        } | undefined;

        const to = new Set<string>();
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
          const u = m.data() as { role?: string; email?: string; notifyOnAward?: boolean };
          if ((u.role === 'parent' || u.role === 'helper') && u.email && u.notifyOnAward !== false) to.add(u.email);
        }
        for (const c of famData?.externalContacts || []) {
          if (c.email && c.notifyOnAward) to.add(c.email);
        }
        if (to.size === 0) return NextResponse.json({ error: 'no-recipients' }, { status: 400 });

        const { Resend } = await import('resend');
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 });
        const resend = new Resend(apiKey);
        const FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
        const subject = `🌟 Shine Card №${cardDoc.n} — ${cardDoc.kidName}`;
        const html =
          `<div style="font-family:-apple-system,Segoe UI,Arial,sans-serif;max-width:420px;margin:0 auto;padding:20px;text-align:center">
            <p style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#9B8A72;font-weight:800;margin:0 0 12px">🌟 Kaya · Shine Card</p>
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

      default:
        return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 });
  }
}
