// Server-only helpers for /api/sparks/*. Centralises Bearer-token
// verification, operator gating, anonymity sanitization, and the
// avatar-key derivation so individual routes stay thin.
//
// NEVER import this from a client component — it pulls in the
// firebase-admin SDK.

import type { NextRequest } from 'next/server';
import type { Firestore } from 'firebase-admin/firestore';
import { getAdminAuth, getAdminFirestore } from './firebaseAdmin';
import type {
  Spark, SparkComment, SparkStatus, SparkCategory, SparkTargetWindow,
  SparksSettings,
} from './sparks';
import { DEFAULT_SPARKS_SETTINGS } from './sparks';

// ── Auth context resolved for every request ────────────────────────────

export interface AuthContext {
  uid: string;
  email: string | null;
  familyId: string | null;
  role: 'parent' | 'helper' | 'kid' | 'guest' | null;
  familyDisplayName: string | null;
  childId: string | null;
  isOperator: boolean;
}

/** Verifies the Authorization Bearer token, looks up the user profile +
 *  family, and reports whether they're a Kaya operator. Returns null
 *  on any failure (missing header, bad token, no profile). */
export async function resolveAuth(req: NextRequest): Promise<{ ctx: AuthContext; db: Firestore } | { error: string; status: number }> {
  const db = getAdminFirestore();
  const auth = getAdminAuth();
  if (!db || !auth) return { error: 'admin-not-configured', status: 503 };

  const authz = req.headers.get('authorization') ?? '';
  const token = authz.startsWith('Bearer ') ? authz.slice(7) : '';
  if (!token) return { error: 'unauthenticated', status: 401 };

  let uid: string;
  let email: string | null = null;
  try {
    const decoded = await auth.verifyIdToken(token);
    uid = decoded.uid;
    email = decoded.email ?? null;
  } catch {
    return { error: 'invalid-token', status: 401 };
  }

  const userSnap = await db.collection('users').doc(uid).get();
  const user = userSnap.exists ? (userSnap.data() as { familyId?: string; role?: AuthContext['role']; childId?: string | null }) : null;

  let familyDisplayName: string | null = null;
  if (user?.familyId) {
    const famSnap = await db.collection('families').doc(user.familyId).get();
    const fam = famSnap.exists ? (famSnap.data() as { name?: string; handle?: string }) : null;
    if (fam) familyDisplayName = fam.handle ? `${fam.name} (@${fam.handle})` : fam.name ?? null;
  }

  let isOperator = false;
  if (email) {
    const opSnap = await db.collection('operators').doc(email.toLowerCase()).get();
    isOperator = opSnap.exists;
  }

  return {
    db,
    ctx: {
      uid,
      email,
      familyId: user?.familyId ?? null,
      role: user?.role ?? null,
      familyDisplayName,
      childId: user?.childId ?? null,
      isOperator,
    },
  };
}

// ── Avatar key (anon-safe) ─────────────────────────────────────────────
//
// For non-anonymous posts we pick a stable colour key from a 6-slot
// palette using a tiny hash of the familyId — same family always gets
// the same avatar colour. For anonymous posts we return 'anon' which
// the UI renders as the masked purple→sky gradient.

const AVATAR_SLOTS = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] as const;
export function avatarKeyFor(familyId: string, anonymous: boolean): string {
  if (anonymous) return 'anon';
  let hash = 0;
  for (let i = 0; i < familyId.length; i += 1) hash = (hash * 31 + familyId.charCodeAt(i)) >>> 0;
  return AVATAR_SLOTS[hash % AVATAR_SLOTS.length];
}

/** Returns the avatar initials for a display name — first letter of the
 *  first two words, uppercased. "The Mwangi Family" → "TM". Used by
 *  the IdeaCard avatar circle. */
export function avatarInitials(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// ── Sanitization ───────────────────────────────────────────────────────
//
// Raw Firestore doc shape (what the Admin SDK reads). Real names live
// here; UI never sees them unless the caller is an operator.

export interface RawSpark {
  title: string;
  body: string;
  category: SparkCategory;
  status: SparkStatus;
  comingSoonTargetWindow: SparkTargetWindow;
  upvoteCount: number;
  commentCount: number;
  authorUid: string;
  authorFamilyId: string;
  authorRealName: string;
  postedAnonymously: boolean;
  createdAt: FirebaseFirestore.Timestamp;
  updatedAt: FirebaseFirestore.Timestamp;
  shippedAt: FirebaseFirestore.Timestamp | null;
  rewardedHoneyCoins: number | null;
}

export interface RawComment {
  body: string;
  authorUid: string;
  authorFamilyId: string;
  authorRealName: string;
  postedAnonymously: boolean;
  createdAt: FirebaseFirestore.Timestamp;
}

function tsToMs(t: FirebaseFirestore.Timestamp | null | undefined): number {
  if (!t) return 0;
  // Both Admin SDK Timestamp and missing/null tolerated.
  // toMillis() exists on the Admin SDK Timestamp.
  return typeof (t as any).toMillis === 'function' ? (t as any).toMillis() : 0;
}

/** Returns the public-shape Spark. When the caller is an operator we
 *  attach the real-name fields for moderation UI. */
export function sanitizeSpark(id: string, raw: RawSpark, ctx: AuthContext, iVoted: boolean): Spark {
  const isAnon = raw.postedAnonymously === true;
  const showReal = !isAnon || ctx.isOperator;
  const displayName = showReal ? raw.authorRealName : 'A Kaya family';
  const avatarKey = avatarKeyFor(raw.authorFamilyId, isAnon && !ctx.isOperator);
  const out: Spark = {
    id,
    title: raw.title,
    body: raw.body,
    category: raw.category,
    status: raw.status,
    comingSoonTargetWindow: raw.comingSoonTargetWindow ?? null,
    upvoteCount: raw.upvoteCount ?? 0,
    commentCount: raw.commentCount ?? 0,
    authorDisplayName: displayName,
    authorAvatarKey: avatarKey,
    postedAnonymously: isAnon,
    authorIsMe: raw.authorUid === ctx.uid,
    iVoted,
    createdAt: tsToMs(raw.createdAt),
    updatedAt: tsToMs(raw.updatedAt),
    shippedAt: raw.shippedAt ? tsToMs(raw.shippedAt) : null,
    rewardedHoneyCoins: raw.rewardedHoneyCoins ?? null,
  };
  if (ctx.isOperator) {
    out.authorRealName = raw.authorRealName;
    out.authorFamilyId = raw.authorFamilyId;
    out.authorUid = raw.authorUid;
  }
  return out;
}

export function sanitizeComment(id: string, raw: RawComment, ctx: AuthContext): SparkComment {
  const isAnon = raw.postedAnonymously === true;
  const showReal = !isAnon || ctx.isOperator;
  const out: SparkComment = {
    id,
    body: raw.body,
    authorDisplayName: showReal ? raw.authorRealName : 'A Kaya family',
    authorAvatarKey: avatarKeyFor(raw.authorFamilyId, isAnon && !ctx.isOperator),
    postedAnonymously: isAnon,
    authorIsMe: raw.authorUid === ctx.uid,
    createdAt: tsToMs(raw.createdAt),
  };
  if (ctx.isOperator) {
    out.authorRealName = raw.authorRealName;
    out.authorFamilyId = raw.authorFamilyId;
  }
  return out;
}

// ── Sparks settings (singleton doc) ────────────────────────────────────

const SETTINGS_PATH = ['config', 'sparks'] as const;

export async function loadSparksSettings(db: Firestore): Promise<SparksSettings> {
  const snap = await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).get();
  if (!snap.exists) return { ...DEFAULT_SPARKS_SETTINGS };
  const raw = snap.data() as Partial<SparksSettings>;
  return { ...DEFAULT_SPARKS_SETTINGS, ...raw };
}

export async function saveSparksSettings(db: Firestore, patch: Partial<SparksSettings>): Promise<SparksSettings> {
  const current = await loadSparksSettings(db);
  const next: SparksSettings = { ...current, ...patch };
  await db.collection(SETTINGS_PATH[0]).doc(SETTINGS_PATH[1]).set(next, { merge: true });
  return next;
}

// ── Validation helpers ────────────────────────────────────────────────

export const VALID_CATEGORIES = new Set<SparkCategory>(['idea', 'bug', 'help', 'story']);
export const VALID_STATUSES = new Set<SparkStatus>(['new', 'review', 'soon', 'building', 'live', 'reward']);
export const VALID_TARGET_WINDOWS: SparkTargetWindow[] = ['Q3 2026', 'Q4 2026', 'Q1 2027', 'No date yet', null];

export function trimToLen(s: string, max: number): string {
  return s.trim().slice(0, max);
}
