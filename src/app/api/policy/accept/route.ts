// Kaya · COPPA + Login — record a policy acceptance (clickwrap + /accept gate).
//
// Every consent-relevant tap (Create account, Log in, "I agree and continue")
// POSTs here. The write runs server-side with the Admin SDK so the acceptance
// trail is immutable: the client can append a record only through this
// token-verified endpoint, and can never edit or delete one.
//
// Best-effort by design — a logging failure returns { ok: false } but NEVER
// blocks auth. The acceptance IS the user's deliberate tap; this is the audit
// of it. Because it uses the Admin SDK it needs no Firestore-rules deploy.

import { NextRequest, NextResponse } from 'next/server';
import { getAdminAuth } from '@/lib/firebaseAdmin';
import { recordPolicyAcceptance } from '@/lib/coppa/server';
import type { PolicyAcceptanceType } from '@/lib/coppa/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_TYPES: PolicyAcceptanceType[] = ['signup', 'login_clickwrap', 'accept_gate'];

export async function POST(req: NextRequest) {
  const auth = getAdminAuth();
  if (!auth) return NextResponse.json({ ok: false, reason: 'admin-sdk-not-configured' });

  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return NextResponse.json({ ok: false, error: 'unauthenticated' }, { status: 401 });
  let uid: string;
  try { uid = (await auth.verifyIdToken(token)).uid; }
  catch { return NextResponse.json({ ok: false, error: 'invalid-token' }, { status: 401 }); }

  let body: { type?: string; surface?: string };
  try { body = (await req.json()) as { type?: string; surface?: string }; }
  catch { body = {}; }

  const type = (body.type || '') as PolicyAcceptanceType;
  if (!VALID_TYPES.includes(type)) {
    return NextResponse.json({ ok: false, error: 'bad-type' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = req.headers.get('user-agent');

  const ok = await recordPolicyAcceptance({
    uid,
    type,
    surface: typeof body.surface === 'string' ? body.surface.slice(0, 120) : undefined,
    ip,
    userAgent,
  });
  return NextResponse.json({ ok });
}
