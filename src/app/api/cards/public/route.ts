// ✉️ Public card API (Reminders 2.0 — R10/R13, innovation 2 "thank-you loop").
// NO login. Token-gated like /api/purchase/scan: `shareTokens/{token}` is a
// top-level Admin-only doc (never in rules), read by id only (no index).
//   GET  ?token=…                → read-only projection of the card (404 / 410)
//   POST {token, action:'thanks', reaction?, text?} → lands in family chat + bell
//   POST {token, action:'stop',  contactId}         → contact.optOut = true (R13)
// Blast radius is bounded: a token can only add a thank-you or opt its own
// contact out — never read other cards, never edit the card.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { FieldValue } from 'firebase-admin/firestore';
import { shortName, type GreetingCard } from '@/lib/greetingCards';
import type { FamilyContact } from '@/lib/reminders';
import { CARD_LINK_TTL_MS, postCardToChat, bell, familyParents } from '@/lib/greetingCards.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REACTIONS = new Set(['❤️', '🙏', '😂', '🥹', '👏', '🎉']);

async function readToken(db: FirebaseFirestore.Firestore, token: string) {
  if (!token || token.length > 40 || !/^[a-z0-9]+$/.test(token)) return null;
  const t = (await db.collection('shareTokens').doc(token).get()).data() as { kind?: string; familyId?: string; cardId?: string; createdAt?: number } | undefined;
  if (!t || t.kind !== 'card' || !t.familyId || !t.cardId) return null;
  const expired = Date.now() - (t.createdAt || 0) > CARD_LINK_TTL_MS;
  return { expired, familyId: t.familyId, cardId: t.cardId };
}

function projection(card: GreetingCard, familyName: string) {
  return {
    id: card.id, type: card.type, nth: card.nth ?? null, dateKey: card.dateKey, eventTitle: card.eventTitle,
    honoree: { name: card.honoree.name, relationship: card.honoree.relationship, contactId: card.honoree.contactId || null },
    theme: card.theme, accent: card.accent || null, stickers: card.stickers || [], photoUrl: card.photoUrl || null, imageUrl: card.imageUrl || null,
    oneLiner: card.oneLiner, message: card.message, lang: card.lang || 'en',
    lines: (card.lines || []).map((l) => ({ name: l.name, text: l.text, kid: !!l.kid })),
    signatureLine: card.signatureLine, signatureRoster: card.signatureRoster || null,
    familyName, thanksCount: (card.thanks || []).length,
  };
}

export async function GET(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  const token = (req.nextUrl.searchParams.get('token') || '').trim();
  const t = await readToken(db, token);
  if (!t) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (t.expired) return NextResponse.json({ error: 'expired' }, { status: 410 });
  const famRef = db.collection('families').doc(t.familyId);
  const [famSnap, cardSnap] = await Promise.all([famRef.get(), famRef.collection('greetingCards').doc(t.cardId).get()]);
  if (!cardSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const card = { id: cardSnap.id, ...(cardSnap.data() as Omit<GreetingCard, 'id'>) };
  if (card.publicToken && card.publicToken !== token) return NextResponse.json({ error: 'not-found' }, { status: 404 }); // revoked/rotated
  const famName = (famSnap.data() as { name?: string } | undefined)?.name || '';
  return NextResponse.json({ card: projection(card, famName) });
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  const t = await readToken(db, token);
  if (!t) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (t.expired) return NextResponse.json({ error: 'expired' }, { status: 410 });
  const famRef = db.collection('families').doc(t.familyId);
  const cardRef = famRef.collection('greetingCards').doc(t.cardId);
  const cardSnap = await cardRef.get();
  if (!cardSnap.exists) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const card = { id: cardSnap.id, ...(cardSnap.data() as Omit<GreetingCard, 'id'>) };
  if (card.publicToken && card.publicToken !== token) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const action = typeof body.action === 'string' ? body.action : '';

  if (action === 'thanks') {
    const reaction = typeof body.reaction === 'string' && REACTIONS.has(body.reaction) ? body.reaction : '';
    const text = typeof body.text === 'string' ? body.text.trim().slice(0, 240) : '';
    if (!reaction && !text) return NextResponse.json({ error: 'empty' }, { status: 400 });
    if ((card.thanks || []).length >= 8) return NextResponse.json({ error: 'enough' }, { status: 429 });
    const entry: Record<string, unknown> = { at: Date.now() };
    if (reaction) entry.reaction = reaction;
    if (text) entry.text = text;
    await cardRef.set({ thanks: FieldValue.arrayUnion(entry), updatedAt: Date.now() }, { merge: true });
    const first = shortName(card.honoree.name) || 'They';
    const chat = `🙏 ${first} says${reaction ? ` ${reaction}` : ''}${text ? `: “${text}”` : ''} · via the card`;
    await postCardToChat(db, t.familyId, card, { uid: 'kaya', name: `${card.honoree.name} ✉️` }, chat).catch(() => {});
    const link = `/reminders?card=${encodeURIComponent(card.id)}`;
    if (card.authorUid && card.authorUid !== 'kaya') await bell(db, t.familyId, card.authorUid, { title: `🙏 ${first} loved your card`, message: `${reaction || ''} ${text || 'Your card landed.'}`.trim(), link });
    for (const p of await familyParents(db, t.familyId)) {
      if (p.uid !== card.authorUid) await bell(db, t.familyId, p.uid, { title: `🙏 ${first} replied to the card`, message: `${reaction || ''} ${text || ''}`.trim() || 'They sent thanks.', link });
    }
    return NextResponse.json({ ok: true });
  }

  if (action === 'stop') {
    const contactId = typeof body.contactId === 'string' ? body.contactId.slice(0, 80) : '';
    if (!contactId || card.honoree.contactId !== contactId) return NextResponse.json({ error: 'not-allowed' }, { status: 403 });
    const famSnap = await famRef.get();
    const contacts = ((famSnap.data() as { contacts?: FamilyContact[] } | undefined)?.contacts) || [];
    const next = contacts.map((c) => (c.id === contactId ? { ...c, optOut: true, optOutAt: Date.now() } : c));
    await famRef.update({ contacts: next }).catch(() => {});
    for (const p of await familyParents(db, t.familyId)) {
      await bell(db, t.familyId, p.uid, { title: `🙅 ${card.honoree.name} asked Kaya to stop`, message: 'Kaya won\'t auto-send greetings to them any more. You can still share cards yourself.', link: '/settings#greetings' });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'unknown-action' }, { status: 400 });
}
