// Kaya Sparks · Quests (9th area · 2026-08-15).
//
// A Quest is the FAMILY's learning agenda for one child: a goal, a
// pathway of dated Steps, Proof the kid captures, and Markers that
// measure real growth against a day-1 Baseline.
//
//   Quest → Pathway → Step (today) → Proof → Marker → Milestone → Graduation
//
// Locked logic (Kaya-Quests_AlignmentConcept_2026-08-15, D1–D18):
//   D1  9th Sparks area — same shell, same tiles. /sparks/[kidId]/quests
//   D3  GOAL-first setup. The honest starting point lives in a
//       PARENT-ONLY sub-document so it can never leak through a shared
//       screen, an export, or an AI reply (F7 · R6).
//   D4  The pathway is drafted ONCE and approved as one batch.
//   D8  Reflection: ATTACH, never overwrite.
//   D9  Progress = two independent tracks (consistency vs growth).
//   D10 Streaks are kind — shield · one-time repair · rest days · pause.
//   D12 Parents + the kid by default; per-quest promotion only.
//   D13 One action, one SERVER-minted award.
//   D14 Max 2 active quests per kid.
//   D18 Reuse over new.
//
// Storage — every collection below is reached ONLY through the Admin-API
// gateway at /api/sparks/quests. The client never touches them directly,
// which is what makes the parent-only note real AND what keeps this
// build at ZERO firestore.rules deploys (unlisted paths are default-deny):
//   /families/{f}/sparks_quests/{questId}
//   /families/{f}/sparks_quest_steps/{stepId}
//   /families/{f}/sparks_quest_markers/{readingId}
//   /families/{f}/sparks_quest_private/{questId}     ← parents only, ever
//
// Mirrors the diary.ts gateway + ping-bus pattern so pages get live-ish
// refresh without onSnapshot.

'use client';

import { auth } from '../firebase';
import { isGuestActive } from '../mockFamily';
import type { DayOfWeek } from '../firestore';

// ── Vocabulary (D2) ─────────────────────────────────────────────────

/** How hard the family wants this to be. Drives the AI pathway's step
 *  length + ramp, and nothing else — it is never shown as a judgement. */
export type QuestDifficulty = 'easy' | 'medium' | 'stretch';

export type QuestStatus = 'draft' | 'active' | 'paused' | 'graduated' | 'archived';

/** D12 · who can see this quest. Defaults to `private` (parents + the
 *  kid). The Sparks area-level sibling setting can only ever NARROW
 *  this, never widen it. */
export type QuestVisibility = 'private' | 'siblings' | 'family';

/** The four canonical pathway phases. Free-text is allowed on custom
 *  pathways; these are what the AI drafts and what the UI colours. */
export const QUEST_PHASES = ['Warm up', 'Shape', 'Stretch', 'Perform'] as const;
export type QuestPhase = typeof QUEST_PHASES[number] | string;

/** What a kid captures to prove a step happened. `note` is always
 *  allowed; the rest are media (D15 caps enforced at capture time). */
export type ProofKind = 'note' | 'photo' | 'scan' | 'audio' | 'video';

/** D15 · media caps. Audio-first for speech-shaped quests: it's the
 *  right medium AND the cheapest thing to ask for on a data bundle. */
export const PROOF_LIMITS = {
  audioSeconds: 60,
  videoSeconds: 45,
  /** Server-route body ceiling (Vercel). Capture guards against it so a
   *  kid gets a friendly "try audio" instead of a failed upload. */
  mediaBytes: 4 * 1024 * 1024,
} as const;

// ── Markers (D9 · F8) ───────────────────────────────────────────────

/** How a marker is measured.
 *   · rubric — 0-100 (the coral→green bar Reflection already uses)
 *   · stars  — a parent's 1-5 read
 *   · count  — anything countable (words/min, laps, bars played clean) */
export type MarkerKind = 'rubric' | 'stars' | 'count';

export interface QuestMarker {
  id: string;
  /** Kid-readable: "60-second self-intro — how clear?" */
  label: string;
  kind: MarkerKind;
  /** `count` only — "words / min", "push-ups". */
  unit?: string;
  /** `count` only — is a bigger number better? Default true. */
  higherIsBetter?: boolean;
  /** Optional target the family is aiming at. */
  target?: number;
  /** What the kid should capture when taking this marker. */
  proofKind?: ProofKind;
}

export interface MarkerReading {
  id: string;
  questId: string;
  kidId: string;
  markerId: string;
  value: number;
  /** ms epoch. */
  at: number;
  by: string;
  byName: string;
  /** The day-1 capture every later reading is compared against. */
  isBaseline?: boolean;
  proofUrl?: string;
  proofKind?: ProofKind;
  note?: string;
}

// ── Steps ───────────────────────────────────────────────────────────

export interface QuestStepProof {
  kind: ProofKind;
  url: string;
  at: number;
  /** audio/video only — clip length, so the UI can label it. */
  seconds?: number;
}

export interface QuestStep {
  id: string;
  questId: string;
  kidId: string;
  /** Planned LOCAL day (YYYY-MM-DD). Steps are dated up front (D4). */
  date: string;
  phase: QuestPhase;
  title: string;
  /** What to actually do — one or two plain sentences, kid voice. */
  how: string;
  minutes: number;
  /** The fun/serious mix Elia asked for, made explicit per step. */
  tone: 'fun' | 'serious';
  /** What proof this step is asking for (the kid may always add more). */
  proofKindWanted?: ProofKind;
  source: 'parent' | 'ai';
  /** Display order within the day (0 unless a day has several). */
  seq?: number;

  // ── completion ──
  done?: boolean;
  doneAt?: number;
  doneBy?: string;
  doneByName?: string;
  note?: string;
  proofs?: QuestStepProof[];
  awardedPoints?: number;
  /** True when the step landed AFTER its quest's cutoff (R1 — drives
   *  the quiet "done late" append, never a second alarm). */
  doneLate?: boolean;

  // ── D8 · reflection linkage ──
  /** The reflection day this step's note was ATTACHED to. */
  reflectionAttachedDate?: string;
  /** True only when the kid explicitly said "this IS my reflection
   *  today" AND wrote a note of real substance (R5). */
  reflectionClaimed?: boolean;
}

// ── Streak (D10) ────────────────────────────────────────────────────

export interface QuestStreak {
  current: number;
  best: number;
  /** LOCAL YYYY-MM-DD of the most recent completed step. */
  lastDoneDate?: string;
  /** 🛡️ Shields left — a shield absorbs one missed active day. */
  shields: number;
  /** 🩹 The one-time repair, once spent, never returns. */
  repairUsed?: boolean;
  /** Days the streak was saved by a shield (for an honest history). */
  shieldedDates?: string[];
}

export const DEFAULT_QUEST_STREAK: QuestStreak = {
  current: 0, best: 0, shields: 1, repairUsed: false,
};

// ── Quest ───────────────────────────────────────────────────────────

export interface Quest {
  id: string;
  kidId: string;
  /** Short kid-facing name: "Speak & Articulate". */
  title: string;
  /** D3 · where we want to BE. Never the problem. */
  goal: string;
  /** YYYY-MM-DD — the "by when". */
  deadline?: string;
  difficulty: QuestDifficulty;
  status: QuestStatus;
  visibility: QuestVisibility;
  emoji: string;
  /** Accent colour hex — drives the quest card + progress bars. */
  colour: string;

  // ── rhythm ──
  minutesPerDay: number;
  /** Days the quest runs. The complement = declared REST days, which
   *  never count as a miss (D10). */
  activeDays: DayOfWeek[];
  /** HH:mm LOCAL — after this, an open step is a miss (D11). */
  cutoffHHmm: string;

  markers: QuestMarker[];
  streak: QuestStreak;

  /** While set (YYYY-MM-DD), the quest is on hold: no steps due, no
   *  reminders, no misses. */
  pausedUntil?: string;

  // ── pathway (D4) ──
  pathwayApproved?: boolean;
  pathwayWeeks?: number;
  /** Set once the batch approval happened, for the audit line. */
  pathwayApprovedAt?: number;
  pathwayApprovedByName?: string;

  // ── points ──
  pointsPerStep: number;
  graduationPoints: number;

  // ── reminders (D11) ──
  remindersEnabled?: boolean;
  /** Extra addresses beyond the parents — grandparent, tutor, coach. */
  extraEmails?: string[];

  // ── generation quota (D7) ──
  lastGeneratedOn?: string;
  lastGeneratedBy?: string;
  lastGeneratedByName?: string;
  lastGeneratedAt?: number;
  /** Set when a parent queued a pack for a future day. */
  queuedForDate?: string;

  // ── buddy (innovation 3) ──
  buddyUid?: string;
  buddyName?: string;

  // ── graduation (D16) ──
  graduatedAt?: number;
  /** The sparks_items achievement row this quest became. */
  achievementItemId?: string;

  createdAt: number;
  createdBy: string;
  createdByName: string;
  updatedAt?: number;
  updatedBy?: string;
  /** R2/F14 · "last edited by Diana" line. */
  updatedByName?: string;
}

/** D14 · a kid may run at most two quests at once. A third needs one
 *  paused first — load is a design constraint, not an afterthought. */
export const MAX_ACTIVE_QUESTS = 2;

/** Default rhythm — weekdays on, weekends as declared rest days. */
export const DEFAULT_ACTIVE_DAYS: DayOfWeek[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

export const DEFAULT_CUTOFF = '17:00';

/** Difficulty → the pathway shape the AI drafts and the manual default. */
export const DIFFICULTY_META: Record<QuestDifficulty, {
  label: string; emoji: string; minutes: number; weeks: number; blurb: string;
}> = {
  easy:    { label: 'Easy',    emoji: '🌱', minutes: 5,  weeks: 4, blurb: 'Short and gentle — building the habit matters more than the reps.' },
  medium:  { label: 'Medium',  emoji: '🔥', minutes: 10, weeks: 6, blurb: 'A real daily effort, still finishable on a busy school night.' },
  stretch: { label: 'Stretch', emoji: '🚀', minutes: 20, weeks: 8, blurb: 'Ambitious. Best when the child already wants this one.' },
};

/** Quest colour presets — reused by the picker + the cards. */
export const QUEST_COLOURS = [
  '#5A3CB8', '#E85C5C', '#2E7D34', '#1E7873', '#C77E0A', '#B7567B',
];

export const QUEST_EMOJIS = [
  '🚀', '🎤', '📖', '🎸', '⚽', '🧮', '🎨', '🏊', '✍️', '🧘', '🗣', '🔬',
];

// ── Gateway ─────────────────────────────────────────────────────────

async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}

export async function questsApi<T>(
  action: string, payload: Record<string, unknown>,
): Promise<T> {
  const token = await idToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/sparks/quests', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || `quests-${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Refresh bus — subscribers keyed by `${familyId}:${kidId}`. Writes ping
// the bus; subscribers re-fetch. Mirrors diary.ts exactly.
const questListeners = new Map<string, Set<() => void>>();

export function pingQuests(familyId: string, kidId: string) {
  const set = questListeners.get(`${familyId}:${kidId}`);
  if (set) for (const fn of set) { try { fn(); } catch { /* noop */ } }
}

/** Fetch-once + re-fetch-on-write subscription to a kid's quests. */
export function subscribeToQuests(
  familyId: string, kidId: string,
  cb: (quests: Quest[]) => void,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  let dead = false;
  const load = () => {
    questsApi<{ quests: Quest[] }>('list', { kidId })
      .then(({ quests }) => { if (!dead) cb(quests); })
      .catch((err) => { console.error('[quests] list failed:', err); if (!dead) cb([]); });
  };
  load();
  const key = `${familyId}:${kidId}`;
  const set = questListeners.get(key) ?? new Set();
  set.add(load);
  questListeners.set(key, set);
  return () => { dead = true; set.delete(load); };
}

export interface QuestDetail {
  quest: Quest;
  steps: QuestStep[];
  readings: MarkerReading[];
  /** D3 · parents ONLY. The API omits this field entirely for kids and
   *  helpers — it is never merely hidden client-side. */
  startingPoint?: string | null;
}

/** Fetch-once + re-fetch-on-write subscription to one quest's detail. */
export function subscribeToQuest(
  familyId: string, kidId: string, questId: string,
  cb: (detail: QuestDetail | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  let dead = false;
  const load = () => {
    questsApi<QuestDetail>('get', { questId })
      .then((d) => { if (!dead) cb(d); })
      .catch((err) => { console.error('[quests] get failed:', err); if (!dead) cb(null); });
  };
  load();
  const key = `${familyId}:${kidId}`;
  const set = questListeners.get(key) ?? new Set();
  set.add(load);
  questListeners.set(key, set);
  return () => { dead = true; set.delete(load); };
}

// ── Writes ──────────────────────────────────────────────────────────

export interface NewQuestInput {
  kidId: string;
  title: string;
  goal: string;
  deadline?: string;
  difficulty: QuestDifficulty;
  emoji: string;
  colour: string;
  minutesPerDay: number;
  activeDays: DayOfWeek[];
  cutoffHHmm: string;
  visibility: QuestVisibility;
  markers: QuestMarker[];
  /** D3 · stored in the parent-only sub-document, never on the quest. */
  startingPoint?: string;
  extraEmails?: string[];
  remindersEnabled?: boolean;
}

export async function createQuest(familyId: string, input: NewQuestInput): Promise<string> {
  if (isGuestActive()) return 'guest';
  const { id } = await questsApi<{ id: string }>('create', { ...input });
  pingQuests(familyId, input.kidId);
  return id;
}

export type QuestPatch = Partial<Pick<Quest,
  'title' | 'goal' | 'deadline' | 'difficulty' | 'emoji' | 'colour' |
  'minutesPerDay' | 'activeDays' | 'cutoffHHmm' | 'visibility' | 'markers' |
  'extraEmails' | 'remindersEnabled' | 'status' | 'pointsPerStep' | 'graduationPoints'
>>;

export async function updateQuest(
  familyId: string, kidId: string, questId: string, patch: QuestPatch,
): Promise<void> {
  if (isGuestActive()) return;
  await questsApi('update', { questId, patch });
  pingQuests(familyId, kidId);
}

/** Parents only (server-enforced). Passing '' clears the note. */
export async function setStartingPoint(
  familyId: string, kidId: string, questId: string, startingPoint: string,
): Promise<void> {
  if (isGuestActive()) return;
  await questsApi('private-set', { questId, startingPoint });
  pingQuests(familyId, kidId);
}

export async function deleteQuest(
  familyId: string, kidId: string, questId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await questsApi('delete', { questId });
  pingQuests(familyId, kidId);
}

/** One drafted step, before it exists server-side. */
export interface StepDraft {
  date: string;
  phase: QuestPhase;
  title: string;
  how: string;
  minutes: number;
  tone: 'fun' | 'serious';
  proofKindWanted?: ProofKind;
  source?: 'parent' | 'ai';
}

/** D4 · replace the quest's pathway with this set of steps and (when
 *  `approve`) mark it approved in the SAME call — the one batch review.
 *  Completed steps are never destroyed; the server keeps them. */
export async function setPathway(
  familyId: string, kidId: string, questId: string,
  steps: StepDraft[], approve = true, weeks?: number,
): Promise<void> {
  if (isGuestActive()) return;
  await questsApi('pathway-set', { questId, steps, approve, weeks });
  pingQuests(familyId, kidId);
}

/** D10 · pause through `until` (YYYY-MM-DD). No steps due, no reminders,
 *  no misses — holidays and illness never break a streak. */
export async function pauseQuest(
  familyId: string, kidId: string, questId: string, until: string,
): Promise<void> {
  if (isGuestActive()) return;
  await questsApi('pause', { questId, until });
  pingQuests(familyId, kidId);
}

export async function resumeQuest(
  familyId: string, kidId: string, questId: string,
): Promise<void> {
  if (isGuestActive()) return;
  await questsApi('resume', { questId });
  pingQuests(familyId, kidId);
}

// ── Derivations (pure — shared by pages, cards and the dashboard) ────

const DOW_KEYS: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** LOCAL day-of-week key for a YYYY-MM-DD date string. Parsed as a local
 *  calendar date on purpose — day boundaries are LOCAL, never UTC. */
export function dowForDate(date: string): DayOfWeek {
  const [y, m, d] = date.split('-').map(Number);
  return DOW_KEYS[new Date(y, (m || 1) - 1, d || 1).getDay()];
}

/** Today as a LOCAL YYYY-MM-DD. */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** True when this quest actually expects work on `date` — active status,
 *  not paused, and the day isn't a declared rest day (D10). */
export function isDueOn(quest: Quest, date: string): boolean {
  if (quest.status !== 'active') return false;
  if (quest.pausedUntil && date <= quest.pausedUntil) return false;
  return quest.activeDays.includes(dowForDate(date));
}

/** The step a kid should see on `date` — the first not-done step dated
 *  that day, else the day's completed step so they can see the tick. */
export function stepForDate(steps: QuestStep[], date: string): QuestStep | null {
  const sameDay = steps
    .filter((s) => s.date === date)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  return sameDay.find((s) => !s.done) ?? sameDay[0] ?? null;
}

/** D9 · CONSISTENCY track. Steps done ÷ steps that were actually due
 *  up to today — rest days and paused days never count against a kid. */
export function consistency(quest: Quest, steps: QuestStep[], upTo = todayKey()): {
  done: number; due: number; percent: number;
} {
  const due = steps.filter((s) => s.date <= upTo && quest.activeDays.includes(dowForDate(s.date)));
  const done = due.filter((s) => s.done).length;
  return {
    done,
    due: due.length,
    percent: due.length ? Math.round((done / due.length) * 100) : 0,
  };
}

/** Overall pathway progress — every step, not just the due ones. */
export function pathwayProgress(steps: QuestStep[]): { done: number; total: number; percent: number } {
  const done = steps.filter((s) => s.done).length;
  return { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 };
}

/** D9 · GROWTH track for one marker: the baseline, the latest reading,
 *  and the trend series. Deliberately returns the SERIES — callers must
 *  render a trend, never a naked delta (R3). */
export function markerTrend(readings: MarkerReading[], markerId: string): {
  baseline: MarkerReading | null;
  latest: MarkerReading | null;
  series: MarkerReading[];
} {
  const series = readings
    .filter((r) => r.markerId === markerId)
    .sort((a, b) => a.at - b.at);
  const baseline = series.find((r) => r.isBaseline) ?? series[0] ?? null;
  return { baseline, latest: series.length ? series[series.length - 1] : null, series };
}

/** Human label for a marker value. */
export function formatMarkerValue(marker: QuestMarker, value: number): string {
  if (marker.kind === 'rubric') return `${Math.round(value)}/100`;
  if (marker.kind === 'stars') return `${'⭐'.repeat(Math.max(0, Math.min(5, Math.round(value))))}`;
  return `${value}${marker.unit ? ` ${marker.unit}` : ''}`;
}

/** Count of quests currently occupying a kid's two active slots (D14). */
export function activeCount(quests: Quest[]): number {
  return quests.filter((q) => q.status === 'active').length;
}

/** Rest days = every day NOT in activeDays, in week order. */
export function restDays(quest: Quest): DayOfWeek[] {
  return DOW_KEYS.filter((d) => !quest.activeDays.includes(d));
}

const DOW_LABEL: Record<DayOfWeek, string> = {
  sun: 'Sun', mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat',
};

export function dayLabel(d: DayOfWeek): string { return DOW_LABEL[d]; }

// ── Manual pathway builder (D4, no AI) ──────────────────────────────

/** Add `n` days to a YYYY-MM-DD, staying in LOCAL calendar space. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, (d || 1) + n);
  return todayKey(dt);
}

/** Spread a short list of practice moves across the quest's active days
 *  for `weeks` weeks, walking the four phases as it goes.
 *
 *  This is the FREE-tier pathway: the parent writes five or six things
 *  they'd actually ask their child to do, and Kaya lays them out so the
 *  whole plan exists up front and gets approved once (D4) — the same
 *  contract the AI drafter honours on Home/Castle, minus the drafting.
 *  Every second step is toned `fun`, so no pathway is all drill. */
export function buildManualPathway(
  quest: Pick<Quest, 'activeDays' | 'minutesPerDay'>,
  moves: string[],
  weeks: number,
  startDate = todayKey(),
): StepDraft[] {
  const clean = moves.map((m) => m.trim()).filter(Boolean);
  if (!clean.length || weeks < 1) return [];

  // Which calendar days actually carry a step.
  const dates: string[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = addDays(startDate, i);
    if (quest.activeDays.includes(dowForDate(date))) dates.push(date);
  }
  if (!dates.length) return [];

  const perPhase = Math.max(1, Math.ceil(dates.length / QUEST_PHASES.length));

  return dates.map((date, i) => {
    const phase = QUEST_PHASES[Math.min(QUEST_PHASES.length - 1, Math.floor(i / perPhase))];
    const move = clean[i % clean.length];
    return {
      date,
      phase,
      title: move,
      how: `${move} — ${quest.minutesPerDay} minutes. Capture something so you can look back on it.`,
      minutes: quest.minutesPerDay,
      tone: i % 2 === 1 ? 'fun' : 'serious',
      source: 'parent' as const,
    };
  });
}

/** Group steps into ISO-ish weeks for the pathway review list. Returns
 *  `[{ label, steps }]` in date order. */
export function groupStepsByWeek(steps: QuestStep[]): Array<{ label: string; steps: QuestStep[] }> {
  if (!steps.length) return [];
  const sorted = [...steps].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const first = sorted[0].date;
  const buckets = new Map<number, QuestStep[]>();
  for (const s of sorted) {
    const [y1, m1, d1] = first.split('-').map(Number);
    const [y2, m2, d2] = s.date.split('-').map(Number);
    const diff = Math.floor(
      (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000,
    );
    const wk = Math.floor(diff / 7);
    const arr = buckets.get(wk);
    if (arr) arr.push(s); else buckets.set(wk, [s]);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([wk, list]) => ({ label: `Week ${wk + 1}`, steps: list }));
}

/** "10 min · Mon–Fri · by 17:00" — the one-line rhythm summary. */
export function rhythmLine(quest: Quest): string {
  const days = DOW_KEYS.filter((d) => quest.activeDays.includes(d)).map(dayLabel);
  const compact = days.length === 5 && !quest.activeDays.includes('sat') && !quest.activeDays.includes('sun')
    ? 'Mon–Fri'
    : days.join(' · ');
  return `${quest.minutesPerDay} min · ${compact} · by ${quest.cutoffHHmm}`;
}
