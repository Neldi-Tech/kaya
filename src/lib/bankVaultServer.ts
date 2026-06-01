// Kaya Wealth · Bank Accounts vault — server logic (Phase 2 · PR5 · 2026-06-01).
//
// The most sensitive data in Wealth. Account numbers are AES-256-GCM
// encrypted at rest (reusing the vault key) and revealed only after a fresh
// 2FA step-up (Non-Negotiable #5/#7). Stored at users/{uid}/bankAccounts —
// owner-only READ (the encrypted blob is opaque + only the last 4 show
// masked); all writes go through these Admin-SDK routes so the raw number is
// encrypted/decrypted server-side and never touches a client unencrypted.

import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from './firebaseAdmin';
import { isVaultCryptoConfigured, encryptSecret, decryptSecret } from './wealthVaultCrypto';
import { verifyUnlock } from './wealthVaultServer';

export type BankAccountType = 'operating' | 'savings' | 'fx' | 'other';

export interface BankAccountInput {
  bankName: string;
  type: BankAccountType;
  currency: string;
  balanceCents?: number | null;
  fullNumber: string;
}

function col(uid: string) {
  const db = getAdminFirestore();
  if (!db) throw new Error('admin-not-configured');
  return db.collection('users').doc(uid).collection('bankAccounts');
}

/** Step-up: a fresh TOTP is required for every sensitive bank op. Reuses the
 *  vault's verify (a 6-digit authenticator code). When 2FA isn't configured
 *  we can neither encrypt nor step-up, so the bank vault is unavailable. */
async function stepUp(uid: string, code: string): Promise<boolean> {
  return verifyUnlock(uid, code);
}

export function bankVaultConfigured(): boolean {
  return isVaultCryptoConfigured();
}

export async function addBankAccount(
  uid: string, input: BankAccountInput, code: string,
): Promise<{ ok: boolean; error?: string; acctId?: string }> {
  if (!isVaultCryptoConfigured()) return { ok: false, error: 'vault-not-configured' };
  if (!(await stepUp(uid, code))) return { ok: false, error: 'step-up-failed' };
  const digits = (input.fullNumber || '').replace(/\s/g, '');
  if (digits.replace(/\D/g, '').length < 4) return { ok: false, error: 'bad-number' };
  const ref = col(uid).doc();
  await ref.set({
    bankName: (input.bankName || '').trim().slice(0, 60),
    type: input.type,
    currency: input.currency,
    balanceCents: typeof input.balanceCents === 'number' ? input.balanceCents : null,
    tail: digits.replace(/\D/g, '').slice(-4),
    numberEnc: encryptSecret(digits),
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
  return { ok: true, acctId: ref.id };
}

export async function revealBankAccount(
  uid: string, acctId: string, code: string,
): Promise<{ ok: boolean; error?: string; number?: string }> {
  if (!isVaultCryptoConfigured()) return { ok: false, error: 'vault-not-configured' };
  if (!(await stepUp(uid, code))) return { ok: false, error: 'step-up-failed' };
  const snap = await col(uid).doc(acctId).get();
  const enc = (snap.data() as { numberEnc?: string } | undefined)?.numberEnc;
  const number = decryptSecret(enc);
  if (!number) return { ok: false, error: 'not-found' };
  return { ok: true, number };
}

export async function deleteBankAccount(
  uid: string, acctId: string, code: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isVaultCryptoConfigured()) return { ok: false, error: 'vault-not-configured' };
  if (!(await stepUp(uid, code))) return { ok: false, error: 'step-up-failed' };
  await col(uid).doc(acctId).delete();
  return { ok: true };
}
