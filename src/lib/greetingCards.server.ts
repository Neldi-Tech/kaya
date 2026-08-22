// ✉️ Greeting Cards — SERVER helpers (Admin SDK). Shared by the gateway
// route (/api/reminders/cards), the public card route (/api/cards/public)
// and the hourly delivery cron (/api/cron/greeting-cards). Never import from
// a client component.

import { randomBytes } from 'node:crypto';
import { FieldValue, type Firestore, type DocumentReference } from 'firebase-admin/firestore';
import type { GreetingCard, CardDelivery } from './greetingCards';
import { renderGreetingCardEmail } from './greetingCardEmail';
import type { FamilyContact, GreetTo } from './reminders';

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
export const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
export const CARD_LINK_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days (R10)

export interface ParentLite { uid: string; email: string; name: string }

/** All parents of a family (uid · email · first/display name). */
export async function familyParents(db: Firestore, familyId: string): Promise<ParentLite[]> {
  const snap = await db.collection('users').where('familyId', '==', familyId).where('role', '==', 'parent').get();
  return snap.docs.map((d) => {
    const u = d.data() as { email?: string; displayName?: string };
    return { uid: d.id, email: (u.email || '').trim().toLowerCase(), name: u.displayName || 'Parent' };
  });
}

/** Live honoree email: contact snapshot → People Book (live) → member login email. */
export async function resolveHonoreeEmail(
  db: Firestore, familyId: string, honoree: GreetTo, contacts: FamilyContact[] | undefined,
): Promise<{ email: string; optOut: boolean } | null> {
  if (honoree.contactId) {
    const c = (contacts || []).find((x) => x.id === honoree.contactId);
    if (c) return c.email ? { email: c.email.toLowerCase(), optOut: !!c.optOut } : null;
  }
  if (honoree.memberUid) {
    const u = (await db.collection('users').doc(honoree.memberUid).get()).data() as { email?: string; familyId?: string } | undefined;
    if (u?.email && u.familyId === familyId) return { email: u.email.toLowerCase(), optOut: false };
  }
  if (honoree.email) return { email: honoree.email.toLowerCase(), optOut: false };
  return null;
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function mintToken(): string {
  const b = randomBytes(10);
  let s = '';
  for (const x of b) s += ALPHABET[x % 32];
  return s;
}

/** Mint (or reuse) the public no-login link for a card → `${APP_URL}/c/{token}`.
 *  Token doc lives in top-level `shareTokens` (Admin-only, never in rules). */
export async function ensureCardToken(db: Firestore, cardRef: DocumentReference, card: GreetingCard): Promise<{ token: string; url: string }> {
  if (card.publicToken && card.publicTokenAt && Date.now() - card.publicTokenAt < CARD_LINK_TTL_MS) {
    const t = await db.collection('shareTokens').doc(card.publicToken).get();
    if (t.exists) return { token: card.publicToken, url: `${APP_URL}/c/${card.publicToken}` };
  }
  const token = mintToken();
  await db.collection('shareTokens').doc(token).set({ kind: 'card', familyId: card.familyId, cardId: card.id, createdAt: Date.now() });
  await cardRef.set({ publicToken: token, publicTokenAt: Date.now() }, { merge: true });
  return { token, url: `${APP_URL}/c/${token}` };
}

export function stopUrlFor(familyId: string, contactId: string | undefined, token: string): string | null {
  if (!contactId) return null;
  return `${APP_URL}/c/${token}?stop=${encodeURIComponent(contactId)}`;
}

export async function appendDelivery(cardRef: DocumentReference, d: CardDelivery, extra: Record<string, unknown> = {}): Promise<void> {
  const clean: Record<string, unknown> = { channel: d.channel, at: d.at, ok: d.ok };
  if (d.to) clean.to = d.to;
  if (d.by) clean.by = d.by;
  if (d.error) clean.error = d.error;
  if (d.mode) clean.mode = d.mode;
  await cardRef.set({ deliveries: FieldValue.arrayUnion(clean), updatedAt: Date.now(), ...extra }, { merge: true }).catch(() => {});
}

export interface SendCardEmailArgs {
  db: Firestore;
  familyId: string;
  familyName: string;
  cardRef: DocumentReference;
  card: GreetingCard;
  contacts?: FamilyContact[];
  /** Who pressed send (manual) — becomes Reply-To when they have an email. */
  sender?: { uid?: string; name?: string; email?: string };
  mode: 'auto' | 'manual';
  belated?: boolean;
  /** Skip the honoree's own opt-out (never — kept explicit for clarity). */
}

/** The one place a greeting card becomes an email: To honoree · CC parents ·
 *  Reply-To sender · From "{Family} via Kaya" · public link · alertLog trace. */
export async function sendCardEmail(a: SendCardEmailArgs): Promise<{ ok: boolean; to: string[]; error?: string; skipped?: string }> {
  const { db, card } = a;
  const target = await resolveHonoreeEmail(db, a.familyId, card.honoree, a.contacts);
  if (!target) return { ok: false, to: [], skipped: 'no-email' };
  if (target.optOut) return { ok: false, to: [], skipped: 'opted-out' };
  const parents = await familyParents(db, a.familyId);
  const cc = card.honoree.ccParents !== false
    ? Array.from(new Set(parents.map((p) => p.email).filter((e) => e && e !== target.email)))
    : [];
  const { url } = await ensureCardToken(db, a.cardRef, card);
  const stopUrl = card.honoree.relationship === 'family' ? null : stopUrlFor(a.familyId, card.honoree.contactId, url.split('/c/')[1] || '');
  const { subject, html, text } = renderGreetingCardEmail({ card, familyName: a.familyName, appUrl: APP_URL, publicUrl: url, stopUrl, belated: a.belated });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, to: [target.email], skipped: 'no-resend-key' };
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const fromAddr = RESEND_FROM.replace(/^.*<|>.*$/g, '') || 'noreply@ourkaya.com';
  const from = `${a.familyName ? `${a.familyName} family` : 'Kaya'} via Kaya <${fromAddr}>`;
  const replyTo = a.sender?.email || parents.find((p) => p.email)?.email;
  let ok = false; let error = '';
  try {
    await resend.emails.send({
      from, to: [target.email],
      ...(cc.length ? { cc } : {}),
      ...(replyTo ? { replyTo } : {}),
      subject, html, text,
    });
    ok = true;
  } catch (e) {
    error = e instanceof Error ? e.message : 'send failed';
  }
  const at = Date.now();
  await appendDelivery(a.cardRef, { channel: 'email', at, ok, to: target.email, ...(a.sender?.name ? { by: a.sender.name } : {}), ...(error ? { error } : {}), mode: a.mode },
    ok ? { status: a.belated ? 'belated' : 'sent', sentAt: at } : {});
  // 📜 alertLog trace (as-sent, template version — never snapshot HTML).
  await db.collection('families').doc(a.familyId).collection('alertLog').add({
    kind: 'greeting_card', firedAt: at,
    trigger: a.mode === 'auto' ? 'sweep' : 'manual',
    sourceLabel: `✉️ ${card.eventTitle}`,
    cardId: card.id, honoree: card.honoree.name,
    channels: { email: { on: true, sent: ok, ...(error ? { error } : {}), to: [{ name: card.honoree.name, email: target.email }], cc, subject, templateVersion: 1 } },
  }).catch(() => {});
  return ok ? { ok, to: [target.email, ...cc] } : { ok, to: [target.email], error };
}

/** Drop a card into the family group chat (text + optional PNG attachment). */
export async function postCardToChat(
  db: Firestore, familyId: string, card: GreetingCard, sender: { uid: string; name: string; role?: string }, text: string, imageUrl?: string,
): Promise<boolean> {
  const threadRef = db.collection('families').doc(familyId).collection('threads').doc('group');
  const snap = await threadRef.get();
  if (!snap.exists) return false;
  const msg: Record<string, unknown> = {
    senderUid: sender.uid, senderName: sender.name, text, createdAt: FieldValue.serverTimestamp(),
  };
  if (sender.role) msg.senderRole = sender.role;
  if (imageUrl) msg.attachments = [{ kind: 'photo', url: imageUrl, mime: 'image/png' }];
  await threadRef.collection('messages').add(msg);
  await threadRef.update({
    lastText: text, lastKind: imageUrl ? 'photo' : 'text', lastSenderUid: sender.uid,
    lastAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    ...(sender.uid !== 'kaya' ? { [`reads.${sender.uid}`]: FieldValue.serverTimestamp() } : {}),
  }).catch(() => {});
  return true;
}

/** Bell (in-app notification) — best-effort. */
export async function bell(db: Firestore, familyId: string, forUserId: string, note: { title: string; message: string; link: string }): Promise<void> {
  if (!forUserId || forUserId === 'system' || forUserId === 'kaya') return;
  await db.collection('families').doc(familyId).collection('notifications').add({
    type: 'reminder', ...note, forUserId, read: false, createdAt: FieldValue.serverTimestamp(),
  }).catch(() => {});
}

/** Kid login uid for a childId (bells go to login uids). */
export async function kidLoginUid(db: Firestore, familyId: string, childId: string): Promise<string | null> {
  const s = await db.collection('users').where('familyId', '==', familyId).where('childId', '==', childId).limit(1).get();
  return s.empty ? null : s.docs[0].id;
}

/** Server-side Moments post for a card (Kaya- or member-authored; image via PhotoRef url×3). */
export async function postCardToMoments(
  db: Firestore, familyId: string, card: GreetingCard, author: { uid: string; name: string }, caption: string, kidTags: string[],
): Promise<string | null> {
  const REACTIONS = ['❤️', '👏', '😂', '🎉'];
  const photos = card.imageUrl ? [{
    id: `card-${card.id}`, thumbUrl: card.imageUrl, feedUrl: card.imageUrl, fullUrl: card.imageUrl, width: 1360, height: 1800, kind: 'photo',
  }] : [];
  try {
    const ref = await db.collection('families').doc(familyId).collection('posts').add({
      authorUid: author.uid, authorName: author.name, caption: caption.slice(0, 1800), photos, kidTags,
      visibility: 'family', pending: false, reactionCount: 0,
      reactionsByType: Object.fromEntries(REACTIONS.map((e) => [e, 0])), commentCount: 0,
      createdAt: FieldValue.serverTimestamp(),
    });
    return ref.id;
  } catch { return null; }
}
