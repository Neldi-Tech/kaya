// ✉️ Greeting-cards delivery engine (Reminders 2.0 — R5/R6, innovation 5).
// Runs HOURLY (vercel.json) and, per family:
//   • T-3  → "Draft the card" nudge to parents (bell + email)        key nudge-3
//   • T-1  → "Still blank — Kaya sends its default at 07:00" (autoSend) key nudge-1
//   • day  → 07:00 in the honoree's timezone: auto-email the card (default
//            card materialised if nobody drafted), parents CC, alertLog;
//            pending_parent cards are NEVER auto-sent (parent bell instead)  key auto-email
//   • day  → WhatsApp-only honoree: tap-to-send prompt (Phase A)         key wa-prompt
//   • day  → in-family honoree with a card: drop into chat (+Moments)    key auto-family
//   • D+1…D+7 → belated rescue nudge once for unsent outside cards        key belated-nudge
// Idempotency: keys live on the CARD (`sentKeys`) or, before a card exists,
// on the EVENT (`cardNudgeKeys`). Timezone: greetTo.timezone → contact → family default.
// CRON_SECRET-gated like every sibling cron.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { Resend } from 'resend';
import { dayKeyInTZ } from '@/lib/dates';
import {
  occursOn, addDaysKey, diffDaysKey, nthFor, displayTitle, buildSignature, FAMILY_TZ_DEFAULT,
  type ReminderEvent, type FamilyContact, type GreetingSignature, type GreetTo,
} from '@/lib/reminders';
import {
  cardIdFor, cardHeadline, defaultOneLiner, defaultMessage, type GreetingCard,
} from '@/lib/greetingCards';
import { renderCardNudgeEmail } from '@/lib/greetingCardEmail';
import {
  APP_URL, RESEND_FROM, familyParents, sendCardEmail, postCardToChat, postCardToMoments, bell, kidLoginUid,
} from '@/lib/greetingCards.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const SEND_HOUR = 7;

function hourIn(tz: string, d = new Date()): number {
  try {
    const h = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(d);
    const n = parseInt(h, 10);
    return Number.isFinite(n) ? n % 24 : d.getUTCHours();
  } catch { return d.getUTCHours(); }
}
function safeTz(tz?: string): string {
  if (!tz) return FAMILY_TZ_DEFAULT;
  try { new Intl.DateTimeFormat('en-GB', { timeZone: tz }); return tz; } catch { return FAMILY_TZ_DEFAULT; }
}

type FamilySlice = { name?: string; contacts?: FamilyContact[]; greetingSignature?: GreetingSignature };

async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get('authorization') || '';
    if (auth !== `Bearer ${secret}`) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ skipped: true, reason: 'admin-unavailable' });
  const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

  let families = 0, nudges = 0, sent = 0, waPrompts = 0, familyDrops = 0, belated = 0, skipped = 0;
  const famSnap = await db.collection('families').get();
  for (const famDoc of famSnap.docs) {
    try {
      const fam = (famDoc.data() || {}) as FamilySlice;
      const familyId = famDoc.id;
      const familyName = fam.name || '';
      const famTz = FAMILY_TZ_DEFAULT;
      const today = dayKeyInTZ(new Date(), famTz);
      families++;
      let parentsCache: Awaited<ReturnType<typeof familyParents>> | null = null;
      const parents = async () => (parentsCache ??= await familyParents(db, familyId));
      const cardsCol = famDoc.ref.collection('greetingCards');

      const nudgeParents = async (title: string, message: string, link: string, email?: { subject: string; html: string }) => {
        for (const p of await parents()) {
          await bell(db, familyId, p.uid, { title, message, link });
        }
        if (email && resend) {
          const to = (await parents()).map((p) => p.email).filter(Boolean);
          if (to.length) await resend.emails.send({ from: RESEND_FROM, to, subject: email.subject, html: email.html }).catch(() => {});
        }
        nudges++;
      };

      // ── Stored events with an honoree ─────────────────────────────────
      const evSnap = await famDoc.ref.collection('reminders').get();
      for (const d of evSnap.docs) {
        const ev = { id: d.id, ...(d.data() as Record<string, unknown>) } as ReminderEvent & { cardNudgeKeys?: string[] };
        if (!ev.greetTo || ev.status === 'pending_parent') continue;
        if (ev.type !== 'birthday' && ev.type !== 'anniversary' && ev.type !== 'event') continue;
        const honoree: GreetTo = ev.greetTo;
        const contact = honoree.contactId ? (fam.contacts || []).find((c) => c.id === honoree.contactId) : undefined;
        const tz = safeTz(honoree.timezone || contact?.timezone);
        const external = honoree.relationship !== 'family';
        const evKeys = new Set(ev.cardNudgeKeys || []);
        const newEvKeys: string[] = [];
        const stamp = (k: string) => { evKeys.add(k); newEvKeys.push(k); };

        // Occurrences in [today-7, today+3].
        for (let off = -7; off <= 3; off++) {
          const dateKey = addDaysKey(today, off);
          if (!occursOn(ev, dateKey)) continue;
          const daysAway = -off; // 3 = in three days, 0 = today, -1 = yesterday
          const cardId = cardIdFor(ev.id, dateKey);
          const cardSnap = await cardsCol.doc(cardId).get();
          const card = cardSnap.exists ? ({ id: cardSnap.id, ...(cardSnap.data() as Omit<GreetingCard, 'id'>) }) : null;
          const cardKeys = new Set(card?.sentKeys || []);
          const headline = cardHeadline(ev.type, nthFor(ev, dateKey), 'en', ev.title);
          const link = `/reminders?card=${encodeURIComponent(cardId)}`;
          const hasDraft = !!card && !card.isDefault;

          // T-3 nudge (everyone cardable gets it — in-family too: it's the Studio invite).
          if (daysAway === 3 && !evKeys.has(`${dateKey}:nudge-3`)) {
            const e = renderCardNudgeEmail({ honoreeName: honoree.name, headline, daysAway: 3, appUrl: APP_URL, autoSend: !!honoree.autoSend && external, hasDraft });
            await nudgeParents(`✉️ Draft ${honoree.name}'s card`, `${headline} in 3 days — Kaya can write it with you. ${external && honoree.autoSend ? 'Kaya sends at 07:00 on the day.' : ''}`, link, e);
            if (ev.ownerUid && ev.ownerRole === 'kid') await bell(db, familyId, ev.ownerUid, { title: `✉️ Make ${honoree.name}'s card`, message: `${headline} in 3 days — open the Card Studio.`, link });
            stamp(`${dateKey}:nudge-3`);
          }
          // T-1: still blank + autoSend.
          if (daysAway === 1 && external && honoree.autoSend && !hasDraft && !evKeys.has(`${dateKey}:nudge-1`)) {
            const e = renderCardNudgeEmail({ honoreeName: honoree.name, headline, daysAway: 1, appUrl: APP_URL, autoSend: true, hasDraft: false });
            await nudgeParents(`✉️ ${honoree.name}'s card is tomorrow`, `Still blank — Kaya sends its default card at 07:00 unless you make it yours.`, link, e);
            stamp(`${dateKey}:nudge-1`);
          }
          // T-1 / day-of: pending_parent card → parent must approve.
          if ((daysAway === 1 || daysAway === 0) && card?.status === 'pending_parent' && !cardKeys.has(`${dateKey}:pending-${daysAway}`)) {
            await nudgeParents(`⏳ ${card.authorName}'s card needs your nod`, `Card for ${honoree.name} is waiting — approve it so it can go ${daysAway === 0 ? 'today' : 'tomorrow'}.`, link);
            await cardSnap.ref.set({ sentKeys: FieldValue.arrayUnion(`${dateKey}:pending-${daysAway}`) }, { merge: true }).catch(() => {});
          }

          // Day-of — 07:00 in the honoree's timezone.
          if (daysAway === 0 && hourIn(tz) >= SEND_HOUR) {
            if (external && honoree.autoSend && honoree.email) {
              if (card?.status === 'pending_parent') { skipped++; }
              else if (!cardKeys.has(`${dateKey}:auto-email`) && !(card && (card.status === 'sent' || card.status === 'belated'))) {
                // Materialise Kaya's default when nobody drafted.
                let theCard = card;
                if (!theCard) {
                  const ps = await parents();
                  const sig = buildSignature({ parentNames: ps.map((p) => p.name), familyName, kidNames: [], authorName: 'Kaya', authorRole: 'parent', relationship: honoree.relationship, lang: contact?.lang || 'en', signature: fam.greetingSignature });
                  const lang = contact?.lang || 'en';
                  const partial = { type: ev.type, nth: nthFor(ev, dateKey), lang, honoree };
                  const fresh: Omit<GreetingCard, 'id'> = {
                    familyId, eventId: ev.id, dateKey, type: ev.type, eventTitle: displayTitle(ev, dateKey), nth: nthFor(ev, dateKey), honoree,
                    theme: ev.type === 'anniversary' ? 'night' : 'classic', stickers: ev.type === 'birthday' ? ['✨', '🎈'] : ['✨'],
                    oneLiner: defaultOneLiner(partial), message: defaultMessage(partial, sig.line), lines: [], lang,
                    signatureLine: sig.line, ...(sig.roster ? { signatureRoster: sig.roster } : {}),
                    status: 'ready', authorUid: 'kaya', authorName: 'Kaya', authorRole: 'parent', isDefault: true, sentKeys: [], deliveries: [], createdAt: Date.now(), updatedAt: Date.now(),
                  };
                  await cardSnap.ref.set(fresh);
                  theCard = { id: cardId, ...fresh };
                }
                const r = await sendCardEmail({ db, familyId, familyName, cardRef: cardSnap.ref, card: theCard, contacts: fam.contacts, mode: 'auto' });
                await cardSnap.ref.set({ sentKeys: FieldValue.arrayUnion(`${dateKey}:auto-email`) }, { merge: true }).catch(() => {});
                if (r.ok) {
                  sent++;
                  const who = theCard.authorUid && theCard.authorUid !== 'kaya' ? theCard.authorUid : null;
                  const msg = `💌 Sent to ${honoree.name} — ${headline} card${theCard.isDefault ? ' (Kaya\'s default)' : ''}${r.to.length > 1 ? ' · parents in copy' : ''}`;
                  await postCardToChat(db, familyId, theCard, { uid: 'kaya', name: 'Kaya ✉️' }, msg, theCard.imageUrl).catch(() => {});
                  for (const p of await parents()) await bell(db, familyId, p.uid, { title: '💌 Card sent', message: `${honoree.name}'s ${headline.toLowerCase()} card went out at 07:00.`, link });
                  if (who) await bell(db, familyId, who, { title: '💌 Your card landed', message: `Your card to ${honoree.name} was sent.`, link });
                } else if (r.skipped === 'opted-out') {
                  await nudgeParents(`🙅 ${honoree.name} opted out`, `They asked Kaya to stop greetings, so the card wasn't sent. You can still share it yourself.`, link);
                } else if (r.skipped !== 'no-resend-key') {
                  await nudgeParents(`⚠️ Card not sent to ${honoree.name}`, `Kaya couldn't email the card (${r.error || r.skipped || 'unknown'}). Share it from the Studio.`, link);
                }
              }
            } else if (external && honoree.whatsapp && !evKeys.has(`${dateKey}:wa-prompt`) && !(card && (card.status === 'sent' || card.status === 'belated'))) {
              await nudgeParents(`📱 Send ${honoree.name}'s card on WhatsApp`, `It's the day — one tap opens WhatsApp with the card link.`, link);
              if (ev.ownerUid && ev.ownerRole !== 'kid') await bell(db, familyId, ev.ownerUid, { title: `📱 Tap to send ${honoree.name}'s card`, message: 'WhatsApp opens with the message + card link.', link });
              stamp(`${dateKey}:wa-prompt`); waPrompts++;
            } else if (!external && card && card.status !== 'sent' && !cardKeys.has(`${dateKey}:auto-family`)) {
              // In-family honoree → chat (+ Moments) — never an email (R8).
              const text = `✉️ ${headline}, ${honoree.name}! “${card.oneLiner || defaultOneLiner(card)}” — ${card.signatureLine}`;
              await postCardToChat(db, familyId, card, { uid: card.authorUid === 'kaya' ? 'kaya' : card.authorUid, name: card.authorName }, text, card.imageUrl).catch(() => {});
              if (!card.momentsPostId && card.imageUrl) {
                const postId = await postCardToMoments(db, familyId, card, { uid: card.authorUid, name: card.authorName }, text, honoree.childId ? [honoree.childId] : []);
                if (postId) await cardSnap.ref.set({ momentsPostId: postId }, { merge: true }).catch(() => {});
              }
              await cardSnap.ref.set({ status: 'sent', sentAt: Date.now(), sentKeys: FieldValue.arrayUnion(`${dateKey}:auto-family`), deliveries: FieldValue.arrayUnion({ channel: 'chat', at: Date.now(), ok: true, mode: 'auto' }) }, { merge: true }).catch(() => {});
              if (honoree.memberUid) await bell(db, familyId, honoree.memberUid, { title: `✉️ A card for you!`, message: `${card.authorName} made you a ${headline.toLowerCase()} card — it's in family chat.`, link: '/messages' });
              if (honoree.childId) { const u = await kidLoginUid(db, familyId, honoree.childId); if (u) await bell(db, familyId, u, { title: `✉️ A card for you!`, message: `${card.authorName} made you a ${headline.toLowerCase()} card — it's in family chat.`, link: '/messages' }); }
              familyDrops++;
            }
          }

          // Belated rescue — once, D+1.
          if (daysAway === -1 && external && !(card && (card.status === 'sent' || card.status === 'belated')) && !evKeys.has(`${dateKey}:belated-nudge`)) {
            await nudgeParents(`🙈 Missed ${honoree.name}'s card?`, `${headline} was yesterday — send a belated card (Kaya adds a gentle "a little late, with love").`, link);
            stamp(`${dateKey}:belated-nudge`); belated++;
          }
        }
        if (newEvKeys.length) await d.ref.update({ cardNudgeKeys: FieldValue.arrayUnion(...newEvKeys) }).catch(() => {});
      }

      // ── Cards on auto-imported mirrors (kid birthdays / family anniversary) ──
      // Those events aren't stored, so walk today's cards directly.
      if (hourIn(famTz) >= SEND_HOUR) {
        const todayCards = await cardsCol.where('dateKey', '==', today).get().catch(() => null);
        for (const cs of todayCards?.docs || []) {
          const card = { id: cs.id, ...(cs.data() as Omit<GreetingCard, 'id'>) };
          if (!card.eventId.startsWith('auto:')) continue;
          if (card.status === 'sent' || card.status === 'belated' || (card.sentKeys || []).includes(`${today}:auto-family`)) continue;
          const headline = cardHeadline(card.type, card.nth, card.lang, card.eventTitle);
          const text = `✉️ ${headline}, ${card.honoree.name}! “${card.oneLiner || defaultOneLiner(card)}” — ${card.signatureLine}`;
          await postCardToChat(db, familyId, card, { uid: card.authorUid, name: card.authorName }, text, card.imageUrl).catch(() => {});
          if (!card.momentsPostId && card.imageUrl) {
            const postId = await postCardToMoments(db, familyId, card, { uid: card.authorUid, name: card.authorName }, text, card.honoree.childId ? [card.honoree.childId] : []);
            if (postId) await cs.ref.set({ momentsPostId: postId }, { merge: true }).catch(() => {});
          }
          await cs.ref.set({ status: 'sent', sentAt: Date.now(), sentKeys: FieldValue.arrayUnion(`${today}:auto-family`), deliveries: FieldValue.arrayUnion({ channel: 'chat', at: Date.now(), ok: true, mode: 'auto' }) }, { merge: true }).catch(() => {});
          if (card.honoree.childId) { const u = await kidLoginUid(db, familyId, card.honoree.childId); if (u) await bell(db, familyId, u, { title: '✉️ A card for you!', message: `${card.authorName} made you a ${headline.toLowerCase()} card — it's in family chat.`, link: '/messages' }); }
          familyDrops++;
        }
      }
    } catch { continue; }
  }
  return NextResponse.json({ ok: true, families, nudges, sent, waPrompts, familyDrops, belated, skipped });
}

export const GET = handle;
export const POST = handle;
