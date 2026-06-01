// Kaya Wealth · vault 2FA — server-only logic (Admin SDK + otplib).
//
// The vault is per-USER: each parent enrols their own authenticator and
// unlocks /wealth with a fresh TOTP. The encrypted secret + hashed recovery
// codes live at users/{uid}/security/wealthVault — a server-only doc
// (firestore.rules deny ALL client read/write; the Admin SDK bypasses).
// Clients only ever see this module through the /api/wealth/vault/* routes.
//
// Degrades safely: when WEALTH_VAULT_ENC_KEY isn't set the vault reports
// cryptoConfigured=false and the UI falls back to the session-gate lock.

import { createHash, randomBytes } from 'crypto';
import { TOTP, Secret } from 'otpauth';
import QRCode from 'qrcode';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore } from './firebaseAdmin';
import { isVaultCryptoConfigured, encryptSecret, decryptSecret } from './wealthVaultCrypto';

const ISSUER = 'Kaya Wealth';

// Build a TOTP generator/verifier for a stored base32 secret. SHA1/6/30 are
// the universal authenticator defaults. `validate({window:1})` tolerates ±1
// step (30s) of clock skew and returns the delta (or null when invalid).
function makeTotp(base32: string, label = 'member'): TOTP {
  return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(base32) });
}

function vaultRef(uid: string) {
  const db = getAdminFirestore();
  if (!db) throw new Error('admin-not-configured');
  return db.collection('users').doc(uid).collection('security').doc('wealthVault');
}

interface VaultDoc {
  enrolled?: boolean;
  secretEnc?: string | null;
  pendingSecretEnc?: string | null;
  recoveryHashes?: string[];
}

/** Verify the caller's Firebase ID token. Returns null when the token is
 *  missing/invalid or the Admin SDK isn't configured. */
export async function verifyBearer(req: Request): Promise<{ uid: string; email: string | null } | null> {
  const auth = getAdminAuth();
  if (!auth) return null;
  const authz = req.headers.get('authorization') || '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return null;
  try {
    const d = await auth.verifyIdToken(token);
    return { uid: d.uid, email: (d.email as string) ?? null };
  } catch {
    return null;
  }
}

export interface VaultStatus { cryptoConfigured: boolean; enrolled: boolean }

export async function getVaultStatus(uid: string): Promise<VaultStatus> {
  if (!isVaultCryptoConfigured() || !getAdminFirestore()) {
    return { cryptoConfigured: false, enrolled: false };
  }
  const snap = await vaultRef(uid).get();
  return { cryptoConfigured: true, enrolled: !!(snap.data() as VaultDoc | undefined)?.enrolled };
}

function genRecoveryCodes(n = 8): string[] {
  const codes: string[] = [];
  for (let i = 0; i < n; i++) {
    const b = randomBytes(5).toString('hex').toUpperCase(); // 10 hex chars
    codes.push(`${b.slice(0, 5)}-${b.slice(5, 10)}`);
  }
  return codes;
}

/** Normalise any user-entered code to its canonical alphanumeric form
 *  before hashing/matching (strips spaces + dashes, upper-cases). */
function normalise(code: string): string {
  return (code || '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}
const hashCode = (code: string) => createHash('sha256').update(normalise(code)).digest('hex');

export interface EnrollResult {
  qrDataUrl: string;
  secret: string;        // base32, for manual entry
  recoveryCodes: string[]; // plaintext — shown to the user exactly once
}

/** Begin enrollment: mint a fresh secret + recovery codes, store them in a
 *  PENDING state (encrypted), and return the QR + manual key + codes. */
export async function startEnrollment(uid: string, email: string | null): Promise<EnrollResult> {
  if (!isVaultCryptoConfigured()) throw new Error('vault-crypto-not-configured');
  const base32 = new Secret({ size: 20 }).base32;
  const totp = makeTotp(base32, email || 'member');
  const qrDataUrl = await QRCode.toDataURL(totp.toString(), { margin: 1, width: 220 });
  const recoveryCodes = genRecoveryCodes();
  await vaultRef(uid).set({
    enrolled: false,
    pendingSecretEnc: encryptSecret(base32),
    recoveryHashes: recoveryCodes.map(hashCode),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return { qrDataUrl, secret: base32, recoveryCodes };
}

/** Confirm enrollment: the user proves they scanned the secret by entering a
 *  current code. On success the pending secret becomes active. */
export async function confirmEnrollment(uid: string, token: string): Promise<boolean> {
  const d = (await vaultRef(uid).get()).data() as VaultDoc | undefined;
  if (!d?.pendingSecretEnc) return false;
  const base32 = decryptSecret(d.pendingSecretEnc);
  if (!base32) return false;
  if (makeTotp(base32).validate({ token: normalise(token), window: 1 }) === null) return false;
  await vaultRef(uid).set({
    enrolled: true,
    secretEnc: d.pendingSecretEnc,
    pendingSecretEnc: null,
    enrolledAt: Timestamp.now(),
    lastUnlockAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  }, { merge: true });
  return true;
}

/** Verify an unlock attempt — a 6-digit TOTP, or a one-time recovery code
 *  (which is then consumed). This is also the step-up primitive future
 *  sensitive actions (bank-account reveal) will call. */
export async function verifyUnlock(uid: string, code: string): Promise<boolean> {
  const d = (await vaultRef(uid).get()).data() as VaultDoc | undefined;
  if (!d?.enrolled || !d.secretEnc) return false;
  const base32 = decryptSecret(d.secretEnc);
  if (!base32) return false;

  const tok = normalise(code);
  // TOTP path — exactly 6 digits.
  if (/^\d{6}$/.test(tok) && makeTotp(base32).validate({ token: tok, window: 1 }) !== null) {
    await vaultRef(uid).set({ lastUnlockAt: Timestamp.now() }, { merge: true });
    return true;
  }
  // Recovery-code path — consume the matched code.
  const hashes = d.recoveryHashes || [];
  const h = hashCode(code);
  if (hashes.includes(h)) {
    await vaultRef(uid).set({
      recoveryHashes: hashes.filter((x) => x !== h),
      lastUnlockAt: Timestamp.now(),
    }, { merge: true });
    return true;
  }
  return false;
}
