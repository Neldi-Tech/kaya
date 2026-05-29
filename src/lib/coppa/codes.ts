// Kaya · COPPA + Login — Kaya Code engine (server-only, Admin SDK).
//
// A Kaya Code is the kid-safe credential a parent issues so a child can sign
// in WITHOUT an email or password. It is a shared secret, so it is treated
// like one:
//
//   • The plaintext is NEVER stored. We persist a bcrypt hash (`codeHash`,
//     per spec — slow + salted, so a DB leak can't be brute-forced cheaply)
//     plus a deterministic, peppered SHA-256 `codeLookup` (so a submitted
//     code maps to exactly one doc in O(1) without storing the plaintext).
//   • Plaintext exists only in the HTTP response to the parent + their React
//     state for ~60s. After that the only way to see a code again is to
//     regenerate it.
//
// Every read/write here runs through the Admin SDK inside API routes, so the
// `childCodes` collection can stay fully locked to clients in Firestore rules.
//
// Stored top-level (`childCodes/{id}`, not under a family) so kid redemption —
// which happens before the child is signed in to any family — is a single
// lookup with no family context.

import { randomInt, createHash } from 'crypto';
import bcrypt from 'bcryptjs';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import {
  KAYA_CODE_PREFIX,
  KAYA_CODE_BODY_LEN,
  KAYA_CODE_ALPHABET,
  KAYA_CODE_PREVIEW_TTL_MS,
} from './constants';
import type { ChildCodeStatus } from './types';

const BCRYPT_ROUNDS = 10;
const CODES = 'childCodes';

// ── Code string ────────────────────────────────────────────────────────────

/** A fresh code, e.g. "KAYA-7M2PQR9K". Body chars are drawn unbiased from an
 *  unambiguous alphabet (no 0/O/1/I/L) via crypto.randomInt. */
export function generateCodeString(): string {
  let body = '';
  for (let i = 0; i < KAYA_CODE_BODY_LEN; i++) {
    body += KAYA_CODE_ALPHABET[randomInt(KAYA_CODE_ALPHABET.length)];
  }
  return `${KAYA_CODE_PREFIX}-${body}`;
}

/** Normalise whatever a kid types into the canonical "KAYA-XXXXXXXX" form:
 *  uppercase, strip spaces/dashes, re-add the prefix. Lets a child type just
 *  the body, or the whole code, or with stray spaces — all resolve the same. */
export function normalizeCode(raw: string): string {
  const cleaned = (raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const prefix = KAYA_CODE_PREFIX.toUpperCase();
  const body = cleaned.startsWith(prefix) ? cleaned.slice(prefix.length) : cleaned;
  return `${prefix}-${body}`;
}

// ── Hashing ──────────────────────────────────────────────────────────────────

/** bcrypt hash — the credential of record (slow + salted). */
export function hashCode(code: string): string {
  return bcrypt.hashSync(code, BCRYPT_ROUNDS);
}

/** Deterministic peppered lookup so a submitted code resolves to one doc.
 *  Pepper is a server secret (env KAYA_CODE_PEPPER); without it we still hash,
 *  just without the extra rainbow-table resistance. Generate + redeem run in
 *  the same deployment, so they always share the same pepper. */
export function lookupHash(code: string): string {
  const pepper = process.env.KAYA_CODE_PEPPER || '';
  return createHash('sha256').update(`${pepper}:${code}`).digest('hex');
}

// ── Firestore: issue / find / manage ─────────────────────────────────────────

export interface IssuedCode {
  code: string;            // plaintext — caller returns it ONCE, never persists it
  expiresAt: Date;         // when the plaintext preview should stop being shown
}

/** Issue a fresh active code for a child, retiring any prior active one
 *  (a child has at most one active code). Returns the plaintext + preview
 *  expiry. Throws only if the Admin SDK is unconfigured. */
export async function issueChildCode(opts: {
  childId: string;
  familyId: string;
  createdBy: string;
}): Promise<IssuedCode> {
  const db = getAdminFirestore();
  if (!db) throw new Error('admin-sdk-not-configured');

  // Retire any existing active code(s) for this child first.
  const prior = await db
    .collection(CODES)
    .where('childId', '==', opts.childId)
    .where('status', '==', 'active')
    .get();
  const batch = db.batch();
  prior.forEach((doc) => batch.update(doc.ref, { status: 'revoked', revokedAt: new Date() }));

  const code = generateCodeString();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + KAYA_CODE_PREVIEW_TTL_MS);
  const ref = db.collection(CODES).doc();
  batch.set(ref, {
    childId: opts.childId,
    familyId: opts.familyId,
    codeHash: hashCode(code),
    codeLookup: lookupHash(code),
    status: 'active' as ChildCodeStatus,
    createdAt: now,
    createdBy: opts.createdBy,
    codePreviewExpiresAt: expiresAt,
  });
  await batch.commit();
  return { code, expiresAt };
}

export interface ActiveCodeMatch {
  id: string;
  childId: string;
  familyId: string;
}

/** Resolve a plaintext code a kid typed to its active code doc, or null.
 *  Narrows by the deterministic lookup hash, then confirms with bcrypt —
 *  so a lookup collision can never authenticate the wrong child. */
export async function findActiveCodeByPlaintext(rawCode: string): Promise<ActiveCodeMatch | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  const code = normalizeCode(rawCode);
  const snap = await db
    .collection(CODES)
    .where('codeLookup', '==', lookupHash(code))
    .limit(5)
    .get();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (data.status !== 'active') continue;
    if (!bcrypt.compareSync(code, data.codeHash as string)) continue;
    return { id: doc.id, childId: data.childId as string, familyId: data.familyId as string };
  }
  return null;
}

/** Pause / resume / revoke the child's current code. Resume re-activates the
 *  most recently created non-revoked code; revoke/pause hit the active one.
 *  Returns the resulting status, or null if there's no code to act on. */
export async function setChildCodeStatus(
  childId: string,
  action: 'pause' | 'resume' | 'revoke',
): Promise<ChildCodeStatus | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  const wantFrom = action === 'resume' ? 'paused' : 'active';
  const snap = await db
    .collection(CODES)
    .where('childId', '==', childId)
    .where('status', '==', wantFrom)
    .limit(1)
    .get();
  if (snap.empty) return null;
  const ref = snap.docs[0].ref;
  const next: ChildCodeStatus = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'revoked';
  const stamp =
    action === 'pause' ? { pausedAt: new Date() } : action === 'revoke' ? { revokedAt: new Date() } : { pausedAt: null };
  await ref.update({ status: next, ...stamp });
  return next;
}

/** Current status of a child's code for the management screen — never returns
 *  plaintext (we don't have it). `none` = never issued / fully revoked. */
export async function getChildCodeStatus(childId: string): Promise<{
  status: ChildCodeStatus | 'none';
  createdAt: Date | null;
}> {
  const db = getAdminFirestore();
  if (!db) return { status: 'none', createdAt: null };
  const snap = await db
    .collection(CODES)
    .where('childId', '==', childId)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  if (snap.empty) return { status: 'none', createdAt: null };
  const data = snap.docs[0].data();
  const status = (data.status as ChildCodeStatus) || 'none';
  const createdAt = data.createdAt?.toDate?.() ?? null;
  return { status: status === 'revoked' ? 'none' : status, createdAt };
}
