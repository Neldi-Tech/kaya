import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { bell, familyParents, kidLoginUid } from '@/lib/greetingCards.server';

// Timeline 2.0 · 💌 the public reply page's API (design v2 innovation #6).
//
// No login. The shareTokens/{token} doc (kind:'note') is a SELF-CONTAINED
// projection written at send time — this route never reads the journal,
// so a leaked or brute-forced URL can only ever see the one note that
// was deliberately sent. Replies are capped, clamped, pinned back onto
// that day's journal entry (note_replies) and belled to the kid+parents.
// Opt-out flips the People-Book contact's optOut — the /c/[token] model.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const TTL_MS = 90 * 24 * 60 * 60 * 1000;
const REACTIONS = new Set(['💛', '🙏', '😂', '🥹', '👏', '🎉']);

interface NoteToken {
  kind?: string; familyId?: string; kidId?: string;
  surface?: 'reflection' | 'diary'; date?: string; entryId?: string;
  kidName?: string; surfaceLabel?: string; dateLabel?: string;
  feeling?: string; text?: string; theme?: string;
  contactId?: string; contactName?: string; familyName?: string;
  createdAt?: number; thanks?: Array<{ by: string; emoji?: string; text?: string; at: number }>;
}

async function readToken(db: FirebaseFirestore.Firestore, token: string | null) {
  if (!token || token.length > 40 || !/^[a-z0-9]+$/.test(token)) return null;
  const snap = await db.collection('shareTokens').doc(token).get();
  const t = snap.data() as NoteToken | undefined;
  if (!t || t.kind !== 'note' || !t.familyId || !t.kidId) return null;
  const expired = Date.now() - (t.createdAt || 0) > TTL_MS;
  return { expired, t, ref: snap.ref };
}

export async function GET(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  const found = await readToken(db, req.nextUrl.searchParams.get('token'));
  if (!found) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (found.expired) return NextResponse.json({ error: 'expired' }, { status: 410 });
  const { t } = found;
  // Narrow projection only — never the raw doc.
  return NextResponse.json({
    kidName: t.kidName, surfaceLabel: t.surfaceLabel, dateLabel: t.dateLabel,
    feeling: t.feeling ?? null, text: t.text, theme: t.theme ?? 'classic',
    familyName: t.familyName, contactId: t.contactId ?? null,
    contactName: t.contactName ?? null,
    thanksCount: (t.thanks ?? []).length,
  });
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  if (!db) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });
  const body = await req.json().catch(() => ({})) as
    { token?: string; action?: string; reaction?: string; text?: string; contactId?: string };
  const found = await readToken(db, body.token ?? null);
  if (!found) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  if (found.expired) return NextResponse.json({ error: 'expired' }, { status: 410 });
  const { t, ref } = found;
  const famRef = db.collection('families').doc(t.familyId as string);

  // ── 🙏 a thank-you back to the kid ──
  if (body.action === 'thanks') {
    const reaction = REACTIONS.has(body.reaction ?? '') ? body.reaction : '💛';
    const text = (body.text ?? '').trim().slice(0, 240);
    if ((t.thanks ?? []).length >= 8) return NextResponse.json({ error: 'enough' }, { status: 429 });
    const entry = { by: t.contactName || 'Someone', emoji: reaction, ...(text ? { text } : {}), at: Date.now() };
    await ref.set({ thanks: FieldValue.arrayUnion(entry) }, { merge: true });

    // Pin the reply onto that day's journal entry (visible kid + parents).
    try {
      if (t.surface === 'reflection' && t.date) {
        await famRef.collection('sparks_reflections').doc(`${t.kidId}_${t.date}`)
          .set({ note_replies: FieldValue.arrayUnion(entry) }, { merge: true });
      } else if (t.surface === 'diary' && t.entryId) {
        await famRef.collection('sparks_diary').doc(t.entryId)
          .set({ note_replies: FieldValue.arrayUnion(entry) }, { merge: true });
      }
    } catch { /* pin is best-effort; the thanks itself is stored */ }

    // 🔔 bell the kid (login uid when one exists) + every parent.
    try {
      const link = t.surface === 'diary' ? `/sparks/${t.kidId}/diary` : `/sparks/${t.kidId}/reflection`;
      const title = `💌 ${entry.by} sent back a ${reaction}`;
      const message = text || `They loved ${t.kidName}'s ${t.dateLabel} note.`;
      const kidUid = await kidLoginUid(db, t.familyId as string, t.kidId as string);
      if (kidUid) await bell(db, t.familyId as string, kidUid, { title, message, link });
      for (const p of await familyParents(db, t.familyId as string)) {
        await bell(db, t.familyId as string, p.uid, { title, message, link });
      }
    } catch { /* bells are best-effort */ }

    return NextResponse.json({ ok: true });
  }

  // ── ✋ stop — opt this contact out of future notes/greetings ──
  if (body.action === 'stop') {
    const contactId = body.contactId ?? '';
    if (!contactId || t.contactId !== contactId) {
      return NextResponse.json({ error: 'not-allowed' }, { status: 403 });
    }
    const fam = (await famRef.get()).data() as
      { contacts?: Array<{ id: string; optOut?: boolean; optOutAt?: number }> } | undefined;
    const contacts = fam?.contacts ?? [];
    const next = contacts.map((c) => (c.id === contactId ? { ...c, optOut: true, optOutAt: Date.now() } : c));
    await famRef.update({ contacts: next });
    try {
      for (const p of await familyParents(db, t.familyId as string)) {
        await bell(db, t.familyId as string, p.uid, {
          title: '✋ A contact opted out of notes',
          message: `${t.contactName || 'A contact'} asked to stop receiving shared notes.`,
          link: '/settings#greetings',
        });
      }
    } catch { /* best-effort */ }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'bad-action' }, { status: 400 });
}
