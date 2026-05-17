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
// `guest` is the most restricted role — added so families can hand out
// a third invite code (e.g. for grandparents, godparents) that gets
// view-only access without write permissions. Permission enforcement
// for the guest tier follows in a later pass; for now it behaves like
// `helper` in Firestore rules but the role distinction is recorded.
export type Role = 'parent' | 'helper' | 'kid' | 'guest';
export type PointsMode = 'full' | 'badges-only' | 'encouragement';
export type RatingValue = 'excellent' | 'good' | 'bad' | 'skip';
// The five recognised kinds of award. Drives points math + UI.
//   regular           +1, +2, +3 (cap from family config)
//   diamond           +4 and above (parents' big-moment bonus)
//   reducing          negative (–1 to –reducingMax), only if family enables it
//   kudos             0 pts — accumulates toward a bonus when the family's
//                     threshold is reached (e.g. 4 Kudos = +1 bonus point)
//   improvement_note  0 pts — accumulates toward a deduction when the family's
//                     threshold is reached (only deducts if reducing is enabled)
export type AwardKind = 'regular' | 'diamond' | 'reducing' | 'kudos' | 'improvement_note';
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
  // Legacy single invite code. Pre-2026-05 families have only this
  // field; new families also get `inviteCodes` below with one code per
  // role. Kept on every doc for backwards compatibility — the legacy
  // code resolves to the `helper` role since that was its original
  // labelling in Settings.
  inviteCode: string;
  // Per-role invite codes. Each one is independent and identifies the
  // role a new user joins as when they paste it during onboarding. All
  // generated up-front for new families; lazily backfilled for older
  // families via `ensureInviteCodes()`.
  //
  // Each entry carries lifecycle state:
  //   - `active`     gates joins (rejected when false, with a clear UI msg)
  //   - `activatedAt`/`usedAt` are display-only audit timestamps
  //   - Kid + Guest codes start INACTIVE — parent activates right
  //     before sharing. Helper codes start ACTIVE (long-lived staff
  //     credential). On successful join the code auto-deactivates so
  //     a single share can't be replayed.
  //
  // The field accepts the legacy string shape too for one-shot
  // migration; `ensureInviteCodes()` normalises to the object form on
  // first read after the upgrade. Cast at the boundary.
  inviteCodes?: {
    kid?:    InviteCodeState | string;
    helper?: InviteCodeState | string;
    guest?:  InviteCodeState | string;
  };
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
  // Which modules show up in a kid's nav (sidebar + mobile More sheet)
  // and which kid-side routes are reachable. Ids from `KID_MODULES` in
  // `lib/kidModules.ts`. When absent, falls back to `DEFAULT_KID_MODULES`
  // — Home is always granted regardless. Routes not in the granted set
  // bounce kids back to /kid via the AppShell route guard.
  kidModules?: string[];
  routines: Routine[];
  // Family-configurable point system rules (tier caps, reducing on/off,
  // Kudos / Improvement Note thresholds). Optional — `readPointSystemConfig`
  // merges with `DEFAULT_POINT_SYSTEM` so older family docs keep working.
  pointSystem?: PointSystemConfig;
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
  // ── Helper login code ────────────────────────────────────────
  // Stable, displayable family identifier used by helpers to sign in
  // via Tier A (family code + helper code + password). Distinct from
  // `inviteCodes.helper`, which gates JOIN; this gates ongoing LOGIN.
  // 4-char alphanumeric, ambiguity-stripped (no 0/O/1/I/L). Lazily
  // populated by `ensureFamilyCode()` on first Settings → Helpers
  // open so legacy families pick it up without a migration.
  familyCode?: string;
  createdAt: Timestamp;
}

// ── Helper (per-family scoped credential) ────────────────────
// One doc per helper per family. Lives at
// `families/{familyId}/helpers/{uid}`. The Firebase Auth user backing
// this helper is created via the secondary-app pattern in
// `lib/helpers.ts` (no admin SDK required).
//
// Tier A (today): synthetic email of the form
// `h.{familyCode}.{helperCode}@helper.kaya.app` + password. The helper
// never sees or uses the email — they enter the 3 codes at /h/login.
// Tier B (Neldi-driven OTP) + Tier C (real email) come later; they
// link a real phone/email onto the same UID via account linking so
// all HelperLink history is preserved automatically.
export interface HelperLink {
  uid: string;
  helperCode: string;                                        // short handle within the family, e.g. "AMINA"
  displayName: string;
  preset: 'nanny' | 'tutor' | 'driver' | 'grandparent' | 'custom';
  kidIds: string[];                                          // which kids this helper can act on; [] = none
  // Module flags from `lib/kidModules.ts`. Stored today, not yet
  // enforced in rules (per the v0 scope decision — per-kid only is the
  // current grain). Future tightening will not require a migration.
  modules: string[];
  canLog: boolean;                                           // tap-checklist + capture writes (default true)
  canAward: boolean;                                         // kudos / improvement_note only; defaults false
  attribution: 'named' | 'generic' | 'hidden';               // for the future performance page
  authTier: 'A' | 'B' | 'C';
  status: 'active' | 'paused' | 'removed';
  createdAt: Timestamp;
  createdBy: string;                                         // parent UID who added them
}

// Per-role invite code with lifecycle state. Stored under
// `Family.inviteCodes.{role}`. See the comment on `Family.inviteCodes`
// for the activation/expiry policy.
export interface InviteCodeState {
  code: string;
  active: boolean;
  /** Last time someone flipped `active` on. Display-only. */
  activatedAt?: Timestamp;
  /** When the code was consumed by a successful join. After this fires
   *  the code is auto-flipped to inactive and the parent must re-activate
   *  (or regenerate) before another join is allowed. */
  usedAt?: Timestamp;
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
  // Running counters for 0-point award kinds. When either hits its family-
  // configured threshold, `giveAward` auto-fires a derived bonus/deduction
  // award and decrements the counter by the threshold (modulo, not reset —
  // overflow carries to the next cycle).
  kudosCount?: number;
  improvementNoteCount?: number;
  // Sender-side rate limit for kid → kid appreciation notes. Tracks
  // how many kudos this kid has SENT today (not received). Reset
  // implicitly when the date string no longer matches today's
  // YYYY-MM-DD. Read + bumped in `sendKidKudos`.
  dailyKudosSentDate?: string;
  dailyKudosSentCount?: number;
  // Routine Points — accumulator for the points earned from rated daily
  // routines. Held separately from `totalPoints` so each rating contributes
  // small (0/1/2) increments here, and the configured conversion rate
  // (default 100 RP → 1 HP) folds them into `totalPoints` once the
  // threshold is reached. Lets parents see fine-grained routine effort
  // without ballooning the headline score.
  routinePoints?: number;
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
  // Free-text note for the whole period. Originally added so comments
  // from historical Google-Sheet logs are preserved on import; surfaced
  // on Reports + family meeting view.
  comment?: string;
  // Per-routine notes keyed by routine id. Required when a routine is
  // rated 'bad' (so meetings can address what went wrong); optional but
  // encouraged when rated 'excellent' (so wins get context). Surfaced in
  // the Reports notes panel alongside the overall `comment`.
  ratingNotes?: Record<string, string>;
  createdAt: Timestamp;
}

export interface Award {
  id: string;
  childId: string;
  // The five recognised kinds. Older docs may not have this field — use
  // `inferAwardKind(award)` to read defensively. New writes always set it.
  kind?: AwardKind;
  points: number;          // 0 for kudos/improvement_note, negative for reducing
  reason: string;
  category: string;
  awardedBy: string;
  awardedByName: string;
  // Role of the awarder at the time of creation. Defaults to 'parent'
  // for legacy docs. Kid-authored kudos (the appreciation-note feature)
  // always carry 'kid'; helper-authored awards carry 'helper'.
  senderRole?: 'parent' | 'helper' | 'kid';
  createdAt: Timestamp;
  // Set when this award was auto-fired by the threshold accumulator
  // (e.g. 4 Kudos → +1 derived award). Lets the UI badge it as automatic
  // and lets us trace back the source events that triggered it.
  derivedFrom?: {
    kind: 'kudos' | 'improvement_note';
    sourceAwardIds: string[];
  };
  // Optional tag used by the historical import script so re-runs are
  // idempotent and the bulk can be cleaned up if needed. Live UI writes
  // omit this field.
  importSource?: string;
}

// Family-configurable rules for the point system. Persisted partial on the
// Family doc as `pointSystem`; read via `readPointSystemConfig()` so
// missing/partial values fall back to `DEFAULT_POINT_SYSTEM`.
export interface PointSystemConfig {
  reducing: {
    enabled: boolean;       // default false — disabled = no negative awards
    max: number;            // 1–10 — caps the magnitude of a single reducing award
  };
  kudos: {
    enabled: boolean;       // default true
    label: string;          // renameable, default 'Kudos'
    threshold: number;      // e.g. 4 → fires a bonus every 4 Kudos
    bonusPoints: number;    // points granted when threshold is reached (default 1)
    // ── Kid → kid appreciation note (opt-in) ─────────────────────
    // When true, kids can send each other 0-point kudos via the
    // "Send appreciation" UI on their home page. Received kudos still
    // run through the same threshold accumulator so a sibling-issued
    // kudos contributes toward the recipient's bonus the same way a
    // parent-issued kudos would. Off by default.
    kidToKidEnabled?: boolean;
    // Max appreciations a single kid can send per day. Enforced at
    // the app layer via a per-sender counter on the Child doc. Default 3.
    kidDailyCap?: number;
  };
  improvementNote: {
    enabled: boolean;       // default true
    label: string;          // renameable, default 'Improvement Note'
    threshold: number;      // e.g. 4 → fires a deduction every 4 notes
    deductionPoints: number; // magnitude of the deduction (default 1)
  };
  diamondMinPoints: number; // boundary between regular and diamond (default 4)
  routines: {
    // Conversion rate from accumulated routine points to a single house
    // point. Default 100 keeps headline scores clean — 30 days of
    // straight-Excellent routines turn into ~3-5 house points per kid.
    pointsPerHousePoint: number;
  };
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
// Morning (8) + Evening (12) — aligned with the Excel "Form 2" template
// used by Elia's household for ~6 months. Single source of truth: new
// families get this whole set; existing families can add/rename/disable
// via `RoutinesEditor` in Settings.
export const DEFAULT_ROUTINES: Routine[] = [
  // ── Morning (8) ──
  { id: 'bed',         label: 'Making bed',         labelSw: 'Kutandika Kitanda',    icon: '🛏️', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'teeth',       label: 'Brushing teeth',     labelSw: 'Kuswaki',              icon: '🪥', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'bath',        label: 'Taking bath',        labelSw: 'Kuoga',                icon: '🚿', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'timely',      label: 'Timely preparation', labelSw: 'Kujiandaa kwa wakati', icon: '⏰', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'breakfast',   label: 'Breakfast',          labelSw: 'Chai Asubuhi',         icon: '🥣', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'room',        label: 'Clean room',         labelSw: 'Chumba Safi',          icon: '✨', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'prayer',      label: 'Morning prayer',     labelSw: 'Sala Asubuhi',         icon: '🤲', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'behavior',    label: 'Good behavior',      labelSw: 'Adabu Njema',          icon: '⭐', period: 'morning', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  // ── Evening (12) ──
  { id: 'homework',          label: 'Homework',         labelSw: 'Kazi za Shule',           icon: '📚', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'playing-outside',   label: 'Playing outside',  labelSw: 'Kucheza Nje',             icon: '🏃', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'reading',           label: 'Reading',          labelSw: 'Kusoma',                  icon: '📖', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'writing',           label: 'Writing',          labelSw: 'Kuandika',                icon: '✍️', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'home-chores',       label: "Daddy's home chores", labelSw: 'Kazi za Baba',         icon: '🧹', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'room-evening',      label: 'Clean room',       labelSw: 'Kupanga Chumba',          icon: '🛋️', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'dinner',            label: 'Dinner',           labelSw: 'Chakula Jioni',           icon: '🍽️', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'evening-prayer',    label: 'Evening prayer',   labelSw: 'Sala ya Jioni',           icon: '🕌', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'sleeping-time',     label: 'Sleeping time',    labelSw: 'Muda wa Kulala',          icon: '🌙', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'tablets',           label: 'Tablets / screens', labelSw: 'Kuangalia Movie or Games', icon: '📱', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'slippers',          label: 'Slippers',         labelSw: 'Malapa',                  icon: '🥿', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
  { id: 'behavior-evening',  label: 'Good behavior',    labelSw: 'Adabu Njema',             icon: '⭐', period: 'evening', pointsExcellent: 2, pointsGood: 1, pointsBad: 0, active: true },
];

// ── Default Point System Config ───────────────────
// Conservative defaults — Reducing is OFF until a family opts in (matches
// the encouragement-first philosophy). Kudos / Improvement Note are ON
// because they're low-stakes recognition that costs nothing if unused.
export const DEFAULT_POINT_SYSTEM: PointSystemConfig = {
  reducing: { enabled: false, max: 3 },
  kudos: { enabled: true, label: 'Kudos', threshold: 4, bonusPoints: 1, kidToKidEnabled: false, kidDailyCap: 3 },
  improvementNote: { enabled: true, label: 'Improvement Note', threshold: 4, deductionPoints: 1 },
  diamondMinPoints: 4,
  routines: { pointsPerHousePoint: 100 },
};

// Merge a family's stored partial config with the defaults. Always safe
// to call — handles missing `family`, missing `pointSystem`, partial sub-
// objects. Read-path only; writes should `updateDoc` a partial.
export function readPointSystemConfig(family: Family | null | undefined): PointSystemConfig {
  const stored = family?.pointSystem;
  if (!stored) return DEFAULT_POINT_SYSTEM;
  return {
    reducing: { ...DEFAULT_POINT_SYSTEM.reducing, ...(stored.reducing || {}) },
    kudos: { ...DEFAULT_POINT_SYSTEM.kudos, ...(stored.kudos || {}) },
    improvementNote: { ...DEFAULT_POINT_SYSTEM.improvementNote, ...(stored.improvementNote || {}) },
    diamondMinPoints: stored.diamondMinPoints ?? DEFAULT_POINT_SYSTEM.diamondMinPoints,
    routines: { ...DEFAULT_POINT_SYSTEM.routines, ...(stored.routines || {}) },
  };
}

// Resolve the AwardKind for legacy docs missing the `kind` field. Order:
//   1. explicit `kind` if set
//   2. `category` prefixed with 'diamond-' → diamond (pre-AwardKind convention)
//   3. negative points → reducing
//   4. fallback regular
// Zero-point legacy docs cannot be distinguished between kudos and
// improvement_note without context, so default to regular — those legacy
// rows will simply show as 0-point regular awards, which is harmless.
export function inferAwardKind(award: Pick<Award, 'kind' | 'category' | 'points'>): AwardKind {
  if (award.kind) return award.kind;
  if (award.category?.startsWith('diamond-')) return 'diamond';
  if ((award.points ?? 0) < 0) return 'reducing';
  return 'regular';
}

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

// Detach a user from their family. Keeps the user account intact (so
// they can re-join with a fresh invite code or be added to a different
// family later) — just clears `familyId` and `childId`. Used from the
// Family members card in Settings when a parent wants to remove a
// helper, guest, or stale kid login.
//
// Safety: this should be gated to the calling parent's UI; the
// Firestore rules do their own enforcement (`isParentInFamily`) but
// we don't want the UI to even surface the option for non-parents.
export async function removeUserFromFamily(uid: string): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(db, 'users', uid), {
    familyId: '',
    childId: null,
  });
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
      // Three role-specific codes generated up-front so parents can
      // copy-share them from Settings right after onboarding. Kid +
      // Guest start inactive (parent activates right before sharing);
      // Helper starts active since it's a long-lived staff credential.
      inviteCodes: {
        kid:    { code: generateInviteCode(), active: false },
        helper: { code: generateInviteCode(), active: true },
        guest:  { code: generateInviteCode(), active: false },
      },
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

// Normalise a stored invite-code entry (which may be the legacy
// string shape OR the new InviteCodeState object) to the canonical
// object form. Used everywhere we read codes so the rest of the code
// only deals with one shape.
function normalizeInviteCode(
  raw: InviteCodeState | string | undefined,
  fallbackActive: boolean,
): InviteCodeState | null {
  if (!raw) return null;
  if (typeof raw === 'string') return { code: raw, active: fallbackActive };
  return raw;
}

// Lazily generate per-role invite codes for a family that pre-dates
// the lifecycle feature. Safe to call repeatedly; only writes when the
// field is missing, partial, or still in the legacy string shape.
// Returns the resolved triple of fully-normalised state objects so
// callers can render immediately without a second fetch.
export async function ensureInviteCodes(
  family: Family,
): Promise<{ kid: InviteCodeState; helper: InviteCodeState; guest: InviteCodeState }> {
  const stored = family.inviteCodes || {};
  // Defaults: kid + guest start INACTIVE (parent activates right
  // before sharing — minimises the window a leaked code is useful).
  // Helper starts ACTIVE since it's a long-lived staff credential.
  const kid    = normalizeInviteCode(stored.kid,    false) || { code: generateInviteCode(), active: false };
  const helper = normalizeInviteCode(stored.helper, true)  || { code: family.inviteCode || generateInviteCode(), active: true };
  const guest  = normalizeInviteCode(stored.guest,  false) || { code: generateInviteCode(), active: false };
  const needsWrite =
    !stored.kid || !stored.helper || !stored.guest ||
    typeof stored.kid === 'string' || typeof stored.helper === 'string' || typeof stored.guest === 'string';
  if (needsWrite && !isGuestActive()) {
    await updateDoc(doc(db, 'families', family.id), {
      inviteCodes: { kid, helper, guest },
    });
  }
  return { kid, helper, guest };
}

// Match a code against any of a family's stored codes (legacy + 3
// per-role). Returns the matched role along with the (normalised)
// state so the caller can check `active` before honouring the join.
export async function findFamilyByAnyInviteCode(
  code: string,
): Promise<{ family: Family; suggestedRole: Role; state: InviteCodeState } | { reason: 'inactive'; suggestedRole: Role } | null> {
  if (isGuestActive()) return null;
  const upper = code.toUpperCase();

  // Try the legacy single-code path first. Treated as the Helper code
  // (its original Settings labelling) and assumed active — legacy code
  // had no lifecycle. New per-role codes take precedence below.
  const legacy = await getDocs(
    query(collection(db, 'families'), where('inviteCode', '==', upper)),
  );
  if (!legacy.empty) {
    const d = legacy.docs[0];
    const fam = { id: d.id, ...d.data() } as Family;
    // If the same code is ALSO indexed under `inviteCodes.helper`
    // (e.g. after ensureInviteCodes migrated it), the per-role path
    // below will catch it with its real `active` state. Skip falling
    // through to legacy if so — covered by the for-loop's match.
    const helperState = normalizeInviteCode(fam.inviteCodes?.helper, true);
    if (!helperState || helperState.code !== upper) {
      return { family: fam, suggestedRole: 'helper', state: { code: upper, active: true } };
    }
  }

  // Then check each per-role code field. Firestore queries on nested
  // fields require either an indexed path or three small reads — three
  // reads is fine for this rate.
  for (const role of ['kid', 'helper', 'guest'] as const) {
    // Stored entries can be a string (legacy) OR { code: '...' };
    // we query both shapes by hitting the `.code` path AND the bare
    // field. Most families will be on the new shape after one Settings
    // open; legacy reads keep working until then.
    const objectQ = await getDocs(
      query(collection(db, 'families'), where(`inviteCodes.${role}.code`, '==', upper)),
    );
    const stringQ = objectQ.empty
      ? await getDocs(query(collection(db, 'families'), where(`inviteCodes.${role}`, '==', upper)))
      : null;
    const snap = !objectQ.empty ? objectQ : stringQ!;
    if (snap.empty) continue;
    const d = snap.docs[0];
    const fam = { id: d.id, ...d.data() } as Family;
    const state = normalizeInviteCode(
      fam.inviteCodes?.[role],
      role === 'helper',
    ) || { code: upper, active: false };
    if (!state.active) {
      return { reason: 'inactive', suggestedRole: role };
    }
    return { family: fam, suggestedRole: role, state };
  }
  return null;
}

// Toggle an invite code's `active` flag. Writes `activatedAt` when
// flipping on so the UI can show "Activated 5 min ago".
export async function setInviteCodeActive(
  familyId: string,
  role: 'kid' | 'helper' | 'guest',
  active: boolean,
): Promise<void> {
  if (isGuestActive()) return;
  const famSnap = await getDoc(doc(db, 'families', familyId));
  if (!famSnap.exists()) return;
  const fam = { id: famSnap.id, ...famSnap.data() } as Family;
  const codes = await ensureInviteCodes(fam);
  const next: InviteCodeState = {
    ...codes[role],
    active,
    ...(active ? { activatedAt: Timestamp.now() } : {}),
  };
  await updateDoc(doc(db, 'families', familyId), {
    [`inviteCodes.${role}`]: next,
  });
}

// Mint a fresh code for one role + flip it inactive (parent will
// re-activate before sharing). Use when a code may be leaked, or to
// rotate routinely.
export async function regenerateInviteCode(
  familyId: string,
  role: 'kid' | 'helper' | 'guest',
): Promise<string> {
  if (isGuestActive()) return 'GUEST-NOOP';
  const newCode = generateInviteCode();
  await updateDoc(doc(db, 'families', familyId), {
    [`inviteCodes.${role}`]: { code: newCode, active: false },
  });
  return newCode;
}

// Mark a code as consumed by a successful join: stamps `usedAt` and
// auto-flips `active` to false (single-use safety). Called from the
// onboarding success path.
export async function markInviteCodeUsed(
  familyId: string,
  role: 'kid' | 'helper' | 'guest',
): Promise<void> {
  if (isGuestActive()) return;
  const famSnap = await getDoc(doc(db, 'families', familyId));
  if (!famSnap.exists()) return;
  const fam = { id: famSnap.id, ...famSnap.data() } as Family;
  const codes = await ensureInviteCodes(fam);
  const next: InviteCodeState = {
    ...codes[role],
    active: false,
    usedAt: Timestamp.now(),
  };
  await updateDoc(doc(db, 'families', familyId), {
    [`inviteCodes.${role}`]: next,
  });
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
// Routine ratings credit `routinePoints` (a fine-grained accumulator)
// rather than `totalPoints` directly. The family-configured conversion
// rate (default 100 RP → 1 HP) folds them into house points once the
// threshold is reached. Mirrors the kudos / improvement-note pattern.
//
// Pre-2026-05-16 behaviour credited `totalPoints` directly — that's fine
// for legacy data; new writes go through the accumulator.

// Shared helper — given a child's pre-update state and the routine points
// from this rating, returns the updates to apply (routinePoints,
// totalPoints, weeklyPoints) such that every full block of
// `pointsPerHousePoint` routine points converts to 1 house point.
// `creditWeekly` controls whether the converted house points should also
// hit weeklyPoints (true for live ratings; false for historical imports
// dated outside the current week).
function computeRoutineRatingUpdates(
  child: Child,
  earned: number,
  pointsPerHousePoint: number,
  creditWeekly: boolean,
): Record<string, unknown> {
  const ppHP = Math.max(1, pointsPerHousePoint);
  const current = child.routinePoints || 0;
  const next = current + earned;
  const housePointsGained = Math.floor(next / ppHP);
  const carryover = next - housePointsGained * ppHP;
  const updates: Record<string, unknown> = { routinePoints: carryover };
  if (housePointsGained > 0) {
    updates.totalPoints = (child.totalPoints || 0) + housePointsGained;
    if (creditWeekly) updates.weeklyPoints = (child.weeklyPoints || 0) + housePointsGained;
  }
  return updates;
}

export async function submitRating(familyId: string, rating: Omit<DailyRating, 'id'>) {
  if (isGuestActive()) return 'guest-rating';
  // Strip undefined fields — Firestore rejects them, and `comment` is optional.
  const payload: Record<string, unknown> = { ...rating, createdAt: serverTimestamp() };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  const ref = await addDoc(collection(db, 'families', familyId, 'ratings'), payload);

  // Credit routinePoints; the conversion rule folds them into totalPoints
  // every `pointsPerHousePoint` worth of routine points.
  const family = await getFamily(familyId);
  const cfg = readPointSystemConfig(family);
  const childRef = doc(db, 'families', familyId, 'children', rating.childId);
  const childSnap = await getDoc(childRef);
  if (childSnap.exists()) {
    const child = childSnap.data() as Child;
    const updates = computeRoutineRatingUpdates(
      child,
      rating.totalPoints,
      cfg.routines.pointsPerHousePoint,
      true,
    );
    await updateDoc(childRef, updates);
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

  // Apply the delta through the routine-points accumulator so historical
  // imports respect the same conversion rate. Weekly only credits if the
  // date is within the current week (a 6-month backfill shouldn't inflate
  // this week's leaderboard).
  const childRef = doc(db, 'families', familyId, 'children', rating.childId);
  const childSnap = await getDoc(childRef);
  if (childSnap.exists()) {
    const child = childSnap.data() as Child;
    const family = await getFamily(familyId);
    const cfg = readPointSystemConfig(family);
    const inThisWeek = isInCurrentWeek(rating.date);
    if (delta !== 0) {
      const updates = computeRoutineRatingUpdates(
        child,
        delta,
        cfg.routines.pointsPerHousePoint,
        inThisWeek,
      );
      await updateDoc(childRef, updates);
    }
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

// Inclusive YYYY-MM-DD range query for DailyRating docs. Used by the
// Family Meeting presenter to fetch every rating between two dates.
export async function getRatingsInDateRange(
  familyId: string,
  fromDate: string,
  toDate: string,
): Promise<DailyRating[]> {
  if (isGuestActive()) {
    return MOCK_RATINGS.filter((r) => r.date >= fromDate && r.date <= toDate);
  }
  const q = query(
    collection(db, 'families', familyId, 'ratings'),
    where('date', '>=', fromDate),
    where('date', '<=', toDate),
    orderBy('date', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as DailyRating));
}

// ── Award Operations ──────────────────────────────
// Result shape — when the threshold accumulator fires a derived bonus or
// deduction, the caller learns the derived award's id so the UI can
// reference both ("You earned a +1 from 4 Kudos!" toast, etc.).
export interface GiveAwardResult {
  id: string;
  derivedAwardId?: string;
  derivedKind?: AwardKind;
  derivedPoints?: number;
}

export async function giveAward(
  familyId: string,
  award: Omit<Award, 'id' | 'createdAt'>,
): Promise<GiveAwardResult> {
  if (isGuestActive()) return { id: 'guest-award' };

  // Strip undefined optional fields — Firestore rejects them.
  const payload: Record<string, unknown> = { ...award, createdAt: serverTimestamp() };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

  const ref = await addDoc(collection(db, 'families', familyId, 'awards'), payload);

  const childRef = doc(db, 'families', familyId, 'children', award.childId);
  const childSnap = await getDoc(childRef);
  if (!childSnap.exists()) return { id: ref.id };
  const child = childSnap.data() as Child;

  // Point-bearing kinds update running totals directly. Negative `points`
  // for `reducing` just flows through the same math.
  if (award.kind === 'regular' || award.kind === 'diamond' || award.kind === 'reducing') {
    await updateDoc(childRef, {
      totalPoints: (child.totalPoints || 0) + award.points,
      weeklyPoints: (child.weeklyPoints || 0) + award.points,
    });
    return { id: ref.id };
  }

  // Zero-point kinds: increment the accumulator, and if the threshold is
  // reached, fire a derived award + decrement the counter by the threshold.
  if (award.kind === 'kudos' || award.kind === 'improvement_note') {
    const family = await getFamily(familyId);
    const config = readPointSystemConfig(family);
    const isKudos = award.kind === 'kudos';
    const counterField = isKudos ? 'kudosCount' : 'improvementNoteCount';
    const setting = isKudos ? config.kudos : config.improvementNote;
    const currentCount = ((child as unknown as Record<string, unknown>)[counterField] as number) || 0;
    const newCount = currentCount + 1;

    // If the family has disabled this kind, just store the event silently —
    // no counter advance, no derived award. The raw award stays in history
    // so re-enabling later doesn't lose the record.
    if (!setting.enabled) {
      return { id: ref.id };
    }

    // Threshold not yet reached — just bump the counter.
    if (newCount < setting.threshold) {
      await updateDoc(childRef, { [counterField]: newCount });
      return { id: ref.id };
    }

    // Threshold reached. Compute the derived award.
    //   Kudos      → +bonusPoints as a 'regular' award.
    //   Improvement → −deductionPoints as a 'reducing' award, but only
    //                 if reducing is enabled family-wide. If reducing is
    //                 off, the counter still advances (so parents can see
    //                 it in setup), but no point penalty is applied.
    const willFireDerived = isKudos || (config.reducing.enabled && !isKudos);
    if (!willFireDerived) {
      // Counter rolled over but reducing is off — reset modulo, no points.
      await updateDoc(childRef, { [counterField]: newCount - setting.threshold });
      return { id: ref.id };
    }

    const derivedKind: AwardKind = isKudos ? 'regular' : 'reducing';
    const derivedPoints = isKudos
      ? config.kudos.bonusPoints
      : -config.improvementNote.deductionPoints;

    const derivedRef = await addDoc(collection(db, 'families', familyId, 'awards'), {
      childId: award.childId,
      kind: derivedKind,
      points: derivedPoints,
      reason: `Auto: ${setting.threshold}× ${setting.label} reached`,
      category: 'other',
      awardedBy: 'system',
      awardedByName: 'Kaya',
      derivedFrom: { kind: award.kind, sourceAwardIds: [ref.id] },
      createdAt: serverTimestamp(),
    });

    await updateDoc(childRef, {
      [counterField]: newCount - setting.threshold,
      totalPoints: (child.totalPoints || 0) + derivedPoints,
      weeklyPoints: (child.weeklyPoints || 0) + derivedPoints,
    });

    return {
      id: ref.id,
      derivedAwardId: derivedRef.id,
      derivedKind,
      derivedPoints,
    };
  }

  // Unknown kind — write but don't touch counters. Defensive.
  return { id: ref.id };
}

// Kid → kid appreciation note. Wraps `giveAward` with a kudos payload
// and an app-layer rate-limit so a kid can't spam siblings. The Firestore
// rule allows the underlying create as long as senderRole === 'kid' and
// the family has `kudos.kidToKidEnabled` on — but the rule doesn't enforce
// the daily cap (would require a counter doc + composite index just for
// rate-limiting). Trust-but-check here is fine: a kid client tampering
// past the cap would still be visible to parents in the activity feed.
//
// Throws on:
//   - Feature disabled at the family level
//   - Daily cap reached
//   - Self-kudos (recipient == sender)
//   - Missing sender child doc
export async function sendKidKudos(
  familyId: string,
  senderChildId: string,
  senderUid: string,
  senderName: string,
  recipientChildId: string,
  reason: string,
  category: string,
): Promise<GiveAwardResult> {
  if (senderChildId === recipientChildId) {
    throw new Error("You can't send appreciation to yourself.");
  }

  const family = await getFamily(familyId);
  const config = readPointSystemConfig(family);
  if (!config.kudos.kidToKidEnabled) {
    throw new Error('Kid appreciation notes are not enabled for this family.');
  }
  const cap = config.kudos.kidDailyCap ?? 3;

  const senderRef = doc(db, 'families', familyId, 'children', senderChildId);
  const senderSnap = await getDoc(senderRef);
  if (!senderSnap.exists()) {
    throw new Error('Sender profile not found.');
  }
  const sender = senderSnap.data() as Child;

  const today = new Date().toISOString().slice(0, 10);
  const sameDay = sender.dailyKudosSentDate === today;
  const todayCount = sameDay ? (sender.dailyKudosSentCount ?? 0) : 0;
  if (todayCount >= cap) {
    throw new Error(
      `You've already sent ${cap} appreciation${cap === 1 ? '' : 's'} today. Try again tomorrow!`
    );
  }

  const result = await giveAward(familyId, {
    childId: recipientChildId,
    kind: 'kudos',
    points: 0,
    reason,
    category,
    awardedBy: senderUid,
    awardedByName: senderName,
    senderRole: 'kid',
  });

  // Bump the sender's per-day counter. Reset implicitly: writing today's
  // date overwrites yesterday's, and the count starts at todayCount + 1
  // (which is 1 on the first send of a new day).
  await updateDoc(senderRef, {
    dailyKudosSentDate: today,
    dailyKudosSentCount: todayCount + 1,
  });

  return result;
}

// Historical import path — used by the one-time Excel/Sheet importer in
// Phase 2. Differs from `giveAward` in two ways:
//   1. Caller supplies an explicit `createdAt` (so awards land at the
//      event's actual date, not `now()`).
//   2. `weeklyPoints` is only credited when `createdAt` falls in the
//      current ISO week — back-filling six months of history shouldn't
//      inflate this week's leaderboard.
// The threshold accumulator still runs (chronological replay matches the
// design intent), so importing 8 Kudos with threshold=4 fires 2 derived
// bonuses backdated to the relevant source events. Callers must import in
// chronological order for the replay to be accurate.
export async function importAward(
  familyId: string,
  award: Omit<Award, 'id'> & { createdAt: Timestamp },
): Promise<GiveAwardResult> {
  if (isGuestActive()) return { id: 'guest-import-award' };

  const payload: Record<string, unknown> = { ...award };
  Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
  const ref = await addDoc(collection(db, 'families', familyId, 'awards'), payload);

  const childRef = doc(db, 'families', familyId, 'children', award.childId);
  const childSnap = await getDoc(childRef);
  if (!childSnap.exists()) return { id: ref.id };
  const child = childSnap.data() as Child;

  const eventDateStr = award.createdAt.toDate().toISOString().slice(0, 10);
  const creditWeekly = isInCurrentWeek(eventDateStr);

  if (award.kind === 'regular' || award.kind === 'diamond' || award.kind === 'reducing') {
    await updateDoc(childRef, {
      totalPoints: (child.totalPoints || 0) + award.points,
      ...(creditWeekly ? { weeklyPoints: (child.weeklyPoints || 0) + award.points } : {}),
    });
    return { id: ref.id };
  }

  if (award.kind === 'kudos' || award.kind === 'improvement_note') {
    const family = await getFamily(familyId);
    const config = readPointSystemConfig(family);
    const isKudos = award.kind === 'kudos';
    const counterField = isKudos ? 'kudosCount' : 'improvementNoteCount';
    const setting = isKudos ? config.kudos : config.improvementNote;
    const currentCount = ((child as unknown as Record<string, unknown>)[counterField] as number) || 0;
    const newCount = currentCount + 1;

    if (!setting.enabled) return { id: ref.id };

    if (newCount < setting.threshold) {
      await updateDoc(childRef, { [counterField]: newCount });
      return { id: ref.id };
    }

    const willFireDerived = isKudos || (config.reducing.enabled && !isKudos);
    if (!willFireDerived) {
      await updateDoc(childRef, { [counterField]: newCount - setting.threshold });
      return { id: ref.id };
    }

    const derivedKind: AwardKind = isKudos ? 'regular' : 'reducing';
    const derivedPoints = isKudos
      ? config.kudos.bonusPoints
      : -config.improvementNote.deductionPoints;

    const derivedRef = await addDoc(collection(db, 'families', familyId, 'awards'), {
      childId: award.childId,
      kind: derivedKind,
      points: derivedPoints,
      reason: `Auto: ${setting.threshold}× ${setting.label} reached`,
      category: 'other',
      awardedBy: 'system',
      awardedByName: 'Kaya',
      derivedFrom: { kind: award.kind, sourceAwardIds: [ref.id] },
      importSource: award.importSource,
      // Backdate the derived award to the source's date so the timeline
      // reads correctly when scrolled.
      createdAt: award.createdAt,
    });

    await updateDoc(childRef, {
      [counterField]: newCount - setting.threshold,
      totalPoints: (child.totalPoints || 0) + derivedPoints,
      ...(creditWeekly ? { weeklyPoints: (child.weeklyPoints || 0) + derivedPoints } : {}),
    });

    return { id: ref.id, derivedAwardId: derivedRef.id, derivedKind, derivedPoints };
  }

  return { id: ref.id };
}

export async function getRecentAwards(familyId: string, days: number = 7): Promise<Award[]> {
  if (isGuestActive()) return MOCK_AWARDS;
  // Filter by `createdAt >= (today - days)` so callers asking for the
  // last 30 days see the full set, not just the freshest 20. For
  // "lifetime" callers pass a very large number (e.g. 9999) — there's
  // no special-case path because Firestore's `>=` against an old date
  // returns everything cheaply.
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceTs = Timestamp.fromDate(since);
  const q = query(
    collection(db, 'families', familyId, 'awards'),
    where('createdAt', '>=', sinceTs),
    orderBy('createdAt', 'desc'),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as Award));
}

// Inclusive YYYY-MM-DD range query over `createdAt` for Award docs.
// Used by the Family Meeting presenter to sum award points in a window.
export async function getAwardsInDateRange(
  familyId: string,
  fromDate: string,
  toDate: string,
): Promise<Award[]> {
  const fromTs = Timestamp.fromDate(new Date(`${fromDate}T00:00:00.000Z`));
  const toTs = Timestamp.fromDate(new Date(`${toDate}T23:59:59.999Z`));
  if (isGuestActive()) {
    return MOCK_AWARDS.filter((a) => {
      const ms = a.createdAt?.toMillis?.();
      if (typeof ms !== 'number') return false;
      return ms >= fromTs.toMillis() && ms <= toTs.toMillis();
    });
  }
  const q = query(
    collection(db, 'families', familyId, 'awards'),
    where('createdAt', '>=', fromTs),
    where('createdAt', '<=', toTs),
    orderBy('createdAt', 'desc'),
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
