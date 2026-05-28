// Kaya Sparks · canonical data shapes.
//
// Five capture areas + workplan tasks + ratings + academic records +
// AI companion state, per child. Persisted under
// `/families/{familyId}/sparks_*` (see firestore.rules for the access
// model). Slice 1 (2026-05-27) ships the types + the profile doc;
// item / academic / task / rating writes start in Slice 2.

import type { Timestamp } from 'firebase/firestore';

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
  | 'revision';

/** Areas that map to a row in `sparks_items`. Academic records have
 *  their own collection, so they're absent here. Revisions ride the
 *  same `sparks_items` row but carry a richer `revision_data` payload. */
export type SparksItemArea = Exclude<SparksArea, 'academic'>;

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
  path: 'school-projects' | 'home-projects' | 'achievements' | 'academic' | 'sports' | 'revisions';
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
};

/** Canonical area order used everywhere a tile grid renders. */
export const SPARKS_AREA_ORDER: SparksArea[] = [
  'school_project',
  'home_project',
  'revision',
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
  updatedAt?: Timestamp;
  updatedBy?: string; // uid
}

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
