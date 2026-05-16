import {
  collection, collectionGroup, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, Timestamp, serverTimestamp,
  onSnapshot, writeBatch, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  isGuestActive,
  MOCK_FAMILY, MOCK_CHILDREN, MOCK_REWARDS, MOCK_RATINGS, MOCK_AWARDS,
  GUEST_FAMILY_ID,
} from './mockFamily';
import { FOUNDING_FAMILY_LIMIT, generateReferralCode } from './referral';

// ── Types ──────────────────────────────────────────
export type Role = 'parent' | 'helper' | 'kid';
export type PointsMode = 'full' | 'badges-only' | 'encouragement';
export type RatingValue = 'excellent' | 'good' | 'bad' | 'skip';
// Used for both parents and kids — same vocabulary so the avatar/Wikipedia
// hints behave consistently. 'unspecified' means "don't filter".
export type Gender = 'male' | 'female' | 'other' | 'unspecified';
// How public a parent's birthday should be.
//   public  → full DD-MMM-YYYY visible
//   partial → only month + day (no year), so age stays private
//   private → hidden everywhere
export type BirthdayPrivacy = 'public' | 'partial' | 'private';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  avatarPhoto?: string;     // user-uploaded or library avatar (data URL)
  role: Role;
  familyId: string;
  childId?: string; // if role === 'kid', which child they are
  // ── Public identity ──
  handle?: string;          // case-preserved, e.g. "Daniella"
  handleLower?: string;     // lowercase mirror for unique lookup
  gender?: Gender;
  // ── Birthday (parents) ──
  birthday?: string;                 // YYYY-MM-DD
  birthdayPrivacy?: BirthdayPrivacy; // default 'partial'
  // ── Notification preferences (default: opt-in) ──
  notifyOnRating?: boolean; // email when a routine rating is submitted
  notifyOnAward?: boolean;  // email when a bonus award is given
  createdAt: Timestamp;
}

export interface Family {
  id: string;
  name: string;
  createdBy: string;
  inviteCode: string;
  // ── Public identity ──
  handle?: string;                // case-preserved, e.g. "Timotheo"
  handleLower?: string;           // lowercase mirror — used for case-insensitive lookup
  photoUrl?: string;              // family photo (data URL or external URL)
  // ── Referral campaign ──
  referralCode?: string;          // unique code for inviting OTHER families to start their own
  referredBy?: string | null;     // familyId of the family that referred us (if any)
  referralCount?: number;         // direct successful referrals
  compoundCredit?: number;        // credit from referral-of-referral (1 level deep)
  isFoundingFamily?: boolean;     // true if among the first FOUNDING_FAMILY_LIMIT families
  spotlightOptIn?: boolean;       // opt-in flag for landing-page Champion spotlight
  // ── Family milestones ──
  anniversary?: string;           // canonical YYYY-MM-DD; UI shows DD-MMM-YYYY + day-of-week
  anniversaryName?: string;       // optional custom title (e.g. "Wedding Anniversary", "First Met"). Defaults to "Anniversary" in the UI.
  // ── Family identity policy ──
  // Whether the "Other" gender option is shown when picking a gender for a
  // kid or a parent inside this family. Defaults to **false** — many cultures
  // and faith communities consider only Female/Male appropriate, so the
  // option is opt-in. Parents can flip this in Settings.
  allowGenderOther?: boolean;
  // ── Location ──
  // Where this family lives. Optional — when set, the country code
  // drives currency auto-detection (`countryToCurrency()` in
  // `lib/hive.ts`) and downstream pricing scales to local FX rates.
  // City is free-text and used only for friendly display ("Run for
  // Dar es Salaam" in WhatsApp messages, etc.). USD is the global
  // default when no country is set.
  location?: {
    country: string;   // ISO 3166 alpha-2 (e.g., "TZ", "US", "IN")
    city?: string;     // free-text, e.g., "Dar es Salaam"
  };
  // ── Keepsake subscription plan ────────────────────────────────
  // Drives gating across Albums (album/photo caps, sub-albums,
  // custom access, AI features). Defaults to 'free' when missing —
  // see `lib/keepsakeLimits.ts` for the limit shape.
  plan?: 'free' | 'family' | 'family_pro';

  // ── Settings ──
  pointsMode: PointsMode;
  earningMethods?: string[]; // ids from EARNING_METHODS — defaults to DEFAULT_EARNING_METHODS when absent
  routines: Routine[];
  // ── The Hive ──
  // Parent-controlled rates + policy for the three-layer money module.
  // See `src/lib/hive.ts` for the canonical shape (`HiveConfig`). Persisted
  // as a partial — `readHiveConfig(family)` merges with `DEFAULT_HIVE_CONFIG`.
  hiveConfig?: {
    hpToHoneyRate?: number;
    honeyToCashRate?: number;
    currency?: string;
    minCashOut?: number;
    spendRequiresApproval?: boolean;
    cashOutRequiresApproval?: boolean;
    requireApprovalForHpToHoney?: boolean;
    spendAutoApproveBelowCents?: number;
    autoAllowance?: {
      enabled: boolean;
      kidId?: string;
      amountCents?: number;
      cadence?: 'weekly' | 'monthly';
      nextRunAt?: Timestamp;
    };
  };
  // ── External email contacts ──────────────────────────────────
  // Email-only contacts (grandparents, godparents, tutors…) who get
  // the same rating / award notifications as parents/helpers in the
  // family. They don't have Kaya accounts. Parents manage the list
  // in Settings. Per-event toggles default to true so a contact
  // added today receives both kinds of email until told otherwise.
  externalContacts?: ExternalContact[];
  createdAt: Timestamp;
}

export interface ExternalContact {
  /** Local id (timestamp-random) — used to address a single contact
   *  inside the array on update/delete since Firestore can't target
   *  array elements by index. */
  id: string;
  name: string;
  /** Validated client-side via the same regex used in
   *  `/api/notify`. Stored lowercased so de-dup against family member
   *  emails works on insert. */
  email: string;
  /** Default true. Stored explicitly so a parent can flip it off
   *  without re-creating the contact. */
  notifyOnRating?: boolean;
  notifyOnAward?: boolean;
  addedAt: Timestamp;
  /** uid of the parent who added the contact — purely audit. */
  addedBy: string;
}

export interface Routine {
  id: string;
  label: string;
  labelSw: string;
  icon: string;
  period: 'morning' | 'evening';
  pointsExcellent: number;
  pointsGood: number;
  pointsBad: number;
  active: boolean;
}

export interface Child {
  id: string;
  name: string;
  houseName: string;
  houseColor: string;
  avatarEmoji: string;
  avatarPhoto?: string;
  // ── Identity ──
  birthday?: string;          // canonical YYYY-MM-DD; UI displays DD-MMM-YYYY
  email?: string;             // optional — when set, this kid can later sign in with it
  emailLower?: string;        // lowercase mirror so we can match-on-signup case-insensitively
  loginEnabled?: boolean;     // parent toggle — must be true for the kid to sign in via email match
  handle?: string;            // case-preserved, e.g. "Daniella"
  handleLower?: string;       // lowercase mirror for unique lookup
  gender?: Gender;            // drives avatar hints + on-this-day filtering
  interests?: string[];       // free-form chips, e.g. ['Football', 'Lego']
  aspirations?: string[];     // up to 3, e.g. ['Pilot', 'Doctor', 'Footballer']
  // ── Game state ──
  totalPoints: number;
  weeklyPoints: number;
  streak: number;
  badges: string[];
  // ── The Hive · per-child overrides ──
  // Override the family-wide `hiveConfig.spendAutoApproveBelowCents` for
  // this kid. `null` (or absent) → use the family default. `0` → force
  // every spend through approval, even if the family has a default
  // threshold. Stored in the active currency's minor units (cents).
  spendAutoApproveBelowCents?: number | null;
}

export interface WishlistItem {
  id: string;
  title: string;
  description?: string;
  url?: string;
  imageUrl?: string;
  estimatedCost?: number;
  achieved: boolean;
  achievedAt?: Timestamp;
  createdAt: Timestamp;
}

export interface DailyRating {
  id: string;
  childId: string;
  date: string; // YYYY-MM-DD
  period: 'morning' | 'evening';
  ratings: Record<string, RatingValue>;
  totalPoints: number;
  ratedBy: string;
  ratedByName: string;
  // Free-text note. Originally added so comments from historical
  // Google-Sheet logs are preserved on import; surfaced on Reports.
  comment?: string;
  createdAt: Timestamp;
}

export interface Award {
  id: string;
  childId: string;
  points: number;
  reason: string;
  category: string;
  awardedBy: string;
  awardedByName: string;
  createdAt: Timestamp;
}

export interface Meeting {
  id: string;
  date: string;
  type: 'weekly' | 'special' | 'kid-led';
  attendees: string[];
  gratitude: Record<string, string>;
  goals: Record<string, string>;
  notes: string;
  createdBy: string;
  createdAt: Timestamp;
}

export interface Reward {
  id: string;
  title: string;
  description: string;
  pointsCost: number;
  icon: string;
  active: boolean;
}

export interface Notification {
  id: string;
  type:
    | 'points'
    | 'badge'
    | 'meeting'
    | 'reward'
    | 'streak'
    // Moments events — surfaced in the bell icon dropdown.
    | 'moment-reaction'
    | 'moment-comment'
    | 'moment-mention'
    | 'moment-new';
  title: string;
  message: string;
  read: boolean;
  forUserId: string;
  /** Optional link target — when set, tapping the notification opens it.
   *  For Moments events this is `/moments/{postId}`. */
  link?: string;
  createdAt: Timestamp;
}

// ── Default Routines ──────────────────────────────
export const DEFAULT_ROUTINES: Routine[] = [
  { id: 'bed', label: 'Making bed', labelSw: 'Kutandika Kitanda', icon: '🛏️', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'teeth', label: 'Brushing teeth', labelSw: 'Kuswaki', icon: '🪥', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'bath', label: 'Taking bath', labelSw: 'Kuoga', icon: '🚿', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'timely', label: 'Timely preparation', labelSw: 'Kujiandaa kwa wakati', icon: '⏰', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'breakfast', label: 'Breakfast', labelSw: 'Chai Asubuhi', icon: '🥣', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'room', label: 'Clean room', labelSw: 'Chumba Safi', icon: '✨', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'prayer', label: 'Morning prayer', labelSw: 'Sala Asubuhi', icon: '🤲', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'behavior', label: 'Good behavior', labelSw: 'Adabu Njema', icon: '⭐', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'homework', label: 'Homework', labelSw: 'Kazi ya Nyumbani', icon: '📚', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'dinner', label: 'Dinner manners', labelSw: 'Adabu za Chakula', icon: '🍽️', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'bedtime', label: 'Bedtime routine', labelSw: 'Maandalizi ya Kulala', icon: '🌙', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'evening-prayer', label: 'Evening prayer', labelSw: 'Sala Jioni', icon: '🕌', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
];

// ── Default Rewards ──────────────────────────────
export const DEFAULT_REWARDS: Omit<Reward, 'id'>[] = [
  { title: 'Extra screen time (30 min)', description: 'Earn 30 minutes of extra tablet/TV time', pointsCost: 20, icon: '📱', active: true },
  { title: 'Choose dinner menu', description: 'Pick what the family eats for dinner', pointsCost: 30, icon: '🍕', active: true },
  { title: 'Stay up 30 min late', description: 'Bedtime pushed back by 30 minutes', pointsCost: 25, icon: '🌙', active: true },
  { title: 'Ice cream trip', description: 'Family trip to get ice cream', pointsCost: 50, icon: '🍦', active: true },
  { title: 'New book or toy', description: 'Choose a new book or small toy', pointsCost: 100, icon: '🎁', active: true },
  { title: 'Friend sleepover', description: 'Have a friend sleep over for one night', pointsCost: 150, icon: '🏠', active: true },
];

// ── Badge Definitions ─────────────────────────────
export const BADGES = [
  { id: 'first-star', name: 'First Star', description: 'Earn your first points', icon: '⭐', threshold: 1 },
  { id: 'rising-star', name: 'Rising Star', description: 'Earn 50 total points', icon: '🌟', threshold: 50 },
  { id: 'superstar', name: 'Superstar', description: 'Earn 200 total points', icon: '💫', threshold: 200 },
  { id: 'streak-3', name: 'On Fire', description: '3-day perfect streak', icon: '🔥', threshold: 3 },
  { id: 'streak-7', name: 'Unstoppable', description: '7-day perfect streak', icon: '🚀', threshold: 7 },
  { id: 'streak-30', name: 'Legend', description: '30-day streak', icon: '👑', threshold: 30 },
  { id: 'helper-hero', name: 'Helper Hero', description: 'Help with 10 extra chores', icon: '🦸', threshold: 10 },
  { id: 'meeting-champ', name: 'Meeting Champion', description: 'Attend 5 family meetings', icon: '🏆', threshold: 5 },
];

// ── Utility ───────────────────────────────────────
function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export function todayString(): string {
  return new Date().toISOString().split('T')[0];
}

// ── User Operations ───────────────────────────────
export async function createUserProfile(profile: UserProfile) {
  if (isGuestActive()) return;
  await setDoc(doc(db, 'users', profile.uid), profile);
}

export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  if (isGuestActive()) return { uid, email: 'guest@ourkaya.com', displayName: 'Guest Visitor', role: 'parent' as Role, familyId: GUEST_FAMILY_ID } as UserProfile;
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

export async function updateUserProfile(uid: string, data: Partial<UserProfile>) {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'users', uid), data);
}

// Returns all user profiles attached to a family — used to find notification
// recipients (parents + helpers) when ratings or awards are submitted.
export async function getFamilyMembers(familyId: string): Promise<UserProfile[]> {
  if (isGuestActive()) return [];
  const q = query(collection(db, 'users'), where('familyId', '==', familyId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => d.data() as UserProfile);
}

// ── Family Operations ─────────────────────────────
export async function createFamily(
  name: string,
  createdBy: string,
  referralCode?: string,
): Promise<string> {
  if (isGuestActive()) return GUEST_FAMILY_ID;

  // Resolve the referrer family up-front (queries inside transactions are not
  // supported in the client SDK).
  let referrerFamilyId: string | null = null;
  if (referralCode) {
    const q = query(
      collection(db, 'families'),
      where('referralCode', '==', referralCode.toUpperCase()),
    );
    const snap = await getDocs(q);
    if (!snap.empty) referrerFamilyId = snap.docs[0].id;
  }

  // Atomic: increment global family counter, set founding-family flag, link
  // referrer (+ compound credit one level up).
  let createdFamilyId = '';
  await runTransaction(db, async (tx) => {
    // ── reads first ──
    const metaRef = doc(db, 'meta', 'global');
    const metaSnap = await tx.get(metaRef);

    let referrerData: any = null;
    let grandRefId: string | null = null;
    let grandData: any = null;
    if (referrerFamilyId) {
      const referrerSnap = await tx.get(doc(db, 'families', referrerFamilyId));
      if (referrerSnap.exists()) {
        referrerData = referrerSnap.data();
        if (referrerData.referredBy) {
          grandRefId = referrerData.referredBy as string;
          const grandSnap = await tx.get(doc(db, 'families', grandRefId));
          if (grandSnap.exists()) grandData = grandSnap.data();
        }
      } else {
        referrerFamilyId = null; // stale code; ignore
      }
    }

    // ── compute ──
    const familyCount = (metaSnap.exists() ? metaSnap.data().familyCount : 0) || 0;
    const newCount = familyCount + 1;
    const isFounding = newCount <= FOUNDING_FAMILY_LIMIT;

    // ── writes ──
    const familyRef = doc(collection(db, 'families'));
    createdFamilyId = familyRef.id;

    tx.set(familyRef, {
      name,
      createdBy,
      inviteCode: generateInviteCode(),
      referralCode: generateReferralCode(name),
      referredBy: referrerFamilyId,
      referralCount: 0,
      compoundCredit: 0,
      isFoundingFamily: isFounding,
      spotlightOptIn: false,
      pointsMode: 'full' as PointsMode,
      routines: DEFAULT_ROUTINES,
      createdAt: serverTimestamp(),
    });

    tx.set(metaRef, { familyCount: newCount }, { merge: true });

    if (referrerFamilyId && referrerData) {
      tx.update(doc(db, 'families', referrerFamilyId), {
        referralCount: (referrerData.referralCount || 0) + 1,
      });
    }
    if (grandRefId && grandData) {
      tx.update(doc(db, 'families', grandRefId), {
        compoundCredit: (grandData.compoundCredit || 0) + 1,
      });
    }
  });

  // Seed default rewards (separate batch — too many writes for one transaction).
  const batch = writeBatch(db);
  DEFAULT_REWARDS.forEach((reward) => {
    const rewardRef = doc(collection(db, 'families', createdFamilyId, 'rewards'));
    batch.set(rewardRef, reward);
  });
  await batch.commit();

  return createdFamilyId;
}

// ── Handle lookups ──────────────────────────────────────────────
// handles are stored case-preserved with a `handleLower` mirror so we can
// query case-insensitively and still display with the user's preferred case.
export async function getFamilyByHandle(handle: string): Promise<Family | null> {
  if (isGuestActive()) return null;
  if (!handle) return null;
  const q = query(
    collection(db, 'families'),
    where('handleLower', '==', handle.toLowerCase()),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Family;
}

export async function isHandleAvailable(
  handle: string,
  exclude?: { familyId?: string; userUid?: string; childId?: string },
): Promise<boolean> {
  if (isGuestActive()) return true;
  if (!handle) return false;
  const lower = handle.toLowerCase();
  const ex = exclude || {};

  // Families
  const famSnap = await getDocs(
    query(collection(db, 'families'), where('handleLower', '==', lower)),
  );
  for (const d of famSnap.docs) {
    if (d.id !== ex.familyId) return false;
  }

  // Users
  const userSnap = await getDocs(
    query(collection(db, 'users'), where('handleLower', '==', lower)),
  );
  for (const d of userSnap.docs) {
    if (d.id !== ex.userUid) return false;
  }

  // Children — collection group query across all families.
  // Note: requires a Firestore composite index. Firebase will print a console
  // link the first time this runs; tap it to create the index.
  try {
    const kidSnap = await getDocs(
      query(collectionGroup(db, 'children'), where('handleLower', '==', lower)),
    );
    for (const d of kidSnap.docs) {
      if (d.id !== ex.childId) return false;
    }
  } catch {
    // If the composite index isn't there yet, treat as available (uniqueness
    // will be enforced once the index is created and the next save retries).
  }

  return true;
}

// Find a child whose stored email matches (case-insensitive). Used at signup
// time to auto-link a brand-new user to an existing kid profile.
export async function findChildByEmail(email: string): Promise<{ familyId: string; child: Child } | null> {
  if (isGuestActive()) return null;
  if (!email) return null;
  const lower = email.toLowerCase();
  try {
    const snap = await getDocs(
      query(collectionGroup(db, 'children'), where('emailLower', '==', lower)),
    );
    for (const d of snap.docs) {
      const data = d.data() as Child;
      if (data.loginEnabled !== true) continue;
      // d.ref.parent.parent is the family doc.
      const familyRef = d.ref.parent.parent;
      if (!familyRef) continue;
      return { familyId: familyRef.id, child: { ...data, id: d.id } as Child };
    }
  } catch {
    // No index yet → treat as no match.
  }
  return null;
}

export async function getFamilyByReferralCode(code: string): Promise<Family | null> {
  if (isGuestActive()) return null;
  if (!code) return null;
  const q = query(
    collection(db, 'families'),
    where('referralCode', '==', code.toUpperCase()),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Family;
}

// Families opted in to the Champion landing-page spotlight. Only shows
// families with 10+ direct referrals (Champion tier).
export async function getSpotlightFamilies(max = 6): Promise<Family[]> {
  if (isGuestActive()) return [];
  const q = query(
    collection(db, 'families'),
    where('spotlightOptIn', '==', true),
  );
  const snap = await getDocs(q);
  const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Family));
  return all
    .filter((f) => (f.referralCount || 0) >= 10)
    .sort((a, b) => (b.referralCount || 0) - (a.referralCount || 0))
    .slice(0, max);
}

export async function getReferredFamilies(familyId: string): Promise<Family[]> {
  if (isGuestActive()) {
    // Demo: show one referred family in guest mode so the panel feels populated.
    return [{
      ...MOCK_FAMILY,
      id: 'demo-referred',
      name: 'The Mwangi Family',
      referredBy: familyId,
    } as Family];
  }
  const q = query(collection(db, 'families'), where('referredBy', '==', familyId));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Family));
}

// Lazily backfill a referralCode for a family that pre-dates the campaign.
// Safe to call repeatedly; no-op if a code already exists.
export async function ensureReferralCode(family: Family): Promise<string> {
  if (family.referralCode) return family.referralCode;
  if (isGuestActive()) return generateReferralCode(family.name);
  const code = generateReferralCode(family.name);
  await updateDoc(doc(db, 'families', family.id), { referralCode: code });
  return code;
}

export async function getFamily(familyId: string): Promise<Family | null> {
  if (isGuestActive()) return MOCK_FAMILY;
  const snap = await getDoc(doc(db, 'families', familyId));
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Family) : null;
}

export async function updateFamily(familyId: string, data: Partial<Family>) {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId), data);
}

// ── External contact CRUD ────────────────────────────────────────
// Operates on the `externalContacts` array on the Family doc. We
// read-modify-write because Firestore can't update individual array
// elements by id. Concurrent edits are extremely rare for a family-app
// settings page so this is fine.

const EMAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function addExternalContact(
  familyId: string,
  data: { name: string; email: string; notifyOnRating?: boolean; notifyOnAward?: boolean; addedBy: string },
): Promise<ExternalContact> {
  if (isGuestActive()) throw new Error('Guests cannot add contacts.');
  const trimmedName = data.name.trim();
  const lowerEmail = data.email.trim().toLowerCase();
  if (!trimmedName) throw new Error('Name is required.');
  if (!EMAIL_RX.test(lowerEmail)) throw new Error('Invalid email address.');
  const fam = await getFamily(familyId);
  const existing = fam?.externalContacts || [];
  // De-dup by email so the dispatcher doesn't send twice.
  if (existing.some((c) => c.email === lowerEmail)) {
    throw new Error('A contact with that email already exists.');
  }
  const contact: ExternalContact = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: trimmedName,
    email: lowerEmail,
    notifyOnRating: data.notifyOnRating !== false,
    notifyOnAward: data.notifyOnAward !== false,
    addedAt: Timestamp.now(),
    addedBy: data.addedBy,
  };
  await updateDoc(doc(db, 'families', familyId), {
    externalContacts: [...existing, contact],
  });
  return contact;
}

export async function updateExternalContact(
  familyId: string,
  contactId: string,
  patch: Partial<Pick<ExternalContact, 'name' | 'email' | 'notifyOnRating' | 'notifyOnAward'>>,
): Promise<void> {
  if (isGuestActive()) return;
  const fam = await getFamily(familyId);
  const existing = fam?.externalContacts || [];
  const next = existing.map((c) => {
    if (c.id !== contactId) return c;
    const updated: ExternalContact = { ...c };
    if (patch.name !== undefined) {
      const t = patch.name.trim();
      if (!t) throw new Error('Name is required.');
      updated.name = t;
    }
    if (patch.email !== undefined) {
      const lower = patch.email.trim().toLowerCase();
      if (!EMAIL_RX.test(lower)) throw new Error('Invalid email address.');
      if (existing.some((x) => x.id !== contactId && x.email === lower)) {
        throw new Error('Another contact already uses that email.');
      }
      updated.email = lower;
    }
    if (patch.notifyOnRating !== undefined) updated.notifyOnRating = patch.notifyOnRating;
    if (patch.notifyOnAward !== undefined) updated.notifyOnAward = patch.notifyOnAward;
    return updated;
  });
  await updateDoc(doc(db, 'families', familyId), { externalContacts: next });
}

export async function removeExternalContact(familyId: string, contactId: string): Promise<void> {
  if (isGuestActive()) return;
  const fam = await getFamily(familyId);
  const existing = fam?.externalContacts || [];
  const next = existing.filter((c) => c.id !== contactId);
  await updateDoc(doc(db, 'families', familyId), { externalContacts: next });
}

export async function findFamilyByInviteCode(code: string): Promise<Family | null> {
  if (isGuestActive()) return null;
  const q = query(collection(db, 'families'), where('inviteCode', '==', code.toUpperCase()));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as Family;
}

// ── Children Operations ───────────────────────────
export async function addChild(familyId: string, child: Omit<Child, 'id'>): Promise<string> {
  if (isGuestActive()) return 'guest-child';
  const ref = await addDoc(collection(db, 'families', familyId, 'children'), child);
  return ref.id;
}

export async function getChildren(familyId: string): Promise<Child[]> {
  if (isGuestActive()) return MOCK_CHILDREN;
  const snap = await getDocs(collection(db, 'families', familyId, 'children'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Child));
}

export async function updateChild(familyId: string, childId: string, data: Partial<Child>) {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId, 'children', childId), data);
}

// ── Wishlist (per-child subcollection) ───────────
export async function getWishlist(familyId: string, childId: string): Promise<WishlistItem[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(
    query(
      collection(db, 'families', familyId, 'children', childId, 'wishlist'),
      orderBy('createdAt', 'desc'),
    ),
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WishlistItem));
}

export async function addWishlistItem(
  familyId: string,
  childId: string,
  item: Omit<WishlistItem, 'id' | 'createdAt' | 'achieved' | 'achievedAt'>,
): Promise<string> {
  if (isGuestActive()) return 'guest-wish';
  const ref = await addDoc(
    collection(db, 'families', familyId, 'children', childId, 'wishlist'),
    { ...item, achieved: false, createdAt: serverTimestamp() },
  );
  return ref.id;
}

export async function updateWishlistItem(
  familyId: string,
  childId: string,
  itemId: string,
  data: Partial<WishlistItem>,
) {
  if (isGuestActive()) return;
  const patch: any = { ...data };
  if (data.achieved && !data.achievedAt) patch.achievedAt = serverTimestamp();
  await updateDoc(
    doc(db, 'families', familyId, 'children', childId, 'wishlist', itemId),
    patch,
  );
}

export async function deleteWishlistItem(familyId: string, childId: string, itemId: string) {
  if (isGuestActive()) return;
  await deleteDoc(doc(db, 'families', familyId, 'children', childId, 'wishlist', itemId));
}

export function subscribeToChildren(familyId: string, callback: (children: Child[]) => void) {
  if (isGuestActive()) {
    callback(MOCK_CHILDREN);
    return () => {};
  }
  return onSnapshot(collection(db, 'families', familyId, 'children'), (snap) => {
    callback(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Child)));
  });
}

// Real-time subscription to the family doc itself. Used so toggles like
// `allowGenderOther` / `earningMethods` / `anniversary` reflect their new
// value the instant Firestore confirms the write — without it, callers
// would read a stale value of `family.X` until the next page load.
export function subscribeToFamily(familyId: string, callback: (family: Family | null) => void) {
  if (isGuestActive()) {
    callback(MOCK_FAMILY);
    return () => {};
  }
  return onSnapshot(doc(db, 'families', familyId), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Family) : null);
  });
}

// ── Rating Operations ─────────────────────────────
export async function submitRating(familyId: string, rating: Omit<DailyRating, 'id'>) {
  if (isGuestActive()) return 'guest-rating';
  // Strip undefined fields — Firestore rejects them, and `comment` is optional.
  const payload: Record<string, unknown> = { ...rating, createdAt: serverTimestamp() };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  const ref = await addDoc(collection(db, 'families', familyId, 'ratings'), payload);

  // Update child's total points
  const childRef = doc(db, 'families', familyId, 'children', rating.childId);
  const childSnap = await getDoc(childRef);
  if (childSnap.exists()) {
    const child = childSnap.data() as Child;
    await updateDoc(childRef, {
      totalPoints: (child.totalPoints || 0) + rating.totalPoints,
      weeklyPoints: (child.weeklyPoints || 0) + rating.totalPoints,
    });
  }

  return ref.id;
}

// Historical import path — used by the one-time Google-Sheet importer.
// Behaviour differs from submitRating in two ways:
//   1. If a rating doc already exists for (childId, date, period), we
//      replace it instead of stacking duplicates — re-running the import
//      is idempotent.
//   2. We only credit weeklyPoints when the row's `date` falls in the
//      current ISO week, so importing last month's data doesn't inflate
//      this week's leaderboard.
// The function returns { id, action } where action is 'created' or
// 'replaced' for the caller's preview/summary.
export async function importRating(
  familyId: string,
  rating: Omit<DailyRating, 'id'>,
): Promise<{ id: string; action: 'created' | 'replaced' }> {
  if (isGuestActive()) return { id: 'guest-import', action: 'created' };
  const payload: Record<string, unknown> = { ...rating, createdAt: serverTimestamp() };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  // Look for an existing rating with the same key triple.
  const existingQ = query(
    collection(db, 'families', familyId, 'ratings'),
    where('childId', '==', rating.childId),
    where('date', '==', rating.date),
    where('period', '==', rating.period),
  );
  const existingSnap = await getDocs(existingQ);
  const prior = existingSnap.empty ? null : existingSnap.docs[0];
  const priorPoints = prior ? (prior.data() as DailyRating).totalPoints || 0 : 0;
  const delta = rating.totalPoints - priorPoints;

  let id: string;
  let action: 'created' | 'replaced';
  if (prior) {
    await setDoc(prior.ref, payload, { merge: false });
    id = prior.id;
    action = 'replaced';
  } else {
    const ref = await addDoc(collection(db, 'families', familyId, 'ratings'), payload);
    id = ref.id;
    action = 'created';
  }

  // Update child running totals by the delta. Weekly only counts if the
  // date is within the current week.
  const childRef = doc(db, 'families', familyId, 'children', rating.childId);
  const childSnap = await getDoc(childRef);
  if (childSnap.exists()) {
    const child = childSnap.data() as Child;
    const inThisWeek = isInCurrentWeek(rating.date);
    await updateDoc(childRef, {
      totalPoints: Math.max(0, (child.totalPoints || 0) + delta),
      ...(inThisWeek ? { weeklyPoints: Math.max(0, (child.weeklyPoints || 0) + delta) } : {}),
    });
  }
  return { id, action };
}

function isInCurrentWeek(dateStr: string): boolean {
  // Monday-start ISO week. Returns true if `dateStr` (YYYY-MM-DD) is in
  // the same week as today, in the local timezone (so it lines up with
  // the kid-facing week boundary).
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const today = new Date();
  const startOfWeek = (x: Date) => {
    const c = new Date(x);
    const dow = (c.getDay() + 6) % 7; // 0 = Monday
    c.setHours(0, 0, 0, 0);
    c.setDate(c.getDate() - dow);
    return c;
  };
  const a = startOfWeek(d).getTime();
  const b = startOfWeek(today).getTime();
  return a === b;
}

export async function getTodayRatings(familyId: string, childId: string, period: string): Promise<DailyRating | null> {
  if (isGuestActive()) return MOCK_RATINGS.find(r => r.childId === childId && r.period === period && r.date === todayString()) || null;
  const today = todayString();
  const q = query(
    collection(db, 'families', familyId, 'ratings'),
    where('childId', '==', childId),
    where('date', '==', today),
    where('period', '==', period)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() } as DailyRating;
}

export async function getRecentRatings(familyId: string, days: number = 7): Promise<DailyRating[]> {
  if (isGuestActive()) return MOCK_RATINGS;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split('T')[0];

  const q = query(
    collection(db, 'families', familyId, 'ratings'),
    where('date', '>=', sinceStr),
    orderBy('date', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRating));
}

// ── Award Operations ──────────────────────────────
export async function giveAward(familyId: string, award: Omit<Award, 'id'>) {
  if (isGuestActive()) return 'guest-award';
  const ref = await addDoc(collection(db, 'families', familyId, 'awards'), {
    ...award,
    createdAt: serverTimestamp(),
  });

  // Update child points
  const childRef = doc(db, 'families', familyId, 'children', award.childId);
  const childSnap = await getDoc(childRef);
  if (childSnap.exists()) {
    const child = childSnap.data() as Child;
    await updateDoc(childRef, {
      totalPoints: (child.totalPoints || 0) + award.points,
      weeklyPoints: (child.weeklyPoints || 0) + award.points,
    });
  }

  return ref.id;
}

export async function getRecentAwards(familyId: string, days: number = 7): Promise<Award[]> {
  if (isGuestActive()) return MOCK_AWARDS;
  const q = query(
    collection(db, 'families', familyId, 'awards'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Award));
}

// ── Meeting Operations ────────────────────────────
export async function createMeeting(familyId: string, meeting: Omit<Meeting, 'id'>) {
  if (isGuestActive()) return { id: 'guest-meeting' } as any;
  return addDoc(collection(db, 'families', familyId, 'meetings'), {
    ...meeting,
    createdAt: serverTimestamp(),
  });
}

export async function getMeetings(familyId: string): Promise<Meeting[]> {
  if (isGuestActive()) return [];
  const q = query(
    collection(db, 'families', familyId, 'meetings'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Meeting));
}

// ── Rewards Operations ────────────────────────────
export async function getRewards(familyId: string): Promise<Reward[]> {
  if (isGuestActive()) return MOCK_REWARDS;
  const snap = await getDocs(collection(db, 'families', familyId, 'rewards'));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Reward));
}

export async function addReward(familyId: string, reward: Omit<Reward, 'id'>) {
  if (isGuestActive()) return { id: 'guest-reward' } as any;
  return addDoc(collection(db, 'families', familyId, 'rewards'), reward);
}

export async function redeemReward(familyId: string, childId: string, reward: Reward) {
  if (isGuestActive()) return;
  const childRef = doc(db, 'families', familyId, 'children', childId);
  const childSnap = await getDoc(childRef);
  if (!childSnap.exists()) throw new Error('Child not found');

  const child = childSnap.data() as Child;
  if (child.totalPoints < reward.pointsCost) throw new Error('Not enough points');

  await updateDoc(childRef, {
    totalPoints: child.totalPoints - reward.pointsCost,
  });

  // Log the redemption
  await addDoc(collection(db, 'families', familyId, 'redemptions'), {
    childId,
    rewardId: reward.id,
    rewardTitle: reward.title,
    pointsSpent: reward.pointsCost,
    createdAt: serverTimestamp(),
  });
}

// ── Notification Operations ───────────────────────
export async function createNotification(familyId: string, notification: Omit<Notification, 'id'>) {
  if (isGuestActive()) return { id: 'guest-notif' } as any;
  return addDoc(collection(db, 'families', familyId, 'notifications'), {
    ...notification,
    createdAt: serverTimestamp(),
  });
}

export async function getNotifications(familyId: string, userId: string): Promise<Notification[]> {
  if (isGuestActive()) return [];
  const q = query(
    collection(db, 'families', familyId, 'notifications'),
    where('forUserId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(30)
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
}

export async function markNotificationRead(familyId: string, notificationId: string) {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'families', familyId, 'notifications', notificationId), { read: true });
}
