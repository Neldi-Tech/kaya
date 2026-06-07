// Helper (the role) operations. Pairs with the `HelperLink` interface
// in `lib/firestore.ts`. Keeps the helper-specific logic out of the
// monster firestore.ts so we can iterate fast.
//
// Tier A auth model: parent creates a credential, helper logs in with
// (familyCode + helperCode + password). The 3 codes are composed into
// a synthetic Firebase Auth email of the form
// `h.{familyCode}.{helperCode}@helper.kaya.app` — the helper never
// sees or types it.
//
// Helper-auth-user creation uses the secondary Firebase app pattern so
// creating a helper does NOT sign the parent out of their main session.

'use client';

import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, Timestamp, serverTimestamp,
} from 'firebase/firestore';
import { initializeApp, deleteApp, getApps } from 'firebase/app';
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { db, auth } from './firebase';
import {
  type Family, type HelperLink, type UserProfile,
  createUserProfile, updateFamily, getFamily,
} from './firestore';

const HELPER_EMAIL_DOMAIN = 'helper.kaya.app';

// ── Helper session lifecycle ──────────────────────
// localStorage key that tracks when the helper most recently signed
// in. Compared against `Family.helperSessionDays` on each helper page
// load (see /helper/page.tsx) to auto-expire stale sessions. We use
// localStorage rather than a Firestore doc because (a) it works
// offline and (b) it avoids an extra read on every page load.
export const HELPER_SESSION_STARTED_AT_KEY = 'kaya.helper.sessionStartedAt';
export const DEFAULT_HELPER_SESSION_DAYS = 30;

export function markHelperSessionStart(): void {
  try { localStorage.setItem(HELPER_SESSION_STARTED_AT_KEY, String(Date.now())); }
  catch { /* private mode or quota — non-fatal */ }
}

export function clearHelperSession(): void {
  try { localStorage.removeItem(HELPER_SESSION_STARTED_AT_KEY); }
  catch { /* noop */ }
}

/** Returns true when the helper's session has outlived the family's
 *  configured `helperSessionDays`. Helpers signed in before this
 *  feature shipped have no stamp — we treat them as "fresh" so they
 *  aren't immediately bounced; the stamp gets written on their next
 *  sign-in. */
export function isHelperSessionExpired(helperSessionDays: number | undefined): boolean {
  try {
    const raw = localStorage.getItem(HELPER_SESSION_STARTED_AT_KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return false;
    const days = helperSessionDays ?? DEFAULT_HELPER_SESSION_DAYS;
    const ttlMs = Math.max(1, days) * 86_400_000;
    return Date.now() > startedAt + ttlMs;
  } catch {
    return false;
  }
}

// ── Code generators ───────────────────────────────
// 4-char alphanumeric, ambiguity-stripped (no 0/O/1/I/L) per the
// design decision. Used for both familyCode and (default) helperCode.
const SAFE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateShortCode(len = 4): string {
  let out = '';
  for (let i = 0; i < len; i++) {
    out += SAFE_ALPHABET[Math.floor(Math.random() * SAFE_ALPHABET.length)];
  }
  return out;
}

export function generatePassword(len = 6): string {
  // Same alphabet as codes — keeps the printed credentials card
  // visually consistent and avoids "is this a 0 or an O" calls. 6
  // chars from a 31-symbol alphabet ≈ 30 bits of entropy. Combined
  // with the rate-limit of Firebase Auth login attempts this is
  // strong enough for a Tier A staff credential.
  return generateShortCode(len);
}

// Normalises user input (login form, code entry). Strips spaces,
// uppercases, removes ambiguous chars the user might have typed
// thinking they were valid.
export function normalizeCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/[OIL]/g, (c) => (c === 'O' ? '0' : c === 'I' ? '1' : '1'))
    // After the ambiguous→canonical replace, the alphabet excludes
    // 0/1 too. The above replace flips them to 0/1 which then fall
    // out as invalid — but in practice users typing O/I/L are doing
    // it by mistake; safer to map them back into the alphabet:
    .replace(/0/g, 'O')
    .replace(/1/g, 'I');
}

// Synthetic email composer. The helper never sees this — the login
// form re-composes it from the 3 codes they type.
export function syntheticHelperEmail(familyCode: string, helperCode: string): string {
  const fc = familyCode.toUpperCase();
  const hc = helperCode.toUpperCase();
  return `h.${fc}.${hc}@${HELPER_EMAIL_DOMAIN}`.toLowerCase();
}

// ── Family code ───────────────────────────────────
// Lazy backfill — call before showing the parent Helpers settings.
// Idempotent. Safe to call on every page load.
export async function ensureFamilyCode(family: Family): Promise<string> {
  if (family.familyCode) return family.familyCode;
  // Generate + uniqueness check. With a 31^4 = ~923k space and an
  // expected user base in the thousands the collision rate is small
  // enough that one retry pass is plenty. Worst case we expand to 5
  // chars later — the format is opaque.
  let code = generateShortCode(4);
  for (let attempt = 0; attempt < 5; attempt++) {
    const collision = await findFamilyByCode(code);
    if (!collision) break;
    code = generateShortCode(4);
  }
  await updateFamily(family.id, { familyCode: code });
  return code;
}

export async function findFamilyByCode(familyCode: string): Promise<Family | null> {
  const norm = familyCode.toUpperCase();
  // No composite index needed — `familyCode` is a top-level field;
  // the standard single-field index Firestore auto-maintains is enough.
  const { collection: col, query: q, where, getDocs: gd } =
    await import('firebase/firestore');
  const snap = await gd(q(col(db, 'families'), where('familyCode', '==', norm)));
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Family;
}

// ── HelperLink CRUD ───────────────────────────────
export async function listHelpers(familyId: string): Promise<HelperLink[]> {
  const snap = await getDocs(collection(db, 'families', familyId, 'helpers'));
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as HelperLink));
}

export async function getHelperLink(familyId: string, uid: string): Promise<HelperLink | null> {
  const snap = await getDoc(doc(db, 'families', familyId, 'helpers', uid));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as HelperLink;
}

export async function updateHelperLink(
  familyId: string,
  uid: string,
  data: Partial<HelperLink>,
): Promise<void> {
  await updateDoc(doc(db, 'families', familyId, 'helpers', uid), data);
}

export async function removeHelper(familyId: string, uid: string): Promise<void> {
  // Soft-delete: flip status to 'removed' rather than hard-delete the
  // doc, so any prior ratings/awards keep a resolvable awardedBy chain.
  // The auth user remains — parent can choose to also rotate the
  // password to lock them out (separate action).
  await updateDoc(doc(db, 'families', familyId, 'helpers', uid), { status: 'removed' });
}

// ── Create a new helper (Tier A) ──────────────────
// Uses a secondary Firebase app instance so creating the helper auth
// user does NOT sign the parent out. The flow:
//   1. parent fills the Settings form
//   2. spin up a temp Firebase app
//   3. createUserWithEmailAndPassword on temp app → new helper UID
//   4. write UserProfile + HelperLink (rules allow parent to create
//      helper profiles in their own family — see firestore.rules)
//   5. signOut temp app + deleteApp — parent's main session untouched
export interface CreateHelperInput {
  familyId: string;
  familyCode: string;          // resolved by ensureFamilyCode beforehand
  helperCode: string;          // e.g. "JANE" — parent-pickable
  displayName: string;
  password: string;            // auto-generated, shown once to parent
  preset: HelperLink['preset'];
  kidIds: string[];
  /** Legacy: modules with full view+act. Kept on the doc for
   *  backwards-compat reads; the canonical source is `moduleAccess`. */
  modules: string[];
  /** Per-module view/act flags. Set from the preset when omitted. */
  moduleAccess?: HelperLink['moduleAccess'];
  canAward?: boolean;
  expectedFrequency?: HelperLink['expectedFrequency'];
  createdBy: string;           // parent UID
}

/** Build a default `moduleAccess` map from a preset. Returns
 *  composite keys (e.g. "kaya:rate", "household:meals") matching the
 *  HELPER_MODULES structure. Grandparent = view across the granted
 *  set; everyone else = view+act. Modules NOT in the picked set are
 *  absent from the map (no access).
 *
 *  Each preset specifies BOTH the keys to grant AND whether they're
 *  view-only. Parents can later flip any individual sub from the
 *  Settings card UI. */
export function buildModuleAccessFromPreset(
  preset: HelperLink['preset'],
  /** Composite or parent keys to grant. If omitted, falls back to a
   *  preset-specific default set (see `presetDefaultKeys` below). */
  keys?: string[],
): HelperLink['moduleAccess'] {
  const grantKeys = keys ?? presetDefaultKeys(preset);
  const viewOnly = preset === 'grandparent';
  const map: NonNullable<HelperLink['moduleAccess']> = {};
  for (const k of grantKeys) {
    map[k] = viewOnly ? { view: true, act: false } : { view: true, act: true };
  }
  return map;
}

/** Default key set per preset. These are starting points — the parent
 *  can edit any of them in Settings → Helpers after creation. EVERY
 *  preset (including custom) gets `household:payroll` — that's the
 *  helper's self-service path to request their own advances / loans /
 *  bonuses, scoped to their own UID. */
export function presetDefaultKeys(preset: HelperLink['preset']): string[] {
  const PAYROLL_SELF = 'household:payroll';
  switch (preset) {
    case 'nanny':
      // Full helper hand — Kaya (rate/award), the household, moments
      // (photos), and view-only Hive + Profiles for context.
      return [
        'kaya:rate', 'kaya:award', 'kaya:meetings',
        'household:meals', 'household:list', 'household:staples',
        'household:suppliers', 'household:directory', 'household:utilities',
        'household:budget',
        PAYROLL_SELF,
        'moments',
        'profiles',
      ];
    case 'tutor':
      // Homework + meetings, no household chores or photos.
      return ['kaya:rate', 'kaya:meetings', PAYROLL_SELF, 'profiles'];
    case 'driver':
      // Pickup/dropoff context + Directory contacts. Plus the Drivers
      // request flow — fuel, vehicle service, spare parts — so the
      // driver can request what they need at the pump or the workshop.
      return ['household:directory', 'household:drivers', PAYROLL_SELF, 'profiles'];
    case 'gardener':
      // Outdoor + grounds — household coverage but typically no kid scope.
      // Gets the Outdoor request flow by default (garden / pool / kuku /
      // pets / repairs), plus the supplier + staples context it needs.
      return ['household:outdoor', 'household:staples', 'household:suppliers', 'household:utilities', PAYROLL_SELF];
    case 'security':
      // Guard / askari — gate, perimeter, visitor log. No kid scope by
      // default. Directory for resident contacts + payroll self-service.
      return ['household:directory', PAYROLL_SELF];
    case 'cleaner':
      // Housekeeping — staples (cleaning supplies) + suppliers (re-stock
      // contacts). No kid scope. Adds moments only if a parent later
      // enables it from the access editor.
      return ['household:staples', 'household:suppliers', 'household:directory', PAYROLL_SELF];
    case 'cook':
      // Kitchen — meals plan, shopping list, staples, suppliers. No kid
      // scope by default (cook isn't a caregiver); parent can add Kaya
      // surfaces if the cook also helps the kids.
      return ['household:meals', 'household:list', 'household:staples', 'household:suppliers', PAYROLL_SELF];
    case 'handyman':
      // Repairs / maintenance — utilities for meter access + suppliers
      // for parts/contacts + outdoor for grounds work.
      return ['household:utilities', 'household:outdoor', 'household:suppliers', 'household:directory', PAYROLL_SELF];
    case 'grandparent':
      // View-only across the kid-facing surfaces.
      return [
        'kaya:rate', 'kaya:meetings',
        PAYROLL_SELF,
        'moments',
        'profiles',
      ];
    case 'custom':
    default:
      return [PAYROLL_SELF];
  }
}

export interface CreateHelperResult {
  uid: string;
  loginInstructions: {
    familyCode: string;
    helperCode: string;
    password: string;
  };
}

export async function createHelper(input: CreateHelperInput): Promise<CreateHelperResult> {
  const fc = input.familyCode.toUpperCase();
  const hc = input.helperCode.toUpperCase();
  const email = syntheticHelperEmail(fc, hc);

  // Refuse duplicates inside the same family up-front — Firebase Auth
  // will also reject duplicate emails but we want the cleaner error.
  const helpers = await listHelpers(input.familyId);
  if (helpers.some((h) => h.helperCode.toUpperCase() === hc && h.status !== 'removed')) {
    throw new Error(`A helper with code "${hc}" already exists in this family.`);
  }

  // Spin up an isolated Firebase app so the helper auth-user creation
  // does NOT touch the parent's main auth state. We re-read the same
  // config from the main app so env vars are honoured.
  const mainApp = auth.app;
  const tempName = `helper-create-${Date.now()}`;
  const tempApp = initializeApp(mainApp.options, tempName);
  const tempAuth = getAuth(tempApp);

  let uid: string;
  try {
    const cred = await createUserWithEmailAndPassword(tempAuth, email, input.password);
    uid = cred.user.uid;
  } catch (err: any) {
    // Tidy up the temp app on failure too.
    await deleteApp(tempApp).catch(() => {});
    if (err?.code === 'auth/email-already-in-use') {
      throw new Error(
        `That family code + helper code is already taken. Pick a different helper code.`,
      );
    }
    throw err;
  }

  try {
    // Write UserProfile + HelperLink. Both writes use the MAIN app's
    // db (which is authed as the parent). Rules updated to allow the
    // parent to create a helper UserProfile in their own family.
    const profile: UserProfile = {
      uid,
      email,
      displayName: input.displayName,
      role: 'helper',
      familyId: input.familyId,
      createdAt: Timestamp.now(),
    };
    await createUserProfile(profile);

    // moduleAccess is the canonical map; modules array stays in sync
    // as the legacy fallback (act-granted keys only — old readers
    // treated the array as full view+act). canLog/canAward stay
    // populated for any older readers — they don't gate anything new.
    const moduleAccess = input.moduleAccess
      ?? buildModuleAccessFromPreset(input.preset);
    const legacyModules = input.modules.length > 0
      ? input.modules
      : Object.entries(moduleAccess ?? {})
          .filter(([, f]) => f.act)
          .map(([k]) => k);
    const link: Record<string, unknown> = {
      helperCode: hc,
      displayName: input.displayName,
      preset: input.preset,
      kidIds: input.kidIds,
      modules: legacyModules,
      moduleAccess,
      canLog: true,
      canAward: input.canAward ?? (input.preset === 'nanny' || input.preset === 'grandparent'),
      attribution: 'generic',
      authTier: 'A',
      // Store the sign-in password so a parent can re-view & re-share it
      // when the helper switches devices. Read-gated to parents + the
      // helper themselves by firestore.rules.
      password: input.password,
      status: 'active',
      expectedFrequency: input.expectedFrequency
        ?? (input.preset === 'nanny' ? 'both' : 'flexible'),
      createdAt: serverTimestamp(),
      createdBy: input.createdBy,
    };
    await setDoc(doc(db, 'families', input.familyId, 'helpers', uid), link);
  } finally {
    // Always release the temp app. Errors here are non-fatal.
    await signOut(tempAuth).catch(() => {});
    await deleteApp(tempApp).catch(() => {});
  }

  return {
    uid,
    loginInstructions: { familyCode: fc, helperCode: hc, password: input.password },
  };
}

// ── Helper sign-in (Tier A) ───────────────────────
// Called from /h/login. Resolves the (familyCode, helperCode, password)
// triple into a Firebase Auth sign-in via the synthetic email format.
export async function signInHelperWithCodes(
  familyCode: string,
  helperCode: string,
  password: string,
): Promise<{ uid: string; familyId: string }> {
  const fc = familyCode.toUpperCase();
  const hc = helperCode.toUpperCase();
  const email = syntheticHelperEmail(fc, hc);
  const cred = await signInWithEmailAndPassword(auth, email, password);

  // Resolve the familyId by looking up the HelperLink. We don't trust
  // the entered familyCode blindly — we look up the family that owns
  // this code and confirm the helper's UserProfile.familyId matches.
  const family = await findFamilyByCode(fc);
  if (!family) throw new Error('Family code not recognised. Check it and try again.');
  const link = await getHelperLink(family.id, cred.user.uid);
  if (!link || link.status !== 'active') {
    throw new Error('This helper account is not active. Ask your family to re-enable it.');
  }
  // Stamp the start of this session so the family's helperSessionDays
  // cap (default 30) can force re-sign-in once expired.
  markHelperSessionStart();
  return { uid: cred.user.uid, familyId: family.id };
}

// ── Password reset (Tier A) ───────────────────────
// Sets a NEW sign-in password on the helper's EXISTING Auth user via the
// Admin SDK (server route /api/helpers/reset-password). The same UID is
// kept, so all of the helper's history — ratings, awards, payroll —
// stays intact (unlike the old "remove + re-add" dance, which minted a
// fresh UID). The new password is also written to the HelperLink doc so
// the parent can re-view & re-share it from the Sign-in details card.
//
// Used for two cases:
//   (a) helpers created before passwords were stored — gives them a
//       viewable password for the first time;
//   (b) rotating after a suspected compromise.
export async function resetHelperPassword(
  familyId: string,
  helperUid: string,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('You need to be signed in as a parent to reset a password.');
  }
  const token = await user.getIdToken();
  const res = await fetch('/api/helpers/reset-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ familyId, helperUid }),
  });
  const data = await res.json().catch(() => ({} as { password?: string; error?: string }));
  if (!res.ok) {
    throw new Error(data?.error || 'Could not reset the password. Try again.');
  }
  return data.password as string;
}
