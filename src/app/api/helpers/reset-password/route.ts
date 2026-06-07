// Helpers · reset a Tier A sign-in password (server, Admin SDK).
//
// The Firebase *client* SDK can't change another user's password — only
// the user themselves can. So rotating/setting a helper's password runs
// here with the Admin SDK after verifying the caller's Firebase ID token
// and confirming they're a PARENT of the target family.
//
// Same UID is kept (we updateUser on the existing helper auth account),
// so all of the helper's history — ratings, awards, payroll — stays
// intact. The new password is also written to the HelperLink doc so the
// parent can re-view & re-share it from the Sign-in details card. This
// powers two cases:
//   (a) helpers created before passwords were stored — first viewable
//       password;
//   (b) compromise rotation (the old password stops working for new
//       sign-ins; use Pause for an instant hard lockout of live sessions).
//
// No-ops cleanly (503) without admin creds, matching the other routes.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminFirestore, getAdminAuth } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Same ambiguity-stripped alphabet as lib/helpers.ts generatePassword,
// inlined because that module is 'use client' and can't be imported here.
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generatePassword(len = 6): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  }
  return out;
}

export async function POST(req: NextRequest) {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) {
    return NextResponse.json({ error: 'admin-not-configured' }, { status: 503 });
  }

  // 1 · Verify the caller's Firebase ID token.
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  let callerUid: string;
  try { callerUid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ error: 'invalid-token' }, { status: 401 }); }

  // 2 · Parse + validate the body. `password` is optional — when present
  //     it's a parent-chosen custom password (must be 6–64 chars, per
  //     Firebase Auth's 6-char minimum); when absent we generate one.
  let body: { familyId?: string; helperUid?: string; password?: string };
  try { body = (await req.json()) as { familyId?: string; helperUid?: string; password?: string }; }
  catch { return NextResponse.json({ error: 'bad-json' }, { status: 400 }); }
  const familyId = (body.familyId || '').trim();
  const helperUid = (body.helperUid || '').trim();
  if (!familyId || !helperUid) {
    return NextResponse.json({ error: 'missing-params' }, { status: 400 });
  }
  const custom = typeof body.password === 'string' ? body.password.trim() : '';
  if (custom && (custom.length < 6 || custom.length > 64)) {
    return NextResponse.json({ error: 'Password must be 6–64 characters.' }, { status: 400 });
  }

  // 3 · Authorise — the caller must be a PARENT of this family.
  const caller = (await db.collection('users').doc(callerUid).get()).data() as
    { familyId?: string; role?: string } | undefined;
  if (!caller || caller.role !== 'parent' || caller.familyId !== familyId) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // 4 · Confirm the target is a real helper in that family (and grab the
  //     doc ref for the password write). Doc id === the helper's auth UID.
  const helperRef = db.collection('families').doc(familyId).collection('helpers').doc(helperUid);
  const helperSnap = await helperRef.get();
  if (!helperSnap.exists) {
    return NextResponse.json({ error: 'helper-not-found' }, { status: 404 });
  }

  // 5 · Set the password on the existing auth user + mirror it onto the
  //     doc so the parent can re-view it. Parent-chosen custom value when
  //     supplied, otherwise a generated one.
  const password = custom || generatePassword(6);
  try {
    await auth.updateUser(helperUid, { password });
  } catch (e) {
    console.error('[helpers/reset-password] updateUser failed', e);
    return NextResponse.json({ error: 'auth-update-failed' }, { status: 500 });
  }
  try {
    await helperRef.update({ password });
  } catch (e) {
    // The auth password is already changed at this point; surface the
    // value so the parent can still share it, but log the doc-write miss.
    console.error('[helpers/reset-password] doc update failed', e);
  }

  return NextResponse.json({ ok: true, password });
}
