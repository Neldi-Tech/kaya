// Kaya Sparks · Daily Reflection (2026-06-07)
//
// A daily self-reflection module. Scan-first: the kid writes how their
// school day went BY HAND and scans the page — Claude reads the
// handwriting (/api/sparks/ai/extract, kind:'reflection') — then Kaya
// gives warm, STRUCTURED feedback (What went well / one small tip /
// cheer) via /api/sparks/ai/reflect. Typing is a secondary path the
// parent gates per-kid + per-weekday (see ReflectionSettings on the
// profile). A dated streak proves daily consistency for the parent.
//
// Storage: one doc per kid per day at
//   /families/{familyId}/sparks_reflections/{kidId}_{YYYY-MM-DD}
// Kid + parents read; the kid (or a parent) writes their own. Mirrors
// the access shape of sparks_items.

// Weekly-reviews subscription + the streak-award helper still use the client
// SDK (sparks_reflection_weeks / sparks_profiles / awards are deployed). The
// reflection read/write itself routes through the Admin SDK (gateway below),
// so `auth` is here for the ID token.
import {
  collection, doc, query, where, onSnapshot,
  serverTimestamp, Timestamp, updateDoc, arrayUnion,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { isGuestActive } from '../mockFamily';
import {
  type ReflectionSettings, DEFAULT_REFLECTION_SETTINGS,
  type ReflectionStreakRewards, type ReflectionStreakMilestone,
  DEFAULT_REFLECTION_STREAK_REWARDS,
} from './schema';
import { giveAward } from '../firestore';
import type { DayOfWeek } from '../firestore';

/** How the kid captured today's reflection. */
export type ReflectionSource = 'scan' | 'typed';

/** Kaya's structured AI feedback — three short, skimmable blocks so a
 *  kid can read it at a glance (never a paragraph blob). */
export interface ReflectionFeedback {
  /** 🌟 what went well — always present, encouragement-first. */
  wentWell: string;
  /** 💡 one small, specific tip — optional (some days are pure cheer). */
  tip?: string;
  /** 👏 a short closing cheer. */
  cheer: string;
}

/** Slice 7p · Post-scan AI read. Mood + theme + warm 1-line Kaya
 *  response shown the moment the kid saves a reflection. */
export interface ReflectionAIRead {
  mood_emoji:    string;
  mood_word:     string;
  theme_emoji:   string;
  theme_label:   string;
  kaya_response: string;
}

export interface ReflectionEntry {
  /** Doc id = `${kidId}_${date}`; these mirror it. */
  kidId: string;
  date: string;                 // YYYY-MM-DD (local day)
  /** The reflection text — transcribed from the scan, or typed. */
  text: string;
  source: ReflectionSource;
  /** Storage URL of the scanned page (scan source only). */
  scanUrl?: string;
  /** Kaya's structured feedback (absent until the AI replies / if AI off). */
  feedback?: ReflectionFeedback;
  /** Slice 7p · post-scan AI read (mood + theme + Kaya response). */
  ai_read?: ReflectionAIRead;
  createdAt: Timestamp;
  createdBy: string;            // uid (kid or parent)
  updatedAt: Timestamp;
}

const DOW: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** Local-day key YYYY-MM-DD (never UTC — Kaya families span timezones). */
export function reflectionDayKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The weekday of a YYYY-MM-DD key, in local time. */
export function dowOf(dateKey: string): DayOfWeek {
  const [y, m, d] = dateKey.split('-').map(Number);
  return DOW[new Date(y, (m || 1) - 1, d || 1).getDay()];
}

/** Resolve the effective reflection settings (defaults when absent). */
export function readReflectionSettings(
  profile: { reflection_settings?: ReflectionSettings } | null | undefined,
): ReflectionSettings {
  const s = profile?.reflection_settings;
  if (!s) return DEFAULT_REFLECTION_SETTINGS;
  return {
    typing_allowed: !!s.typing_allowed,
    typing_days: Array.isArray(s.typing_days) ? s.typing_days : [],
  };
}

/** Whether the kid may TYPE today (vs scan-only). Scan is always allowed;
 *  typing requires the master toggle AND today being a permitted weekday. */
export function typingAllowedOn(
  settings: ReflectionSettings,
  dateKey: string = reflectionDayKey(),
): boolean {
  if (!settings.typing_allowed) return false;
  return settings.typing_days.includes(dowOf(dateKey));
}

// ── Admin-route gateway + refresh bus ──────────────────────────────────
// The sparks_reflections rules block isn't deployed to prod yet (Firebase
// CLI auth expired), so a direct client read/write throws "Missing or
// insufficient permissions" for kids. We route reflection reads + writes
// through the Admin-SDK endpoint /api/sparks/reflection (verified ID token)
// instead — no rules deploy needed. To preserve the live-ish UX with ZERO
// page changes, subscribeToReflection(s) fetch once + register on a tiny
// in-module bus; every write (save / AI-read / feedback) pings the bus so
// subscribers re-fetch — mimicking the onSnapshot refresh the page expects.

async function idToken(): Promise<string | null> {
  const u = auth.currentUser;
  if (!u) return null;
  try { return await u.getIdToken(); } catch { return null; }
}

async function reflectionApi<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const token = await idToken();
  if (!token) throw new Error('not-signed-in');
  const res = await fetch('/api/sparks/reflection', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || `reflection-${res.status}`);
  }
  return res.json() as Promise<T>;
}

// Refresh bus — subscribers keyed by `${familyId}:${kidId}`.
const reflectionListeners = new Map<string, Set<() => void>>();
function busKey(familyId: string, kidId: string): string { return `${familyId}:${kidId}`; }
function pingReflection(familyId: string, kidId: string): void {
  reflectionListeners.get(busKey(familyId, kidId))?.forEach((fn) => { try { fn(); } catch { /* noop */ } });
}
function onReflectionChange(familyId: string, kidId: string, fn: () => void): () => void {
  const k = busKey(familyId, kidId);
  if (!reflectionListeners.has(k)) reflectionListeners.set(k, new Set());
  reflectionListeners.get(k)!.add(fn);
  return () => { reflectionListeners.get(k)?.delete(fn); };
}

/** Today's (or a given day's) reflection for a kid, or null (admin route). */
export async function getReflection(
  _familyId: string, kidId: string, date: string,
): Promise<ReflectionEntry | null> {
  if (isGuestActive()) return null;
  const { entry } = await reflectionApi<{ entry: ReflectionEntry | null }>('get', { kidId, date });
  return entry || null;
}

/** Recent reflections for a kid, newest first (one-shot via the route). */
export async function listReflections(
  _familyId: string, kidId: string, max = 60,
): Promise<ReflectionEntry[]> {
  if (isGuestActive()) return [];
  const { entries } = await reflectionApi<{ entries: ReflectionEntry[] }>('list', { kidId, max });
  return entries || [];
}

/** One day's reflection — fetches now (admin route) + refreshes whenever a
 *  write pings the bus. Same signature as the old onSnapshot subscription,
 *  so the entry screen needs no changes. */
export function subscribeToReflection(
  familyId: string, kidId: string, date: string,
  cb: (entry: ReflectionEntry | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  let cancelled = false;
  const refetch = () => {
    getReflection(familyId, kidId, date)
      .then((e) => { if (!cancelled) cb(e); })
      .catch((err) => { console.error('[reflection] get failed:', err); if (!cancelled) cb(null); });
  };
  refetch();
  const off = onReflectionChange(familyId, kidId, refetch);
  return () => { cancelled = true; off(); };
}

/** A kid's recent reflections — fetches now + refreshes on any write. */
export function subscribeToReflections(
  familyId: string, kidId: string,
  cb: (entries: ReflectionEntry[]) => void,
  max = 60,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  let cancelled = false;
  const refetch = () => {
    listReflections(familyId, kidId, max)
      .then((rows) => { if (!cancelled) cb(rows); })
      .catch((err) => { console.error('[reflection] list failed:', err); if (!cancelled) cb([]); });
  };
  refetch();
  const off = onReflectionChange(familyId, kidId, refetch);
  return () => { cancelled = true; off(); };
}

/** Save (or overwrite) today's reflection. Idempotent per kid+day —
 *  the kid can re-scan / edit until they're happy. Feedback is written
 *  separately once the AI replies (saveReflectionFeedback). */
export async function saveReflection(
  familyId: string,
  args: {
    kidId: string;
    date?: string;
    text: string;
    source: ReflectionSource;
    scanUrl?: string;
    by: string;
  },
): Promise<void> {
  if (isGuestActive()) return;
  const date = args.date ?? reflectionDayKey();
  await reflectionApi('save', {
    kidId: args.kidId, date, text: args.text, source: args.source,
    ...(args.scanUrl ? { scanUrl: args.scanUrl } : {}),
  });
  pingReflection(familyId, args.kidId);
}

/** Slice 7p · Attach Kaya's post-scan AI read to a saved reflection. */
export async function saveReflectionAIRead(
  familyId: string, kidId: string, date: string, ai_read: ReflectionAIRead,
): Promise<void> {
  if (isGuestActive()) return;
  await reflectionApi('airead', { kidId, date, ai_read });
  pingReflection(familyId, kidId);
}

/** Attach Kaya's structured feedback to a saved reflection. */
export async function saveReflectionFeedback(
  familyId: string, kidId: string, date: string, feedback: ReflectionFeedback,
): Promise<void> {
  if (isGuestActive()) return;
  await reflectionApi('feedback', { kidId, date, feedback });
  pingReflection(familyId, kidId);
}

// ── Streak (school-day-aware) ───────────────────────────────────────
//
// We reward consistency without punishing weekends: the streak counts
// consecutive days-with-an-entry walking backwards from today, but a
// missing Saturday/Sunday does NOT break it (kids reflect on school
// days). A missing weekday breaks it.

export interface ReflectionStreak {
  current: number;       // consecutive logged days ending at the most recent
  loggedThisWeek: number;
  total: number;         // total entries in the window
  /** YYYY-MM-DD → true for days that have an entry (for the calendar). */
  byDate: Record<string, boolean>;
}

export function computeReflectionStreak(
  entries: ReflectionEntry[],
  today: Date = new Date(),
): ReflectionStreak {
  const byDate: Record<string, boolean> = {};
  for (const e of entries) byDate[e.date] = true;

  // Walk back from today; skip weekends (don't count, don't break).
  let current = 0;
  const cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  // If today has no entry yet, start the walk from yesterday so an
  // unfinished today doesn't read as a broken streak.
  if (!byDate[reflectionDayKey(cursor)]) cursor.setDate(cursor.getDate() - 1);
  for (let i = 0; i < 366; i++) {
    const key = reflectionDayKey(cursor);
    const wd = cursor.getDay(); // 0 Sun … 6 Sat
    if (wd === 0 || wd === 6) { cursor.setDate(cursor.getDate() - 1); continue; }
    if (byDate[key]) { current += 1; cursor.setDate(cursor.getDate() - 1); }
    else break;
  }

  // This week's logged count (Mon–Sun containing today).
  const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const offset = (weekStart.getDay() + 6) % 7; // days since Monday
  weekStart.setDate(weekStart.getDate() - offset);
  let loggedThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    if (byDate[reflectionDayKey(d)]) loggedThisWeek += 1;
  }

  return { current, loggedThisWeek, total: entries.length, byDate };
}

// ── Slice 7o · weekly review reader ─────────────────────────────────
//
// The Sunday cron writes one doc per kid per ISO week at
//   /families/{f}/sparks_reflection_weeks/{kidId}_{weekKey}
// The reflection page subscribes to the kid's row stream and picks the
// latest doc to render "Your week in reflection".

const weekReviewsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'sparks_reflection_weeks');

/** Live subscription to a kid's weekly reviews, newest first. We pull
 *  the latest 8 weeks for the UI; client picks `[0]`. */
export function subscribeToWeeklyReviews(
  familyId: string, kidId: string,
  cb: (reviews: import('./schema').ReflectionWeekReview[]) => void,
  max = 8,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(
    weekReviewsCol(familyId),
    where('kidId', '==', kidId),
  );
  return onSnapshot(
    q,
    (s) => {
      const rows = s.docs
        .map((d) => d.data() as import('./schema').ReflectionWeekReview)
        .filter((r) => typeof r.weekKey === 'string');
      rows.sort((a, b) => (a.weekKey < b.weekKey ? 1 : a.weekKey > b.weekKey ? -1 : 0));
      cb(rows.slice(0, max));
    },
    (err) => { console.error('[reflection-week] subscribe failed:', err); cb([]); },
  );
}

// ── Slice 7n · streak-points award helper ──────────────────────────
//
// Call AFTER saveReflection lands. Walks the kid's streak rewards
// config, finds every milestone the post-save streak hits, and fires
// giveAward for any that haven't been awarded today.
//
// Idempotency: the kid's profile stores an `award_history` of
// { days, awarded_on } records. We only fire a milestone when there's
// no entry for (days, today). Saving the same reflection twice the
// same day → no double-fire. Streak breaks + re-hits → fires again on
// the new day.
//
// Failure-safe: if giveAward errors (rules block, network), the call
// resolves with an empty array — the reflection still saved. We don't
// surface the failure to the UI; awards are best-effort.

export interface StreakAwardResult {
  days: number;
  points: number;
  label: string;
}

export async function maybeAwardStreakMilestone(args: {
  familyId: string;
  kidId: string;
  /** Local-day key the kid just saved (defaults to today). */
  date?: string;
  /** Post-save streak count from computeReflectionStreak. */
  streakCurrent: number;
  /** Per-kid rewards config; defaults applied when absent. */
  rewards: ReflectionStreakRewards | null | undefined;
  /** UID firing the award (kid or parent). */
  awardedBy: string;
  /** Display name attached to the award. */
  awardedByName: string;
}): Promise<StreakAwardResult[]> {
  if (isGuestActive()) return [];
  const cfg: ReflectionStreakRewards = args.rewards ?? DEFAULT_REFLECTION_STREAK_REWARDS;
  if (!cfg.enabled || !Array.isArray(cfg.milestones) || cfg.milestones.length === 0) return [];

  const today = args.date ?? reflectionDayKey();
  const history = Array.isArray(cfg.award_history) ? cfg.award_history : [];
  const fired: StreakAwardResult[] = [];

  // Resolve which milestones the streak has just hit and haven't been
  // awarded today. Walk in ascending-days order so larger milestones
  // fire AFTER smaller ones in the award log.
  const sortedMilestones: ReflectionStreakMilestone[] = [...cfg.milestones]
    .filter((m) => Number.isFinite(m.days) && m.days > 0 && Number.isFinite(m.points))
    .sort((a, b) => a.days - b.days);

  const profileRef = doc(db, 'families', args.familyId, 'sparks_profiles', args.kidId);

  for (const m of sortedMilestones) {
    if (args.streakCurrent < m.days) continue;
    const alreadyToday = history.some((h) => h.days === m.days && h.awarded_on === today);
    if (alreadyToday) continue;
    try {
      await giveAward(args.familyId, {
        childId: args.kidId,
        kind: 'regular',
        points: m.points,
        reason: `${m.label} · ${m.days}-day reflection streak`,
        category: 'sparks-reflection-streak',
        awardedBy: args.awardedBy,
        awardedByName: args.awardedByName || 'Kaya',
        senderRole: 'parent',
      });
      await updateDoc(profileRef, {
        'reflection_streak.award_history': arrayUnion({ days: m.days, awarded_on: today }),
        'reflection_streak.enabled': cfg.enabled,
        'reflection_streak.milestones': cfg.milestones,
        updatedAt: serverTimestamp(),
      });
      fired.push({ days: m.days, points: m.points, label: m.label });
    } catch {
      // Best-effort — reflection already saved; skip this milestone silently.
    }
  }
  return fired;
}
