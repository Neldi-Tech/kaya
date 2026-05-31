// Gmail connect — step 2: the OAuth callback.
//
// Google redirects the parent's browser here after consent. We:
//   1. verify the returned `state` against the httpOnly nonce cookie (CSRF),
//   2. exchange the one-time code for a short-lived access token,
//   3. search the inbox for known subscription-sender receipts (read-only),
//   4. parse each body into subscription drafts (same Claude parser as paste),
//   5. de-dupe and stash ONLY the drafts under the parent's uid (admin write,
//      no rules deploy needed), then DISCARD the token + clear the cookie,
//   6. redirect back to /household/subscriptions with a status flag.
//
// The raw email bodies and the access token are never persisted — we keep
// only the parsed drafts, which the parent reviews + confirms before any
// subscription is created. Single-use: access_type was 'online', so there
// is no refresh token and no standing mailbox access.
//
// Config-gated — 404s while Gmail is off.

import { NextRequest, NextResponse } from 'next/server';
import { isGmailConfigured, exchangeCodeForToken, fetchSubscriptionEmailBodies } from '@/lib/gmailSubscriptionScan';
import { parseSubscriptionsFromText, dedupeDrafts, type ParsedSubDraft } from '@/lib/subscriptionReceiptParse';
import { getAdminFirestore } from '@/lib/firebaseAdmin';

export const runtime = 'nodejs';
export const maxDuration = 60;

const COOKIE = 'kaya_gmail_state';
const BACK = '/household/subscriptions';

/** Redirect home with a status flag; always clears the state cookie. */
function done(origin: string, status: string): NextResponse {
  const res = NextResponse.redirect(`${origin}${BACK}?gmailScan=${status}`);
  res.cookies.set(COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const origin = `${url.protocol}//${url.host}`;

  if (!isGmailConfigured()) {
    return NextResponse.json({ error: 'Gmail connect is not configured.' }, { status: 404 });
  }

  // The user can deny consent — Google sends ?error=access_denied.
  if (url.searchParams.get('error')) return done(origin, 'cancelled');

  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const cookieNonce = req.cookies.get(COOKIE)?.value || '';

  // CSRF: the state's nonce must match the httpOnly cookie we set in /start.
  const parts = state.split('.');
  if (!code || parts.length !== 3 || !cookieNonce || parts[0] !== cookieNonce) {
    return done(origin, 'error');
  }
  const [, familyId, uid] = parts;
  if (!familyId || !uid) return done(origin, 'error');

  try {
    const accessToken = await exchangeCodeForToken(origin, code);
    if (!accessToken) return done(origin, 'error');

    const bodies = await fetchSubscriptionEmailBodies(accessToken, { months: 12, max: 25 });
    // Token has done its job — nothing about it is retained beyond this scope.

    if (bodies.length === 0) return done(origin, 'empty');

    // Parse each email body, then de-dupe across them (the same service
    // recurs month to month). Bodies are ordered newest-first by Gmail.
    let drafts: ParsedSubDraft[] = [];
    for (const body of bodies) {
      try {
        const found = await parseSubscriptionsFromText(body);
        drafts.push(...found);
      } catch { /* skip a body that fails to parse; keep the rest */ }
    }
    drafts = dedupeDrafts(drafts);

    // AI key missing → parser returns nothing; tell the user it's off.
    if (drafts.length === 0) {
      return done(origin, process.env.ANTHROPIC_API_KEY ? 'empty' : 'skipped');
    }

    // Stash ONLY the parsed drafts (no raw email text) for the page to pick
    // up. Admin write = no Firestore-rules change. Consumed + deleted on read.
    const db = getAdminFirestore();
    if (!db) return done(origin, 'error');
    await db
      .collection('families').doc(familyId)
      .collection('subscriptionScans').doc(uid)
      .set({ drafts, source: 'gmail', count: drafts.length, createdAt: new Date() });

    return done(origin, 'done');
  } catch {
    return done(origin, 'error');
  }
}
