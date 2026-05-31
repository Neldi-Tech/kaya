// Gmail subscription scan — server-only helpers (auto-detect).
//
// Read-only access to find subscription receipts. The parent connects ONCE
// (offline access → a refresh token) and Kaya re-scans on a weekly cron, so
// nobody has to remember to do anything. The refresh token is encrypted at
// rest (see gmailTokenCrypto) and can be revoked any time via disconnect.
//
// Entirely config-gated: every entry point first checks isGmailConfigured()
// so the feature is dormant until GOOGLE_OAUTH_CLIENT_ID + _SECRET are set
// in the environment. The gmail.readonly scope requires Google OAuth app
// verification before it works for non-test users (operator setup).

const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

/** True only when both halves of the OAuth client are configured. The
 *  UI hides the "Connect Gmail" entry point until this is true. */
export function isGmailConfigured(): boolean {
  return !!process.env.GOOGLE_OAUTH_CLIENT_ID && !!process.env.GOOGLE_OAUTH_CLIENT_SECRET;
}

/** The redirect URI Google calls back. Must EXACTLY match an authorized
 *  redirect URI in the Google Cloud OAuth client. Derived from the
 *  request origin so it works in preview + prod without hardcoding. */
export function gmailRedirectUri(origin: string): string {
  return `${origin}/api/subscriptions/gmail/callback`;
}

/** Build the Google consent URL. `state` is an opaque CSRF token the
 *  caller also stores in an httpOnly cookie + verifies on callback.
 *  access_type=offline + prompt=consent → Google returns a refresh token
 *  so the weekly cron can re-scan without the parent re-consenting. */
export function buildConsentUrl(origin: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
    redirect_uri: gmailRedirectUri(origin),
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',         // offline = issue a refresh token (scheduled scan)
    include_granted_scopes: 'false',
    prompt: 'consent',              // force consent so a refresh token is (re)issued
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;     // present on first consent; null on re-grant
}

/** Exchange the authorization code for an access token (+ refresh token). */
export async function exchangeCodeForToken(origin: string, code: string): Promise<TokenSet | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
      redirect_uri: gmailRedirectUri(origin),
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const accessToken = (data?.access_token as string) || '';
  if (!accessToken) return null;
  return { accessToken, refreshToken: (data?.refresh_token as string) || null };
}

/** Mint a fresh access token from a stored refresh token (cron path). */
export async function refreshAccessToken(refreshToken: string): Promise<string | null> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data?.access_token as string) || null;
}

/** Revoke a token at Google (used on disconnect — best-effort). */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
  } catch { /* best-effort; the doc is deleted regardless */ }
}

// Known subscription-receipt senders. Gmail search joins these with OR.
// Apple + Google Play first (the ask), then the big direct services.
const SENDERS = [
  'no_reply@email.apple.com',
  'googleplay-noreply@google.com',
  'payments-noreply@google.com',
  'info@netflix.com',
  'no-reply@spotify.com',
  'no-reply@youtube.com',
  'noreply@disneyplus.com',
];

interface GmailMessageMeta { id: string }

/** Search the inbox for subscription-sender receipts and return up to `max`
 *  decoded plain-text bodies. Read-only.
 *  - months: look-back window for a first/full scan (default 12).
 *  - afterEpochSec: when set (incremental cron scan), only messages newer
 *    than this unix-seconds timestamp are considered. */
export async function fetchSubscriptionEmailBodies(
  accessToken: string,
  opts: { months?: number; max?: number; afterEpochSec?: number } = {},
): Promise<string[]> {
  const months = opts.months ?? 12;
  const max = opts.max ?? 25;
  const fromClause = SENDERS.map((s) => `from:${s}`).join(' OR ');
  const window = opts.afterEpochSec ? `after:${opts.afterEpochSec}` : `newer_than:${months}m`;
  const q = `(${fromClause}) ${window}`;

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(q)}`,
    { headers: { authorization: `Bearer ${accessToken}` } },
  );
  if (!listRes.ok) return [];
  const list = await listRes.json().catch(() => null) as { messages?: GmailMessageMeta[] } | null;
  const ids = (list?.messages ?? []).map((m) => m.id).slice(0, max);

  const bodies: string[] = [];
  for (const id of ids) {
    try {
      const msgRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full`,
        { headers: { authorization: `Bearer ${accessToken}` } },
      );
      if (!msgRes.ok) continue;
      const msg = await msgRes.json();
      const text = extractPlainText(msg?.payload);
      if (text) bodies.push(text.slice(0, 8000));
    } catch { /* skip the one that failed */ }
  }
  return bodies;
}

/** Read the connected account's email address (for display on the chip). */
export async function fetchGmailAddress(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return (data?.emailAddress as string) || null;
  } catch {
    return null;
  }
}

/** Walk a Gmail message payload tree and pull the first text/plain part
 *  (falling back to text/html stripped of tags). base64url-decoded. */
function extractPlainText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as { mimeType?: string; body?: { data?: string }; parts?: unknown[] };
  if (p.mimeType === 'text/plain' && p.body?.data) {
    return decodeB64Url(p.body.data);
  }
  if (Array.isArray(p.parts)) {
    for (const part of p.parts) {
      const t = extractPlainText(part);
      if (t) return t;
    }
  }
  if (p.mimeType === 'text/html' && p.body?.data) {
    return decodeB64Url(p.body.data).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

function decodeB64Url(data: string): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(b64, 'base64').toString('utf-8');
  } catch {
    return '';
  }
}
