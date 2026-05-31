// Gmail connect — step 1: kick off the OAuth consent.
//
// The signed-in parent's client navigates here with ?familyId=&uid=.
// We mint a CSRF state (random nonce + the family/uid it belongs to),
// stash the nonce in an httpOnly cookie, and 302 to Google's consent
// screen. The callback verifies the cookie nonce matches the returned
// state before trusting it. Config-gated — 404s while Gmail is off.

import { NextRequest, NextResponse } from 'next/server';
import { isGmailConfigured, buildConsentUrl } from '@/lib/gmailSubscriptionScan';
import { randomBytes } from 'crypto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  if (!isGmailConfigured()) {
    return NextResponse.json({ error: 'Gmail connect is not configured.' }, { status: 404 });
  }
  const url = new URL(req.url);
  const familyId = url.searchParams.get('familyId') || '';
  const uid = url.searchParams.get('uid') || '';
  if (!familyId || !uid) {
    return NextResponse.json({ error: 'Missing familyId / uid' }, { status: 400 });
  }

  const nonce = randomBytes(16).toString('hex');
  // state carries who this is for; the cookie carries the secret nonce.
  const state = `${nonce}.${familyId}.${uid}`;
  const origin = `${url.protocol}//${url.host}`;
  const consent = buildConsentUrl(origin, state);

  const res = NextResponse.redirect(consent);
  res.cookies.set('kaya_gmail_state', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600, // 10 min — enough to complete consent
  });
  return res;
}
