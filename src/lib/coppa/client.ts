// Kaya · COPPA + Login — client-side callers for the server audit/code routes.
//
// Thin fetch wrappers that attach the caller's Firebase ID token. Acceptance
// logging is strictly best-effort — it must NEVER block or fail an auth flow
// (the deliberate tap IS the consent; this is the durable record of it).

import type { User } from 'firebase/auth';
import type { PolicyAcceptanceType } from './types';

/** Fire-and-forget clickwrap / gate acceptance into the immutable audit log. */
export async function recordAcceptance(
  user: User,
  type: PolicyAcceptanceType,
  surface: string,
): Promise<void> {
  try {
    const token = await user.getIdToken();
    await fetch('/api/policy/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, surface }),
    });
  } catch {
    /* best-effort — never block auth on a logging hiccup */
  }
}

export interface GenerateCodeResult {
  ok: boolean;
  code?: string;
  expiresAt?: string;
  error?: string;
}

/** Issue / regenerate a child's Kaya Code. Pass `forceFresh` after a re-auth so
 *  the token's auth_time is current (required when recordConsent is true). */
export async function generateChildCode(
  user: User,
  opts: { childId: string; childFirstName?: string; childDateOfBirth?: string; recordConsent?: boolean; forceFresh?: boolean },
): Promise<GenerateCodeResult> {
  try {
    const token = await user.getIdToken(!!opts.forceFresh);
    const res = await fetch('/api/coppa/generate-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        childId: opts.childId,
        childFirstName: opts.childFirstName,
        childDateOfBirth: opts.childDateOfBirth,
        recordConsent: opts.recordConsent,
      }),
    });
    return (await res.json()) as GenerateCodeResult;
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface CodeStatusResult {
  ok: boolean;
  status?: 'active' | 'paused' | 'revoked' | 'none';
  createdAt?: string | null;
  error?: string;
}

export async function getCodeStatus(user: User, childId: string): Promise<CodeStatusResult> {
  try {
    const token = await user.getIdToken();
    const res = await fetch(`/api/coppa/codes?childId=${encodeURIComponent(childId)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return (await res.json()) as CodeStatusResult;
  } catch {
    return { ok: false, error: 'network' };
  }
}

export interface CodeActionResult {
  ok: boolean;
  status?: 'active' | 'paused' | 'revoked';
  code?: string;          // present only for 'regenerate'
  expiresAt?: string;
  error?: string;
}

export async function codeAction(
  user: User,
  childId: string,
  action: 'pause' | 'resume' | 'revoke' | 'regenerate',
): Promise<CodeActionResult> {
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/coppa/codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ childId, action }),
    });
    return (await res.json()) as CodeActionResult;
  } catch {
    return { ok: false, error: 'network' };
  }
}
