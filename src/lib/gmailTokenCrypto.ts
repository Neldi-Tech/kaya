// Gmail refresh-token encryption at rest — server-only.
//
// The scheduled scan needs a long-lived Gmail refresh token so the weekly
// cron can mint fresh access tokens without the parent re-consenting. That
// token is sensitive (standing read-only mailbox access), so it is NEVER
// stored in the clear: we AES-256-GCM encrypt it with a server-side key
// (GMAIL_TOKEN_ENC_KEY) before writing to Firestore, and decrypt only inside
// the cron / disconnect path.
//
// The key is 32 bytes, provided as hex (64 chars) or base64. If it's missing
// or malformed, isTokenCryptoConfigured() is false — the connect flow then
// declines to store a token (scheduling stays off) but the one-off scan still
// works. So the feature degrades safely rather than storing plaintext.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

/** Parse GMAIL_TOKEN_ENC_KEY into a 32-byte Buffer, or null if absent/bad. */
function getKey(): Buffer | null {
  const raw = (process.env.GMAIL_TOKEN_ENC_KEY || '').trim();
  if (!raw) return null;
  // Try hex first (64 hex chars = 32 bytes), then base64.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch { /* fall through */ }
  return null;
}

/** True when a valid 32-byte encryption key is configured. */
export function isTokenCryptoConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt a token → "iv.tag.ciphertext" (all base64). Throws if no key. */
export function encryptToken(plain: string): string {
  const key = getKey();
  if (!key) throw new Error('GMAIL_TOKEN_ENC_KEY not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/** Decrypt an "iv.tag.ciphertext" payload → token, or null on any failure. */
export function decryptToken(payload: string): string | null {
  const key = getKey();
  if (!key || !payload) return null;
  const parts = payload.split('.');
  if (parts.length !== 3) return null;
  try {
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const enc = Buffer.from(parts[2], 'base64');
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(enc), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}
