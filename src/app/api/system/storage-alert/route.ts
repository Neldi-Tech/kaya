// 📦 STOR PR1 — storage-quota alarm (fire-and-forget from safeUploadBytes).
//
// POST with a Firebase ID token (any family member — kids hit the wall too).
// Tells the PARENTS that Kaya's storage bucket is full: in-app bell + email
// (global alert-email recipients) + a 📜 Alert-log entry. Deduped to once
// per UTC day per family so a retry storm can't spam anyone. The payload is
// empty by design — there is nothing a caller could add.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';
import { Resend } from 'resend';
import { resolveAlertRecipients, type AlertEmailsConfig } from '@/lib/alertEmails.shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const resendKey = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const resend = resendKey ? new Resend(resendKey) : null;

const DEDUPE_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const adminAuth = getAdminAuth();
  if (!db || !adminAuth) return NextResponse.json({ error: 'admin-unavailable' }, { status: 503 });

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await adminAuth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  const user = (await db.collection('users').doc(uid).get()).data() as { familyId?: string } | undefined;
  const familyId = user?.familyId;
  if (!familyId) return NextResponse.json({ error: 'no-family' }, { status: 403 });

  const famRef = db.collection('families').doc(familyId);

  // Dedupe: one alarm per family per day (single-field where — no index).
  try {
    const prev = await famRef.collection('alertLog').where('kind', '==', 'storage_quota').get();
    const latest = prev.docs.reduce((m, d) => Math.max(m, Number((d.data() as { firedAt?: number }).firedAt ?? 0)), 0);
    if (Date.now() - latest < DEDUPE_MS) return NextResponse.json({ ok: true, deduped: true });
  } catch { /* dedupe is best-effort */ }

  // Parents of the family (+ email cascade's global level for the addresses).
  const parentsSnap = await db.collection('users')
    .where('familyId', '==', familyId).where('role', '==', 'parent').get();
  const people = parentsSnap.docs.map((d) => ({
    uid: d.id,
    name: (d.data() as { displayName?: string }).displayName || 'Parent',
    email: (d.data() as { email?: string }).email,
  }));
  const famData = (await famRef.get()).data() as { alertEmails?: AlertEmailsConfig } | undefined;
  const resolved = resolveAlertRecipients(famData?.alertEmails, 'utilities', people.map((p) => p.uid), undefined);
  const emailTo = people.filter((p) => resolved.uids.includes(p.uid) && p.email);

  const title = '📦 Kaya storage is full — uploads are failing';
  const message = 'Photos and clips can\'t upload until storage is expanded. Kaya\'s team has been signalled; kids see a friendly note instead of an error.';

  // In-app bell to every parent.
  const inappTo: { uid: string; name: string; role: string }[] = [];
  for (const p of people) {
    try {
      await famRef.collection('notifications').add({
        type: 'storage-quota', title, message, read: false,
        forUserId: p.uid, link: '/pantry/utility-meters/alerts', createdAt: new Date(),
      });
      inappTo.push({ uid: p.uid, name: p.name, role: 'parent' });
    } catch { /* best-effort per parent */ }
  }

  // Email (same navy template family as the low-balance alerts).
  let sent = false; let error: string | undefined;
  if (!resend) { error = 'resend-not-configured'; }
  else if (emailTo.length === 0) { error = 'no-recipients'; }
  else {
    const html = `
    <div style="font-family:Nunito,Arial,sans-serif;max-width:520px;margin:0 auto;padding:18px">
      <div style="border-radius:16px;padding:24px 18px;color:#fff;background:linear-gradient(135deg,#1E2A44,#2C3E60)">
        <div style="font-size:11px;font-weight:900;letter-spacing:2px;text-transform:uppercase;color:#E8B54A">📦 Kaya · System</div>
        <div style="font-size:19px;font-weight:900;margin-top:6px">Storage is full — uploads are failing</div>
        <div style="font-size:13px;opacity:.92;margin-top:4px">A family member just hit the wall trying to upload a photo.</div>
      </div>
      <p style="font-size:14px;color:#26303B;margin-top:16px">Kids see a friendly note instead of an error, and nothing is lost — but no new photos or clips can be saved until storage is expanded on Kaya's side.</p>
      <div style="font-size:11.5px;color:#5C6975;margin-top:12px;text-align:center">One alert per day — Kaya stays quiet until it fires again tomorrow if still full.</div>
    </div>`;
    try {
      await resend.emails.send({
        from: RESEND_FROM, to: emailTo.map((p) => p.email as string),
        subject: title, html,
      });
      sent = true;
    } catch (e) { error = e instanceof Error ? e.message : 'send-failed'; }
  }

  // 📜 The trace — same log everything else uses.
  try {
    await famRef.collection('alertLog').add({
      kind: 'storage_quota',
      firedAt: Date.now(),
      trigger: 'system',
      channels: {
        email: {
          on: true, sent,
          ...(error ? { error } : {}),
          to: emailTo.map((p) => ({ name: p.name, email: p.email as string })),
          subject: title,
          templateVersion: 1,
        },
        inapp: { on: true, sent: inappTo.length > 0, to: inappTo, title, message },
      },
    });
  } catch { /* logging is best-effort */ }

  return NextResponse.json({ ok: true });
}
