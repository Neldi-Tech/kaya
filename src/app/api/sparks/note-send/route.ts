import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { renderNoteEmail, NOTE_EMAIL_TEMPLATE_VERSION } from '@/lib/noteEmail';

// Timeline 2.0 · 💌 Send-to-Someone gateway (design v2 innovation #6).
//
// POST { action: 'send', kidId, surface, date, contactId, entryId? }
// Emails a day's note to ONE People-Book contact (family.contacts —
// parent-added only, opt-out honoured) with a public reply link
// (/n/{token}). The note text is re-read SERVER-SIDE from the journal
// — the client never supplies the content, so it can't be tampered
// with and locked/redacted diary pages can never leak.
//
// Who may send: parents always; a kid only for their own journal AND
// only when a parent has approved a 'note_share' ask for that exact
// day (the approval rail). Helpers: no.
//
// Zero rules deploys: shareTokens + alertLog are Admin-only collections.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
function mintToken(): string {
  const b = randomBytes(10);
  let s = '';
  for (const x of b) s += ALPHABET[x % 32];
  return s;
}

interface ContactLite {
  id: string; name: string; email?: string; emails?: string[];
  optOut?: boolean; lang?: string;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const body = await req.json().catch(() => ({})) as {
    action?: string; kidId?: string; surface?: 'reflection' | 'diary';
    date?: string; contactId?: string; kidName?: string;
    surfaceLabel?: string; dateLabel?: string; theme?: string;
  };
  if (body.action !== 'send') return NextResponse.json({ error: 'bad-action' }, { status: 400 });

  const { kidId, surface, date, contactId } = body;
  if (!kidId || !contactId || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || (surface !== 'reflection' && surface !== 'diary')) {
    return NextResponse.json({ error: 'bad-args' }, { status: 400 });
  }

  // ── caller + role (users doc; kid logins resolve via children) ──
  const user = (await db.collection('users').doc(uid).get()).data() as
    { familyId?: string; role?: string; displayName?: string; email?: string; childId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });
  const role = user?.role === 'kid' || user?.role === 'helper' ? user.role : 'parent';
  if (role === 'helper') return NextResponse.json({ error: 'parents-only' }, { status: 403 });

  if (role === 'kid') {
    // Kids: own journal only + an APPROVED note_share pass for this day.
    if (user?.childId !== kidId) return NextResponse.json({ error: 'own-journal-only' }, { status: 403 });
    const pass = await db.collection('families').doc(familyId).collection('approvalRequests')
      .where('kidId', '==', kidId)
      .where('type', '==', 'note_share')
      .where('noteDate', '==', date)
      .where('status', '==', 'approved')
      .limit(1).get();
    if (pass.empty) return NextResponse.json({ error: 'ask-a-parent-first' }, { status: 403 });
  }

  const famRef = db.collection('families').doc(familyId);
  const fam = (await famRef.get()).data() as
    { name?: string; familyName?: string; contacts?: ContactLite[] } | undefined;
  const familyName = fam?.familyName || fam?.name || 'Kaya';

  // ── the recipient — People Book only, opt-out honoured ──
  const contact = (fam?.contacts ?? []).find((c) => c.id === contactId);
  if (!contact) return NextResponse.json({ error: 'contact-not-found' }, { status: 404 });
  if (contact.optOut) return NextResponse.json({ error: 'opted-out' }, { status: 409 });
  const emails = [contact.email, ...(contact.emails ?? [])]
    .filter((e): e is string => !!e && e.includes('@'));
  const to = Array.from(new Set(emails));
  if (to.length === 0) return NextResponse.json({ error: 'contact-has-no-email' }, { status: 409 });

  // ── re-read the note SERVER-SIDE (never trust client content) ──
  let text = '';
  let feeling: string | undefined;
  let entryId: string | undefined;
  if (surface === 'reflection') {
    const e = (await famRef.collection('sparks_reflections').doc(`${kidId}_${date}`).get()).data() as
      { text?: string; ai_read?: { mood_emoji?: string } } | undefined;
    text = (e?.text ?? '').trim();
    feeling = e?.ai_read?.mood_emoji;
  } else {
    const snap = await famRef.collection('sparks_diary')
      .where('ownerId', '==', kidId).where('date', '==', date).get();
    const rows = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as { time?: string; locked?: boolean; feeling?: string; blocks?: Array<{ kind?: string; text?: string }>; sealed_until?: string }) }))
      .filter((r) => r.locked !== true && !(r.sealed_until && r.sealed_until > date))
      .sort((a, b) => ((a.time ?? '') < (b.time ?? '') ? -1 : 1));
    text = rows
      .flatMap((r) => (r.blocks ?? []).filter((b) => b.kind === 'text' && b.text?.trim()).map((b) => (b.text as string).trim()))
      .join('\n\n');
    feeling = rows.find((r) => r.feeling)?.feeling;
    entryId = rows[0]?.id;
  }
  if (!text) return NextResponse.json({ error: 'nothing-shareable' }, { status: 409 });
  text = text.slice(0, 4000);

  // ── card labels (display-only; server clamps) ──
  const kidName = (body.kidName || user?.displayName || 'Kaya kid').slice(0, 40);
  const surfaceLabel = (body.surfaceLabel || (surface === 'diary' ? 'My Diary' : 'My Reflection')).slice(0, 40);
  const dateLabel = (body.dateLabel || date).slice(0, 40);
  const theme = ['classic', 'scrapbook', 'starry', 'sunshine'].includes(body.theme ?? '') ? body.theme : 'classic';

  // ── mint the reply token — a SELF-CONTAINED projection, so the
  //    public page never reads the journal at all ──
  const shareToken = mintToken();
  await db.collection('shareTokens').doc(shareToken).set({
    kind: 'note', familyId, kidId, surface, date,
    ...(entryId ? { entryId } : {}),
    kidName, surfaceLabel, dateLabel, ...(feeling ? { feeling } : {}), text, theme,
    contactId, contactName: contact.name,
    familyName, createdAt: Date.now(), thanks: [],
  });
  const publicUrl = `${APP_URL}/n/${shareToken}`;
  const stopUrl = `${APP_URL}/n/${shareToken}?stop=${encodeURIComponent(contactId)}`;

  // ── send ──
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'email-not-configured' }, { status: 503 });
  const { Resend } = await import('resend');
  const resend = new Resend(apiKey);
  const { subject, html, text: plain } = renderNoteEmail({
    kidName, surfaceLabel, dateLabel, feeling, text, familyName, publicUrl, stopUrl,
  });
  let sendError: string | undefined;
  try {
    const r = await resend.emails.send({
      from: `${familyName} family via Kaya <noreply@ourkaya.com>`.slice(0, 80),
      to, subject, html, text: plain,
      ...(user?.email ? { replyTo: user.email } : {}),
    });
    if (r.error) sendError = r.error.message;
  } catch (e) {
    sendError = (e as Error).message;
  }

  // ── alertLog trace (as-sent facts; never blocks) ──
  await famRef.collection('alertLog').add({
    kind: 'note_send', firedAt: Date.now(), trigger: 'system',
    childId: kidId, childName: kidName,
    sourceLabel: `💌 ${surfaceLabel} · ${dateLabel} → ${contact.name}`,
    noteSurface: surface, noteDate: date, shareToken,
    channels: {
      email: {
        on: true, sent: !sendError, ...(sendError ? { error: sendError } : {}),
        to: to.map((email) => ({ name: contact.name, email })),
        subject, templateVersion: NOTE_EMAIL_TEMPLATE_VERSION,
      },
    },
  }).catch(() => { /* trace must never block the send */ });

  if (sendError) return NextResponse.json({ error: 'send-failed', detail: sendError.slice(0, 200) }, { status: 502 });
  return NextResponse.json({ ok: true, to, publicUrl });
}
