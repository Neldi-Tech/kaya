// 🔐 Security & privacy (SET PR4 · M12) — parent resets a KID's email login.
//
// Two modes, matching the approved v2 design exactly:
//   • mode 'default-password' — a fresh temporary password is set on the
//     kid's auth account and EMAILED to their login email; the kid is asked
//     to change it after signing in (users/{uid}.mustChangePassword flags
//     the in-app nudge). The plaintext goes only to the kid's email — never
//     back to the caller's screen, never persisted.
//   • mode 'reset-link' — a Firebase password-reset link is generated and
//     emailed, so the kid sets their own.
//
// Kaya-Code resets stay on the existing parent-only /api/coppa/generate-code.
// Caller must be a PARENT of the kid's family (ID-token verified). Every
// send is traced in the 📜 alertLog. No-ops (503) without admin creds.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth, getAdminFirestore } from '@/lib/firebaseAdmin';
import { Resend } from 'resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const resendKey = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Kaya <noreply@ourkaya.com>';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ourkaya.com';
const resend = resendKey ? new Resend(resendKey) : null;

// Ambiguity-stripped alphabet (no 0/O/1/I/L) — same family as helper codes.
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function tempPassword(len = 8): string {
  let out = '';
  for (let i = 0; i < len; i++) out += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  return out;
}

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  const db = getAdminFirestore();
  if (!auth || !db) return NextResponse.json({ ok: false, error: 'admin-not-configured' }, { status: 503 });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let callerUid: string;
  try { callerUid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  let body: { childId?: string; mode?: string };
  try { body = (await req.json()) as typeof body; } catch { body = {}; }
  const childId = (body.childId || '').trim();
  const mode = body.mode === 'reset-link' ? 'reset-link' : 'default-password';
  if (!childId) return NextResponse.json({ ok: false, error: 'missing-childId' }, { status: 400 });

  // Caller must be a parent; the kid must be in their family.
  const callerSnap = await db.collection('users').doc(callerUid).get();
  const caller = callerSnap.data() as { role?: string; familyId?: string } | undefined;
  if (!caller || caller.role !== 'parent' || !caller.familyId) {
    return NextResponse.json({ ok: false, error: 'not-a-parent' }, { status: 403 });
  }
  const familyId = caller.familyId;
  const childSnap = await db.collection('families').doc(familyId).collection('children').doc(childId).get();
  if (!childSnap.exists) return NextResponse.json({ ok: false, error: 'child-not-in-family' }, { status: 403 });
  const child = childSnap.data() as { name?: string; email?: string; loginEnabled?: boolean };
  const loginEmail = (child.email || '').trim();
  if (!loginEmail) return NextResponse.json({ ok: false, error: 'kid-has-no-email-login' }, { status: 400 });
  const firstName = String(child.name || 'there').split(' ')[0];

  const log = async (detail: string, error?: string) => {
    try {
      await db.collection('families').doc(familyId).collection('alertLog').add({
        kind: 'security', trigger: 'system', at: Date.now(), childId,
        detail, byUid: callerUid, ...(error ? { error } : {}),
      });
    } catch { /* trace is best-effort */ }
  };

  try {
    if (mode === 'default-password') {
      // The kid's auth account — matched by their login email (the same
      // match the kid sign-in flow uses), so this works even before the
      // users-doc childId self-heal has run.
      const authUser = await auth.getUserByEmail(loginEmail).catch(() => null);
      if (!authUser) return NextResponse.json({ ok: false, error: 'kid-has-not-signed-in-yet' }, { status: 400 });
      const pw = tempPassword();
      await auth.updateUser(authUser.uid, { password: pw });
      await db.collection('users').doc(authUser.uid).set({ mustChangePassword: true }, { merge: true });
      if (!resend) { await log('default-password issued, email NOT sent', 'resend-not-configured'); }
      else {
        await resend.emails.send({
          from: RESEND_FROM,
          to: loginEmail,
          subject: `🔐 ${firstName}, here's your new Kaya password`,
          html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:16px">
            <h2 style="margin:0 0 8px">🔐 A new password for you, ${firstName}!</h2>
            <p>A parent reset your Kaya sign-in. Your temporary password is:</p>
            <p style="font-size:24px;font-weight:900;letter-spacing:3px;background:#FBF4E4;border-radius:12px;padding:12px 16px;text-align:center">${pw}</p>
            <p>Sign in at <a href="${APP_URL}">${APP_URL.replace('https://', '')}</a> and please <b>change it to your own</b> right after — Kaya will remind you.</p>
            <p style="color:#8A8471;font-size:12px">If you didn't expect this, tell your parent.</p>
          </div>`,
        });
        await log(`default password emailed to the kid's login email (${mode})`);
      }
      return NextResponse.json({ ok: true, mode, sentTo: loginEmail });
    }

    // mode === 'reset-link' — the kid sets their own.
    const link = await auth.generatePasswordResetLink(loginEmail);
    if (!resend) { await log('reset link generated, email NOT sent', 'resend-not-configured'); }
    else {
      await resend.emails.send({
        from: RESEND_FROM,
        to: loginEmail,
        subject: `🔐 ${firstName}, set your new Kaya password`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:16px">
          <h2 style="margin:0 0 8px">🔐 Pick a new password, ${firstName}!</h2>
          <p>A parent asked Kaya to let you set a fresh password of your own:</p>
          <p style="text-align:center;margin:16px 0"><a href="${link}" style="background:#F0A32A;color:#fff;font-weight:800;border-radius:999px;padding:12px 22px;text-decoration:none">Set my new password</a></p>
          <p style="color:#8A8471;font-size:12px">The link works once. If you didn't expect this, tell your parent.</p>
        </div>`,
      });
      await log('set-your-own reset link emailed to the kid');
    }
    return NextResponse.json({ ok: true, mode, sentTo: loginEmail });
  } catch (e) {
    await log('kid login reset FAILED', String(e).slice(0, 300));
    return NextResponse.json({ ok: false, error: 'reset-failed' }, { status: 500 });
  }
}
