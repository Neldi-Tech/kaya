// Closed-beta access control (2026-05-24) — the invite-only launch gate.
//
// Client helpers for the runtime switches (config/beta), the early-access
// email allowlist, the operator (Kaya staff) list, and the interest
// waitlist. These back the beta login screen, the onboarding guard, and
// the /admin console. Top-level Firestore collections are gated by
// firestore.rules (operator-only writes; allowlist/operator self-reads).
//
// Cross-family aggregates (Kaya World headcount, "joined" status) are NOT
// here — per-family rules block an operator from reading other families'
// docs, so those come from an operator-verified Admin-SDK route instead.
//
// Designed to be lifted out cleanly when public sign-up opens at launch.

import {
  collection, doc, getDoc, getDocs, setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from './firebase';

// ── Types ──────────────────────────────────────────────────────────
export interface BetaConfig {
  /** When true, anyone can sign up + create a family (launch mode). */
  publicSignupOpen: boolean;
  /** When true, registering interest auto-adds the email to the allowlist. */
  autoAdmit: boolean;
}

export interface AllowlistEntry {
  email: string;
  addedAt?: number;
  addedBy?: string;
  /** Set by the auto-admit path so the UI can distinguish hand-picked. */
  auto?: boolean;
}

export type OperatorRole = 'owner' | 'operator';

export interface OperatorEntry {
  email: string;
  role: OperatorRole;
  addedAt?: number;
  addedBy?: string;
}

export interface WaitlistEntry {
  email: string;
  name: string;
  country?: string;
  createdAt?: number;
}

const DEFAULT_BETA_CONFIG: BetaConfig = { publicSignupOpen: false, autoAdmit: false };

/** Canonical doc-id form for an email — lowercased + trimmed. The rules
 *  compare `request.auth.token.email` to the doc id, so allowlist /
 *  operator entries must be stored in this same normalized form. */
export function emailKey(email: string): string {
  return email.trim().toLowerCase();
}

/** Firestore Timestamp | millis | undefined → millis | undefined. */
function toMillis(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === 'number') return v;
  if (typeof (v as { toMillis?: () => number }).toMillis === 'function') {
    return (v as { toMillis: () => number }).toMillis();
  }
  return undefined;
}

// ── Runtime switches (config/beta) ─────────────────────────────────
/** The two switches. World-readable; a missing doc means closed beta. */
export async function getBetaConfig(): Promise<BetaConfig> {
  try {
    const snap = await getDoc(doc(db, 'config', 'beta'));
    if (!snap.exists()) return { ...DEFAULT_BETA_CONFIG };
    const d = snap.data() as Partial<BetaConfig>;
    return {
      publicSignupOpen: d.publicSignupOpen === true,
      autoAdmit: d.autoAdmit === true,
    };
  } catch {
    // Fail shut: if we can't read the gate, assume closed.
    return { ...DEFAULT_BETA_CONFIG };
  }
}

/** Operator-only (rules enforce). Flip one switch. */
export async function setBetaFlag(flag: keyof BetaConfig, value: boolean): Promise<void> {
  await setDoc(
    doc(db, 'config', 'beta'),
    { [flag]: value, updatedAt: serverTimestamp() },
    { merge: true },
  );
}

// ── Allowlist ──────────────────────────────────────────────────────
/** Whether this email may create a family (early access). Readable by
 *  the email's owner (onboarding self-check) or any operator. */
export async function isEmailAllowlisted(email: string | null | undefined): Promise<boolean> {
  if (!email) return false;
  try {
    const snap = await getDoc(doc(db, 'allowlist', emailKey(email)));
    return snap.exists();
  } catch {
    return false;
  }
}

/** Operator-only list. Sorted newest-first client-side so docs missing
 *  `addedAt` (e.g. seeds) are never dropped by an orderBy. */
export async function listAllowlist(): Promise<AllowlistEntry[]> {
  const snap = await getDocs(collection(db, 'allowlist'));
  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<AllowlistEntry> & { addedAt?: unknown };
      return {
        email: data.email ?? d.id,
        addedAt: toMillis(data.addedAt),
        addedBy: data.addedBy,
        auto: data.auto === true,
      };
    })
    .sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
}

export async function addAllowlistEmail(email: string, addedBy?: string): Promise<void> {
  const key = emailKey(email);
  await setDoc(
    doc(db, 'allowlist', key),
    { email: key, addedAt: serverTimestamp(), addedBy: addedBy ?? null },
    { merge: true },
  );
}

export async function removeAllowlistEmail(email: string): Promise<void> {
  await deleteDoc(doc(db, 'allowlist', emailKey(email)));
}

// ── Operators (Kaya staff) ─────────────────────────────────────────
/** Whether the signed-in email can open /admin. Self-readable so the UI
 *  can decide whether to show the operator nav entry. */
export async function getOperatorRole(email: string | null | undefined): Promise<OperatorRole | null> {
  if (!email) return null;
  try {
    const snap = await getDoc(doc(db, 'operators', emailKey(email)));
    if (!snap.exists()) return null;
    return ((snap.data() as { role?: OperatorRole }).role) ?? 'operator';
  } catch {
    return null;
  }
}

export async function listOperators(): Promise<OperatorEntry[]> {
  const snap = await getDocs(collection(db, 'operators'));
  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<OperatorEntry> & { addedAt?: unknown };
      return {
        email: data.email ?? d.id,
        role: (data.role as OperatorRole) ?? 'operator',
        addedAt: toMillis(data.addedAt),
        addedBy: data.addedBy,
      };
    })
    // Owner first, then newest-added.
    .sort((a, b) => {
      if (a.role === 'owner' && b.role !== 'owner') return -1;
      if (b.role === 'owner' && a.role !== 'owner') return 1;
      return (b.addedAt ?? 0) - (a.addedAt ?? 0);
    });
}

export async function addOperator(email: string, addedBy?: string): Promise<void> {
  const key = emailKey(email);
  await setDoc(
    doc(db, 'operators', key),
    { email: key, role: 'operator', addedAt: serverTimestamp(), addedBy: addedBy ?? null },
    { merge: true },
  );
}

/** Remove an operator. The owner can't be removed (rules also enforce). */
export async function removeOperator(email: string): Promise<void> {
  await deleteDoc(doc(db, 'operators', emailKey(email)));
}

// ── Waitlist ───────────────────────────────────────────────────────
/** Operator-only list, newest-first. */
export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const snap = await getDocs(collection(db, 'waitlist'));
  return snap.docs
    .map((d) => {
      const data = d.data() as Partial<WaitlistEntry> & { createdAt?: unknown };
      return {
        email: data.email ?? d.id,
        name: data.name ?? '',
        country: data.country,
        createdAt: toMillis(data.createdAt),
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

// ── Cross-family stats (operator-only, via Admin SDK) ──────────────
export interface AdminStats {
  funnel: { active: number; invited: number; waitlist: number; operators: number; allowlist: number };
  world: { total: number; parents: number; kids: number; helpers: number; guests: number; families: number };
}

/** Pulls the operator console's headline numbers from the server. Per-
 *  family rules block an operator from reading other families' docs
 *  client-side, so the counts come from an Admin-SDK route that verifies
 *  the caller's ID token is an operator. */
export async function getAdminStats(): Promise<AdminStats | null> {
  try {
    const token = await auth.currentUser?.getIdToken();
    if (!token) return null;
    const res = await fetch('/api/admin/stats', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return (await res.json()) as AdminStats;
  } catch {
    return null;
  }
}

/** Public interest registration. Routed through the server (Admin SDK)
 *  so unauthenticated visitors never write Firestore directly, and the
 *  auto-admit path can add the allowlist entry atomically. */
export async function joinWaitlist(
  input: { name: string; email: string; country?: string },
): Promise<{ ok: boolean; autoAdmitted?: boolean; error?: string }> {
  try {
    const res = await fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; autoAdmitted?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? 'request-failed' };
    return { ok: true, autoAdmitted: data.autoAdmitted };
  } catch {
    return { ok: false, error: 'network-error' };
  }
}
