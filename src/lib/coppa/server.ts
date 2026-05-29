// Kaya · COPPA + Login — server-side audit helpers (Admin SDK).
//
// These run ONLY inside API routes / cron — never bundled to the client — so
// they bypass Firestore rules and own the immutability guarantee: the
// acceptance trail is append-only, and the client can never write, edit, or
// delete a record directly. All COPPA writes funnel through helpers like
// these so the legal audit can't be tampered with from the browser.

import { createHash } from 'crypto';
import { getAdminFirestore } from '@/lib/firebaseAdmin';
import { ACTIVE_POLICY_VERSION } from './constants';
import type { PolicyAcceptanceType } from './types';

// One-way hash so the audit can prove "this acceptance came from this
// device / IP" without ever storing PII (UA / IP) in the clear.
export function hashValue(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  return createHash('sha256').update(value).digest('hex');
}

interface RecordAcceptanceOpts {
  uid: string;
  type: PolicyAcceptanceType;
  surface?: string;
  policyVersion?: string;
  userAgent?: string | null;
  ip?: string | null;
}

// Append an immutable acceptance record. Returns false (never throws) if the
// Admin SDK isn't configured or the write fails, so a logging hiccup can
// NEVER block the user's auth — the legal acceptance is their deliberate tap;
// this is the durable record of it.
export async function recordPolicyAcceptance(opts: RecordAcceptanceOpts): Promise<boolean> {
  const db = getAdminFirestore();
  if (!db) return false;
  const version = opts.policyVersion || ACTIVE_POLICY_VERSION;
  try {
    await db
      .collection('users').doc(opts.uid)
      .collection('policyAcceptances')
      .add({
        type: opts.type,
        policyVersion: version,
        acceptedAt: new Date(),
        ...(opts.surface ? { surface: opts.surface } : {}),
        ...(opts.userAgent ? { userAgentHash: hashValue(opts.userAgent) } : {}),
        ...(opts.ip ? { ipHash: hashValue(opts.ip) } : {}),
      });
    // Mirror the accepted version onto the user doc so the client can drive
    // the /accept gate from the profile it already loads (no extra read). The
    // append above is the record of truth — this is a best-effort convenience,
    // so its own failure must NOT flip our success.
    try {
      await db
        .collection('users').doc(opts.uid)
        .set({ acceptedPolicyVersion: version, acceptedPolicyAt: new Date() }, { merge: true });
    } catch {
      /* mirror is advisory; the immutable acceptance above already landed */
    }
    return true;
  } catch {
    return false;
  }
}

// The most recently accepted policy version for a user (any acceptance type),
// or null if they've never accepted. Single-field orderBy — uses Firestore's
// automatic index, no composite index required.
export async function getLatestAcceptedVersion(uid: string): Promise<string | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  try {
    const snap = await db
      .collection('users').doc(uid)
      .collection('policyAcceptances')
      .orderBy('acceptedAt', 'desc').limit(1).get();
    if (snap.empty) return null;
    return (snap.docs[0].data().policyVersion as string) || null;
  } catch {
    return null;
  }
}

// True when the user must (re)accept — they've never accepted, or accepted an
// OLDER version than the one now in force (a material policy change). The
// /accept gate uses this to decide whether to interrupt app entry.
export async function needsFreshAcceptance(uid: string): Promise<boolean> {
  const latest = await getLatestAcceptedVersion(uid);
  return latest !== ACTIVE_POLICY_VERSION;
}

// ── COPPA consent + parent verification (Admin SDK) ──────────────────────────

// Minimal server-side read of a caller's profile so consent routes can confirm
// "this token belongs to a PARENT of THIS family" before issuing a kid code.
// Reads users/{uid} directly with the Admin SDK (bypasses rules).
export async function getServerUserProfile(
  uid: string,
): Promise<{ role?: string; familyId?: string; name?: string } | null> {
  const db = getAdminFirestore();
  if (!db) return null;
  try {
    const snap = await db.collection('users').doc(uid).get();
    if (!snap.exists) return null;
    const d = snap.data() || {};
    return { role: d.role, familyId: d.familyId, name: d.name };
  } catch {
    return null;
  }
}

interface RecordConsentOpts {
  familyId: string;
  childId: string;
  parentUserId: string;
  childFirstName: string;
  childDateOfBirth: string; // YYYY-MM-DD
  verificationAt: Date;     // when the parent re-authenticated (token auth_time)
  userAgent?: string | null;
  ip?: string | null;
}

// Append the verifiable-parental-consent record (16 C.F.R. § 312.5(b)) under
// the child. Immutable + Admin-SDK-only, like the acceptance trail. The
// verification method is always password/credential re-auth — the parent
// proving presence at the moment of consent.
export async function recordCoppaConsent(opts: RecordConsentOpts): Promise<boolean> {
  const db = getAdminFirestore();
  if (!db) return false;
  try {
    await db
      .collection('families').doc(opts.familyId)
      .collection('children').doc(opts.childId)
      .collection('coppaConsents')
      .add({
        parentUserId: opts.parentUserId,
        policyVersionId: ACTIVE_POLICY_VERSION,
        acceptedAt: new Date(),
        verificationMethod: 'password_reauth',
        verificationAt: opts.verificationAt,
        childFirstName: opts.childFirstName,
        childDateOfBirth: opts.childDateOfBirth,
        ...(opts.userAgent ? { userAgentHash: hashValue(opts.userAgent) } : {}),
        ...(opts.ip ? { ipHash: hashValue(opts.ip) } : {}),
      });
    return true;
  } catch {
    return false;
  }
}

// Server-side proof of a *fresh* re-auth: the verified ID token's auth_time
// must be within the window. This is what makes password re-auth a real COPPA
// verification gate — an old, ambiently-authenticated session won't pass.
export const REAUTH_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
export function isFreshReauth(authTimeSeconds: number | undefined): boolean {
  if (!authTimeSeconds) return false;
  return Date.now() - authTimeSeconds * 1000 <= REAUTH_MAX_AGE_MS;
}
