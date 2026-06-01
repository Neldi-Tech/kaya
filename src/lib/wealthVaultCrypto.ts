// Kaya Wealth · vault TOTP-secret encryption at rest — server-only.
//
// The vault's per-user TOTP secret is the key to a 2FA challenge, so it is
// NEVER stored in the clear: we AES-256-GCM encrypt it with a server-side
// key (WEALTH_VAULT_ENC_KEY) before writing to Firestore, and decrypt only
// inside the verify path (Admin SDK routes). Mirrors lib/gmailTokenCrypto.ts.
//
// The key is 32 bytes, provided as hex (64 chars) or base64. If it's missing
// or malformed, isVaultCryptoConfigured() is false — the vault then degrades
// to the session-gate lock (no real 2FA) rather than failing, and surfaces a
// "set WEALTH_VAULT_ENC_KEY to activate 2FA" state. Generate one with:
//   openssl rand -base64 32

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGO = 'aes-256-gcm';

function getKey(): Buffer | null {
  const raw = (process.env.WEALTH_VAULT_ENC_KEY || '').trim();
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  try {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  } catch { /* fall through */ }
  return null;
}

/** True when a valid 32-byte vault key is configured. */
export function isVaultCryptoConfigured(): boolean {
  return getKey() !== null;
}

/** Encrypt a secret → "iv.tag.ciphertext" (all base64). Throws if no key. */
export function encryptSecret(plain: string): string {
  const key = getKey();
  if (!key) throw new Error('WEALTH_VAULT_ENC_KEY not configured');
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${enc.toString('base64')}`;
}

/** Decrypt an "iv.tag.ciphertext" payload → secret, or null on any failure. */
export function decryptSecret(payload: string | null | undefined): string | null {
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
