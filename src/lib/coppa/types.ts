// Kaya · COPPA + Login — shared Firestore document types.
//
// Read-side shapes (client). Timestamps mirror the existing firestore.ts
// convention (firebase/firestore Timestamp). Server writes use plain Date
// (the Admin SDK serialises Date → Timestamp), matching the other API routes.

import type { Timestamp } from 'firebase/firestore';

// Which consent surface produced an acceptance record.
export type PolicyAcceptanceType = 'signup' | 'login_clickwrap' | 'accept_gate';

// Append-only audit record at users/{uid}/policyAcceptances/{id}. Written
// ONLY server-side (Admin SDK); never updated or deleted — the immutable
// consent trail. `policyVersion` pins the ACTIVE_POLICY_VERSION in force at
// the moment of the tap.
export interface PolicyAcceptance {
  id: string;
  type: PolicyAcceptanceType;
  policyVersion: string;
  acceptedAt: Timestamp;
  surface?: string;        // route the tap happened on, e.g. '/login'
  userAgentHash?: string;  // sha256(user-agent) — never the raw UA
  ipHash?: string;         // sha256(ip) — never the raw IP
}

// families/{familyId}/childCodes/{codeId} — the redeemable code (HASH ONLY).
export type ChildCodeStatus = 'active' | 'paused' | 'revoked';
export interface ChildCode {
  id: string;
  childId: string;
  codeHash: string;                 // bcrypt hash — plaintext is NEVER stored
  codePreviewExpiresAt: Timestamp;  // ~60s window the plaintext was viewable
  status: ChildCodeStatus;
  createdAt: Timestamp;
  createdBy: string;                // parent uid
  pausedAt?: Timestamp;
  revokedAt?: Timestamp;
}

// families/{familyId}/children/{childId}/coppaConsents/{consentId} — the
// verifiable-parental-consent record (16 C.F.R. § 312.5(b)).
export interface CoppaConsent {
  id: string;
  parentUserId: string;
  policyVersionId: string;
  acceptedAt: Timestamp;
  verificationMethod: 'password_reauth';
  verificationAt: Timestamp;
  childFirstName: string;
  childDateOfBirth: string;         // YYYY-MM-DD
  ipHash?: string;
  userAgentHash?: string;
}

// childSessions/{sessionId} — minimal kid-login session record, subject to
// 30-day rolling deletion (Max-Privacy Mode).
export interface ChildSession {
  id: string;
  childId: string;
  familyId: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}
