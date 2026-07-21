// Kaya Sparks · canonical data shapes.
//
// Five capture areas + workplan tasks + ratings + academic records +
// AI companion state, per child. Persisted under
// `/families/{familyId}/sparks_*` (see firestore.rules for the access
// model). Slice 1 (2026-05-27) ships the types + the profile doc;
// item / academic / task / rating writes start in Slice 2.

import type { Timestamp } from 'firebase/firestore';
import type { DayOfWeek } from '../firestore';

/** The six areas surfaced on /sparks. `academic` is its OWN collection
 *  (`sparks_academic`) — every other area lives in `sparks_items` keyed
 *  by `area`. `revision` (added 2026-05-28) is the new practice-engine
 *  area: kid uploads a homework revision, Claude scores it, AI suggests
 *  next questions, parent reviews + awards points. */
export type SparksArea =
  | 'school_project'
  | 'home_project'
  | 'achievement'
  | 'sports_subscription'
  | 'academic'
  | 'revision'
  | 'reflection'
  | 'diary';

/** Areas that map to a row in `sparks_items`. Academic records have
 *  their own collection, so they're absent here. Revisions ride the
 *  same `sparks_items` row but carry a richer `revision_data` payload.
 *  Reflection has its own daily collection too (see reflection.ts).
 *  Diary (Slice 8 · 2026-07-21) lives in `sparks_diary`, read/written
 *  ONLY through the Admin-API gateway — never client-direct. */
export type SparksItemArea = Exclude<SparksArea, 'academic' | 'reflection' | 'diary'>;

/** Order + presentation metadata for the 5 area cards on the kid's
 *  Sparks home. The dashboard + setup pages also import this so labels
 *  stay in lockstep with the rules + types. */
export const SPARKS_AREA_META: Record<SparksArea, {
  key: SparksArea;
  label: string;
  shortLabel: string;
  emoji: string;
  description: string;
  /** Sub-path under `/sparks/[kidId]/` for the area's list page. */
  path: 'school-projects' | 'home-projects' | 'achievements' | 'academic' | 'sports' | 'revisions' | 'reflection' | 'diary';
}> = {
  school_project: {
    key: 'school_project',
    label: 'School Projects',
    shortLabel: 'School',
    emoji: '🎒',
    description: 'Photos, descriptions, and dates of every school project.',
    path: 'school-projects',
  },
  home_project: {
    key: 'home_project',
    label: 'Home Projects',
    shortLabel: 'Home',
    emoji: '🛠',
    description: 'Builds, art, crafts. Optionally rated and wired to the workplan.',
    path: 'home-projects',
  },
  achievement: {
    key: 'achievement',
    label: 'Achievements',
    shortLabel: 'Awards',
    emoji: '🏅',
    description: 'Certificates, medals, awards — captured and OCR-scanned.',
    path: 'achievements',
  },
  academic: {
    key: 'academic',
    label: 'Academic & PTM',
    shortLabel: 'Academic',
    emoji: '📚',
    description: 'Per-term grades, behaviour notes, parent-teacher follow-ups.',
    path: 'academic',
  },
  sports_subscription: {
    key: 'sports_subscription',
    label: 'Sports & Activities',
    shortLabel: 'Sports',
    emoji: '⚽',
    description: 'Active subscriptions, coaches, fees, attendance, expiry alerts.',
    path: 'sports',
  },
  revision: {
    key: 'revision',
    label: 'Home Revisions',
    shortLabel: 'Revise',
    emoji: '🎯',
    description: 'Practice loop · AI reads + scores + suggests next questions · earn Kaya Points.',
    path: 'revisions',
  },
  reflection: {
    key: 'reflection',
    label: 'Daily Reflection',
    shortLabel: 'Reflect',
    emoji: '🪞',
    description: 'Write by hand + scan how your day went · AI gives warm, structured feedback · build a daily streak.',
    path: 'reflection',
  },
  diary: {
    key: 'diary',
    label: 'My Diary',
    shortLabel: 'Diary',
    emoji: '📔',
    description: 'Your personal book · feelings, stories, dreams · shared with your parents, locked when you need it.',
    path: 'diary',
  },
};

/** Canonical area order used everywhere a tile grid renders. */
export const SPARKS_AREA_ORDER: SparksArea[] = [
  'school_project',
  'home_project',
  'revision',
  'reflection',
  'diary',
  'achievement',
  'academic',
  'sports_subscription',
];

// ── Profile ────────────────────────────────────────────────────────────
//
// One doc per kid (id = kidId) at /families/{f}/sparks_profiles/{kidId}.
// Holds the configurable subjects list, the sibling-visibility setting,
// and the per-area AI highlight toggles. Created lazily on first use.

export type SparksSiblingVisibility = 'open' | 'independent' | 'per_area';

export interface SparksProfile {
  /** Kid's configurable subjects list — drives the dropdown on
   *  /sparks/[kidId]/school-projects and the /sparks/[kidId]/academic
   *  term form. Surface order = display order; no implicit sort. */
  subjects?: Array<{ name: string; addedAt: Timestamp | null }>;
  /** Sibling-read policy applied by firestore.rules (see the
   *  `sparks_items` / `sparks_academic` matches). Default 'open' when
   *  the doc is missing. */
  sibling_visibility?: SparksSiblingVisibility;
  /** Per-area open/closed bits when `sibling_visibility === 'per_area'`.
   *  Unset areas implicitly default to closed in that mode. */
  per_area?: Partial<Record<SparksItemArea, boolean>>;
  /** AI pre-submission highlights configuration. Slice 4 reads this
   *  before invoking the Cloud Function — keeps the rule of "AI
   *  suggests, parent decides" easy to flip per-task-type. */
  ai_highlights_enabled_for?: {
    handwriting?: boolean;
    homework?: boolean;
    art?: boolean;
  };
  /** Home Revisions knobs (Slice 7 / 2026-05-28). Per-kid because
   *  qualifying bars + point values differ by age. Defaults in
   *  DEFAULT_REVISION_SETTINGS apply when this is absent. */
  revision_settings?: RevisionSettings;
  /** Daily Reflection knobs (2026-06-07). Scan (handwriting) is always
   *  on; parents opt-in typing and pick which weekdays typing is allowed.
   *  Defaults in DEFAULT_REFLECTION_SETTINGS apply when absent. */
  reflection_settings?: ReflectionSettings;
  /** Slice 7m · per-kid reminder + parent-miss-alert knobs. Drives the
   *  hourly /api/cron/sparks-reflection-reminders sweep. Defaults in
   *  DEFAULT_REFLECTION_REMINDERS apply when absent. */
  reflection_reminders?: ReflectionReminderSettings;
  /** Slice 7n · reflection streak rewards (Kaya Points on milestones).
   *  Defaults in DEFAULT_REFLECTION_STREAK_REWARDS apply when absent. */
  reflection_streak?: ReflectionStreakRewards;
  /** Slice 8f · 💌 Dear Kaya parent toggle (default ON when absent).
   *  OFF hides the option in the kid's composer AND the reply route
   *  refuses. */
  diary_dear_kaya?: boolean;
  /** Slice 7q · per-parent email-alert preferences for this kid's
   *  submissions. Keyed by parentUid; absent parent → no emails.
   *  Defaults in DEFAULT_EMAIL_ALERTS apply when absent. */
  email_alerts?: Record<string, EmailAlertSettings>;
  updatedAt?: Timestamp;
  updatedBy?: string; // uid
}

// ── Daily Reflection settings (parent-controlled, per kid) ──────────────
//
// Scan-first by design: a kid writes their reflection BY HAND and scans it
// (AI reads the handwriting). Typing is a secondary path the parent gates —
// off by default, and when on, allowed only on the weekdays they pick (e.g.
// scan-only on school days to build the handwriting habit; typing on
// weekends). See reflection.ts for the daily entry + streak model.
export interface ReflectionSettings {
  /** Master switch for the typed-entry option. false = scan-only. */
  typing_allowed: boolean;
  /** When typing_allowed, the weekdays typing is offered. Empty = none.
   *  Days not listed show scan-only even when typing_allowed is true. */
  typing_days: DayOfWeek[];
}

export const DEFAULT_REFLECTION_SETTINGS: ReflectionSettings = {
  typing_allowed: false,
  typing_days: [],
};

// ── Slice 7m · Daily Reflection reminders + parent miss alert ───────
//
// Per-kid knobs that drive the hourly cron sweep:
//   - kid_reminders_enabled · push + in-app at the picked hour, only on
//     active days, only when today's reflection is still missing.
//   - parent_alert_enabled · push + email to the parents after N
//     consecutive missed (active) days.
//   - active_days · which weekdays count (default school days · Mon-Fri).
//
// Defaults: kid reminders OFF, parent alerts OFF. Opt-in by the parent.
export interface ReflectionReminderSettings {
  kid_reminders_enabled: boolean;
  /** Local-day hour (0–23) the kid reminder fires when today's reflection
   *  hasn't landed yet. Default 19 (7pm school-evening). */
  kid_reminder_hour: number;
  /** Local-day minute the kid reminder fires (0 or 30 in the picker). */
  kid_reminder_minute: 0 | 30;
  /** Weekdays the reminders + miss-counter are active. Empty = inactive
   *  but kept in the doc. Default = Mon–Fri (school days). */
  active_days: DayOfWeek[];
  parent_alert_enabled: boolean;
  /** Consecutive missed ACTIVE days that trigger the parent alert.
   *  Default 3. Active days outside the mask never count as misses. */
  parent_alert_after_n_days: number;
}

// ── Slice 7n · Daily Reflection streak rewards ──────────────────────
//
// Parent-set milestones that award Kaya Points when the kid hits a
// streak length. Re-earnable per cycle: if the streak breaks and the
// kid re-hits the same milestone, they earn the points again (idempotent
// against same calendar day only — award_history prevents double-fire
// when the streak holds and the page re-renders).

export interface ReflectionStreakMilestone {
  /** Number of consecutive active days needed. */
  days: number;
  /** Kaya Points granted on hit. */
  points: number;
  /** Short label shown in the award message + setup card. */
  label: string;
}

export interface ReflectionStreakAward {
  /** Which milestone (days) was awarded. */
  days: number;
  /** Local-day key the milestone fired (YYYY-MM-DD). */
  awarded_on: string;
}

/** 2026-06-23 · A milestone hit waiting for a parent to confirm/adjust the
 *  points (approval mode). Cleared once approved or skipped. */
export interface ReflectionStreakPending {
  days: number;
  /** Suggested points (the milestone's value); parent may nudge ±cap. */
  points: number;
  label: string;
  /** Local-day key the milestone was hit (YYYY-MM-DD). */
  suggested_on: string;
}

/** How streak-milestone points are granted.
 *   'auto'     → fire immediately on hit (legacy behaviour).
 *   'approval' → queue a pending reward the parent confirms/adjusts. */
export type ReflectionStreakAwardMode = 'auto' | 'approval';

export interface ReflectionStreakRewards {
  enabled: boolean;
  milestones: ReflectionStreakMilestone[];
  award_history: ReflectionStreakAward[];
  /** 2026-06-23 · default 'approval' (parent confirms) when unset. */
  award_mode?: ReflectionStreakAwardMode;
  /** How far (±) a parent may nudge the suggested points on approval.
   *  Default 5. 0 locks the suggestion. */
  points_override_cap?: number;
  /** Milestone hits awaiting parent confirmation (approval mode). */
  pending?: ReflectionStreakPending[];
}

// ── Slice 7o · Daily Reflection · weekly review ─────────────────────
//
// ── Slice 7q · Parent email alerts (per-parent, per-area) ──────────
//
// Each parent picks instant / daily-digest / off for each Sparks area
// independently of the other parent. Quiet hours queue instant emails
// to the next allowed slot — never silenced.

export type EmailAlertFrequency = 'off' | 'instant' | 'digest';

/** All Sparks surfaces that can fire a parent alert. */
export type EmailAlertArea =
  | 'reflection'
  | 'revision'
  | 'school_project'
  | 'home_project'
  | 'achievement';

export interface EmailAlertSettings {
  areas: Record<EmailAlertArea, EmailAlertFrequency>;
  /** Hour-of-day the daily digest fires (local TZ). Default 6 (= 06:30 with minute=30). */
  digest_hour: number;
  digest_minute: 0 | 30;
  /** Quiet-hours window. Instant emails queue until quiet_end. */
  quiet_start: number; // hour 0-23 · default 22
  quiet_end:   number; // hour 0-23 · default 6
}

export const DEFAULT_EMAIL_ALERTS: EmailAlertSettings = {
  areas: {
    reflection: 'off',
    revision: 'off',
    school_project: 'off',
    home_project: 'off',
    achievement: 'off',
  },
  digest_hour: 6,
  digest_minute: 30,
  quiet_start: 22,
  quiet_end: 6,
};

// Sunday cron generates one summary per kid from the past 7 days of
// reflections. Persisted at
//   /families/{f}/sparks_reflection_weeks/{kidId}_{YYYY-WW}
// Shape matches the JSON Schema in /api/sparks/ai/reflection-week.

export interface ReflectionWeekTheme  { label: string; emoji: string; count: number }
export interface ReflectionWeekHighlight { date: string; quote: string }
export interface ReflectionWeekMood   { date: string; emoji: string }

export interface ReflectionWeekReview {
  kidId: string;
  /** YYYY-WW (ISO-week-ish, computed in TZ-local time). */
  weekKey: string;
  /** First + last day in the week (YYYY-MM-DD), inclusive. */
  weekStart: string;
  weekEnd: string;
  /** Number of days the kid actually logged in the window. */
  loggedDays: number;
  /** Streak count at the moment the cron generated this review. */
  streakAtGen: number;
  themes: ReflectionWeekTheme[];
  highlights: ReflectionWeekHighlight[];
  mood_by_day: ReflectionWeekMood[];
  mood_summary: string;
  tip: string;
  /** Short headline a parent sees first in their email digest. */
  highlight_for_parent: string;
  /** Server timestamp written by the cron. */
  generatedAt: Timestamp;
}

export const DEFAULT_REFLECTION_STREAK_REWARDS: ReflectionStreakRewards = {
  enabled: true,
  milestones: [
    { days: 3,  points: 5,  label: 'Spark streak' },
    { days: 7,  points: 15, label: 'Week strong' },
    { days: 14, points: 30, label: 'Two-week climber' },
    { days: 30, points: 75, label: 'Month of mirrors' },
  ],
  award_history: [],
  award_mode: 'approval',
  points_override_cap: 5,
  pending: [],
};

export const DEFAULT_REFLECTION_REMINDERS: ReflectionReminderSettings = {
  kid_reminders_enabled: false,
  kid_reminder_hour: 19,
  kid_reminder_minute: 0,
  active_days: ['mon', 'tue', 'wed', 'thu', 'fri'],
  parent_alert_enabled: false,
  parent_alert_after_n_days: 3,
};

// ── Item ───────────────────────────────────────────────────────────────
//
// One doc per capture in /families/{f}/sparks_items/{itemId}. Used by
// the four non-academic areas. `subject` is meaningful only for
// school_project entries; everything else can leave it undefined.

export interface SparksItem {
  id: string;
  kid_id: string;
  area: SparksItemArea;
  title: string;
  description?: string;
  /** Storage URLs (already-resized variants live alongside). At least
   *  one is required when the area is school_project / home_project /
   *  achievement. sports_subscription rows usually have 0–1. */
  photo_urls: string[];
  /** Optional question paper / worksheet pages, kept SEPARATE from the
   *  answer photo_urls so the AI can mark against the real questions.
   *  Attachable ANYTIME by a parent OR the kid — before, with, or after the
   *  answers (Scanning 2.0 · 2026-06-07). */
  question_paper_urls?: string[];
  /** Calendar date this item belongs to (the project / certificate /
   *  subscription start). Stored as DD-MMM-YYYY-friendly YYYY-MM-DD
   *  per the project's date-format rule (`toDisplayDate`). */
  date: string; // YYYY-MM-DD
  subject?: string; // school_project only
  /** Pre-submission AI / OCR output. `auto_extracted` is whatever the
   *  scan returned; `parent_confirmed` flips true once a parent accepts
   *  (or edits) the extraction. Slice 4 owns this — Slice 1 keeps the
   *  field optional. */
  ai_labels?: {
    auto_extracted?: Record<string, unknown>;
    parent_confirmed?: boolean;
  };
  tags?: string[];
  /** Sports-specific — only set when `area === 'sports_subscription'`.
   *  Drives the row's progress bar + the "+ Session" counter (Slice 3b). */
  sessions?: {
    attended: number;
    planned?: number;
  };
  /** Sports-specific — the club / academy / coach the kid trains
   *  under. Optional so existing rows don't need a backfill; new
   *  uploads + edits surface it on the card and in the edit sheet. */
  club_name?: string;
  /** Sports-specific — whether the activity is school-run or
   *  external. Shown as a chip on the card so a parent can scan the
   *  feed at a glance. */
  source?: 'school' | 'outside';
  /** @deprecated 2026-05-28 — manual highlight pinning was replaced
   *  by deterministic daily-random picks (`pickDailyHighlights`). The
   *  field stays on the type so existing legacy rows still validate;
   *  no new code reads or writes it. */
  is_highlight?: boolean;
  /** Revision-specific — only set when `area === 'revision'`. Carries
   *  the AI score snapshot + the next-question suggestions Claude
   *  generated at submit time so the kid + parent can see the loop
   *  in the list view. Parent approval / points award flow gates on
   *  this payload + the family's RevisionSettings. */
  revision_data?: {
    /** What the kid uploaded (Slice 7c · 2026-05-28).
     *    'answers'   → completed work; AI scores it.
     *    'questions' → the worksheet page; AI lists the questions
     *                  it could read + generates 3 practice ones.
     *  Absent on legacy rows = treat as 'answers'. */
    upload_mode?: 'answers' | 'questions';
    /** AI's first guess at the subject before the kid confirmed. */
    ai_subject?: string;
    /** Final subject — what the kid confirmed (or corrected). */
    subject?: string;
    grade_level?: string;       // 'Grade 4', etc.
    /** True when the kid explicitly accepted or edited ai_subject. */
    subject_confirmed?: boolean;
    ai_score?: number;          // 0-100 overall % (answers mode only)
    ai_breakdown?: { correct: number; partial: number; wrong: number };
    ai_notes?: string;          // short "why" explanation for the kid
    /** Questions Claude PARSED from the uploaded worksheet page
     *  (questions mode only). */
    parsed_questions?: string[];
    next_questions?: string[];  // 3 practice follow-ups (both modes)
    round?: number;             // round counter for this kid + subject
    /** When parent reviews + approves a qualifying revision, this flips
     *  true so we don't double-award points on re-rate. Server-side
     *  gate when the awards collection write happens. */
    points_awarded?: boolean;
    /** Slice 7i · structured per-question breakdown returned by
     *  /api/sparks/ai/revision-score. Renders as Strengths / Areas to
     *  revisit / full Q-by-Q grid on the revisions list. Legacy
     *  `ai_notes` string stays as a fallback summary for older rows. */
    ai_breakdown_structured?: {
      coverage: { read: number; total: number };
      strengths: string[];
      areas: Array<{
        question_ref?: string;
        topic: string;
        what_happened: string;
        tip?: string;
      }>;
      qbq: Array<{
        question_ref: string;
        topic: string;
        status: 'correct' | 'partial' | 'wrong';
      }>;
    };
  };
  created_at: Timestamp;
  updated_at: Timestamp;
  created_by: string; // uid (parent / helper / kid)
}

/** Parent-set knobs for the Home Revisions area. Persisted at
 *  `families/{f}/sparks_profiles/{kidId}.revision_settings` so they're
 *  per-kid (older kids might have a higher qualifying bar). Defaults
 *  apply when the field is absent. */
export interface RevisionSettings {
  /** Base Kaya Points awarded when a revision qualifies. */
  base_points?: number;             // default 15
  /** Bonus points when AI score ≥ bonus_threshold. */
  bonus_points?: number;            // default 30
  /** Score (0-100) at which a revision qualifies for points. */
  qualifying_score?: number;        // default 60
  /** Score (0-100) at which the bonus tier kicks in. */
  bonus_threshold?: number;         // default 90
  /** Fire confetti animation on qualifying submit. */
  celebration_enabled?: boolean;    // default true
  /** When true, points are pending until the parent rates + approves. */
  parent_approval_required?: boolean; // default true
  /** When true, the "next 3 questions" auto-opens in a print view. */
  auto_print_next?: boolean;        // default false
  /** Subjects AI prioritises for next-question generation. Falls back
   *  to sparks_profiles.subjects when unset. */
  focus_subjects?: string[];
  /** Slice 7f · how much the parent can nudge the auto-suggested points
   *  up or down (in either direction) when awarding. Default 5 → parent
   *  can override within ±5 of the tier suggestion. Set 0 to lock the
   *  suggestion. The award itself is still gated by `awardPoints` —
   *  this just controls the editable range when it's on. */
  points_override_cap?: number;
  /** Slice 7g · policy switch — controls whether the rate sheet shows
   *  the ± stepper at all. ON: parents can add/reduce per-revision
   *  within `points_override_cap`. OFF: the suggestion is locked in
   *  on every rate (no stepper, no nudging). Default true so existing
   *  Slice 7f behaviour is preserved. */
  allow_points_override?: boolean;
  /** Max AI re-evaluations a KID may request per revision (the chat where
   *  they clarify + ask the AI to re-score). Parents are never capped.
   *  Default 3. Set 0 to disable kid-initiated re-evals. */
  max_kid_reevals?: number;
}

export const DEFAULT_REVISION_SETTINGS: Required<Omit<RevisionSettings, 'focus_subjects'>> & { focus_subjects: string[] } = {
  base_points: 15,
  bonus_points: 30,
  qualifying_score: 60,
  bonus_threshold: 90,
  celebration_enabled: true,
  parent_approval_required: true,
  auto_print_next: false,
  focus_subjects: [],
  points_override_cap: 5,
  allow_points_override: true,
  max_kid_reevals: 3,
};

// ── Academic ───────────────────────────────────────────────────────────
//
// One doc per term per kid in /families/{f}/sparks_academic/{recordId}.
// Doc id convention: `${kid_id}_${year}_${term}` so back-fill writes
// idempotently overwrite the same row.

export type AcademicTerm = 'T1' | 'T2' | 'T3';

export interface SparksAcademicRecord {
  id: string;
  kid_id: string;
  term: AcademicTerm;
  year: number; // calendar year (2026, 2027, ...)
  subjects: Array<{
    name: string;
    grade?: string;
    percent?: number; // 0–100
    teacher_note?: string;
  }>;
  behavior_flags?: Array<{
    label: string;
    note?: string;
    addedAt: Timestamp;
  }>;
  ptm_notes?: string;
  follow_ups?: Array<{
    id: string;
    text: string;
    due_date?: string; // YYYY-MM-DD
    status: 'open' | 'closed';
    closed_at?: Timestamp;
    closed_by?: string; // uid
  }>;
  created_at: Timestamp;
  updated_at: Timestamp;
}

// ── Task ───────────────────────────────────────────────────────────────
//
// Workplan-wired task in /families/{f}/sparks_tasks/{taskId}. When a
// parent toggles "Wire to workplan" on a Sparks task, Slice 3 also
// writes a peer row to the existing workplan collection
// (see lib/sparks/taskBridge.ts in Slice 3) so the kid's daily plan
// surfaces it alongside chores.

export type SparksTaskSource =
  | 'home_project'
  | 'ptm_followup'
  | 'sports_session'
  | 'manual';

export type SparksTaskStatus =
  | 'pending'    // assigned, no submission yet
  | 'submitted'  // kid uploaded proof; awaits parent rating
  | 'rated'      // parent rated; task closed for the day
  | 'closed';    // archived (manual or auto)

export type SparksRatingMethod = 'star' | 'percent' | 'both' | 'custom' | 'none';

export type SparksRecurrence =
  | 'once'
  | 'daily'
  | 'weekly'
  | { custom: { everyDays: number } };

export interface SparksTask {
  id: string;
  kid_id: string;
  source: SparksTaskSource;
  title: string;
  description?: string;
  due_date: string; // YYYY-MM-DD
  recurrence: SparksRecurrence;
  photo_proof_required: boolean;
  rating_method: SparksRatingMethod;
  custom_scale?: { labels: string[] } | null;
  ai_highlights: boolean;
  status: SparksTaskStatus;
  submitted_photo_url?: string;
  submitted_at?: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** Optional back-pointer when the task came from a Sparks item
   *  (home_project), PTM follow-up (ptm_followup), or sports session
   *  (sports_session). Lets the Today view link back to the source. */
  source_id?: string;
}

// ── Rating ─────────────────────────────────────────────────────────────
//
// One doc per parent rating in /families/{f}/sparks_ratings/{ratingId}.
// At least one of stars / percent / custom_value is populated. The
// dashboard aggregates this by kid + date range.

export interface SparksRating {
  id: string;
  /** Set when the rating came from a workplan-wired sparks_task. Slice 3b
   *  wires this end-to-end; Slice 3 only fills in `item_id`. At least one
   *  of `task_id` / `item_id` must be set. */
  task_id?: string;
  /** Set when the parent rated a sparks_item directly (Slice 3 default).
   *  Lets the area pages render ⭐ + % on tiles without needing tasks. */
  item_id?: string;
  kid_id: string;
  date: string; // YYYY-MM-DD (the task's due_date, or the item's date)
  stars?: number;       // 1–5
  percent?: number;     // 0–100
  custom_value?: string;
  parent_id: string;    // uid
  notes?: string;
  created_at: Timestamp;
}

/** Which input(s) the RatingSheet exposes for a given rating. The
 *  resulting SparksRating doc populates only the fields enabled by
 *  the chosen mode (e.g. `stars` mode → only `stars` is set). */
export type SparksRatingMode = 'stars' | 'percent' | 'both' | 'custom';

// ── Revision thread (Slice 7e · 2026-05-28) ──────────────────────────
//
// Back-and-forth on a sparks_item (primarily revisions today, but the
// model is area-agnostic). Persisted at
// /families/{f}/sparks_items/{itemId}/thread/{messageId}.
// Reads + writes ride the rule block in firestore.rules · `thread/`.

export interface SparksThreadMessage {
  id: string;
  authorUid: string;
  authorName: string;
  authorRole: 'parent' | 'helper' | 'kid';
  text?: string;
  /** Storage download URLs (feed-size variants). Empty / undefined =
   *  text-only post. Photos ride the existing sparks photo storage
   *  path so no storage.rules change is needed. */
  photo_urls?: string[];
  /** Slice 7f · message intent. 'redo' messages carry AI rescore data
   *  so the kid + parent can see the improvement trail. Default
   *  'message' when absent (legacy rows). */
  kind?: 'message' | 'redo';
  /** Redo metadata — populated only when kind === 'redo'. */
  redo_score?: number;       // 0-100 overall %
  redo_breakdown?: { correct: number; partial: number; wrong: number };
  redo_notes?: string;       // short kid-readable "why"
  redo_round?: number;       // 1-indexed redo number (1 = first redo)
  createdAt: Timestamp;
}

// ── Companion ──────────────────────────────────────────────────────────
//
// Per-kid AI companion state at /sparks_companion_state/{kidId}.
// Written ONLY by the scheduled Cloud Function (Slice 5) via Admin SDK,
// which bypasses firestore.rules. Clients read.

export interface SparksCompanionState {
  nudges: Array<{
    id: string;
    title: string;
    body: string;
    /** UI hint — coral / green / gold / mint, drawn from the kid palette. */
    tone: 'celebrate' | 'remind' | 'suggest' | 'watch';
    /** Optional deep-link the nudge can route to. */
    href?: string;
    created_at: Timestamp;
  }>;
  last_refresh: Timestamp | null;
}
