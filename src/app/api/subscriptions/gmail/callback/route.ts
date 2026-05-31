// Gmail connect — OAuth callback.
//
// Google redirects the parent's browser here after consent. We:
//   1. verify the returned `state` against the httpOnly nonce cookie (CSRF),
//   2. exchange the code for an access token + (offline) refresh token,
//   3. run a first scan (last 12 months), parse + de-dupe, and write the
//      finds as PENDING suggestions (deduped vs existing subs/suggestions),
//   4. if a refresh token came back AND the encryption key is set, store it
//      ENCRYPTED so the weekly cron can re-scan without re-consent,
//   5. redirect back to /household/subscriptions with a status flag.
//
// The access token lives only inside this request; the refresh token is only
// ever persisted encrypted (gmailTokenCrypto). Raw email bodies are never
// stored — only the structured suggestions, which the parent confirms.
//
// Config-gated — 404s while Gmail is off.

import { NextRequest, NextResponse } from 'next/server';
import {
  isGmailConfigured, exchangeCodeForToken, fetchSubscriptionEmailBodies, fetchGmailAddress,
} from '@/lib/gmailSubscriptionScan';
import { parseSubscriptionsFromText, dedupeDrafts, type ParsedSubDraft } from '@/lib/subscriptionReceiptParse';
import { isTokenCryptoConfigured, encryptToken } from '@/lib/gmailTokenCrypto';
import { saveConnection, writeSuggestions } from '@/lib/gmailConnections';

export const runtime = 'nodejs';
export const maxDuration = 60;

const COOKIE = 'kaya_gmail_state';
const BACK = '/household/subscriptions';
const READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

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
    const tokens = await exchangeCodeForToken(origin, code);
    if (!tokens) return done(origin, 'error');

    // Store the refresh token (encrypted) so the cron can re-scan. Needs the
    // encryption key; without it we still do this one scan, just no schedule.
    if (tokens.refreshToken && isTokenCryptoConfigured()) {
      const email = await fetchGmailAddress(tokens.accessToken);
      await saveConnection(familyId, uid, {
        refreshTokenEnc: encryptToken(tokens.refreshToken),
        email,
        scope: READONLY_SCOPE,
      });
    }

    // First scan: last 12 months.
    const bodies = await fetchSubscriptionEmailBodies(tokens.accessToken, { months: 12, max: 25 });
    if (bodies.length === 0) return done(origin, 'connected_empty');

    let drafts: ParsedSubDraft[] = [];
    for (const body of bodies) {
      try { drafts.push(...await parseSubscriptionsFromText(body)); }
      catch { /* skip a body that fails to parse */ }
    }
    drafts = dedupeDrafts(drafts);
    if (drafts.length === 0) {
      return done(origin, process.env.ANTHROPIC_API_KEY ? 'connected_empty' : 'skipped');
    }

    const written = await writeSuggestions(familyId, uid, drafts);
    return done(origin, written > 0 ? 'connected' : 'connected_empty');
  } catch {
    return done(origin, 'error');
  }
}
