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
  // ── Settings ──
  pointsMode: PointsMode;
  earningMethods?: string[]; // ids from EARNING_METHODS — defaults to DEFAULT_EARNING_METHODS when absent
  routines: Routine[];
  createdAt: Timestamp;
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
  type: 'points' | 'badge' | 'meeting' | 'reward' | 'streak';
  title: string;
  message: string;
  read: boolean;
  forUserId: string;
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

// ── Rating Operations ─────────────────────────────
export async function submitRating(familyId: string, rating: Omit<DailyRating, 'id'>) {
  if (isGuestActive()) return 'guest-rating';
  const ref = await addDoc(collection(db, 'families', familyId, 'ratings'), {
    ...rating,
    createdAt: serverTimestamp(),
  });

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
