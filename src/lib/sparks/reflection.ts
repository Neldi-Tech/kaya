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

import {
  collection, doc, getDoc, setDoc, onSnapshot, query, where, orderBy, limit as qlimit,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { isGuestActive } from '../mockFamily';
import {
  type ReflectionSettings, DEFAULT_REFLECTION_SETTINGS,
} from './schema';
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

const reflectionsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'sparks_reflections');

const reflectionDoc = (familyId: string, kidId: string, date: string) =>
  doc(db, 'families', familyId, 'sparks_reflections', `${kidId}_${date}`);

/** Today's (or a given day's) reflection for a kid, or null. */
export async function getReflection(
  familyId: string, kidId: string, date: string,
): Promise<ReflectionEntry | null> {
  if (isGuestActive()) return null;
  const snap = await getDoc(reflectionDoc(familyId, kidId, date));
  return snap.exists() ? (snap.data() as ReflectionEntry) : null;
}

/** Live subscription to one day's reflection (the entry screen). */
export function subscribeToReflection(
  familyId: string, kidId: string, date: string,
  cb: (entry: ReflectionEntry | null) => void,
): () => void {
  if (isGuestActive()) { cb(null); return () => {}; }
  return onSnapshot(
    reflectionDoc(familyId, kidId, date),
    (s) => cb(s.exists() ? (s.data() as ReflectionEntry) : null),
    (err) => { console.error('[reflection] subscribe failed:', err); cb(null); },
  );
}

/** Recent reflections for a kid, newest first — powers the streak +
 *  the week strip + the dashboard tile. Client-sorted (no composite
 *  index): a single equality filter on kidId, sorted in memory. */
export function subscribeToReflections(
  familyId: string, kidId: string,
  cb: (entries: ReflectionEntry[]) => void,
  max = 60,
): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(reflectionsCol(familyId), where('kidId', '==', kidId));
  return onSnapshot(
    q,
    (s) => {
      const rows = s.docs.map((d) => d.data() as ReflectionEntry);
      rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      cb(rows.slice(0, max));
    },
    (err) => { console.error('[reflection] list subscribe failed:', err); cb([]); },
  );
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
  const ref = reflectionDoc(familyId, args.kidId, date);
  const existing = await getDoc(ref);
  const now = serverTimestamp();
  const data: Record<string, unknown> = {
    kidId: args.kidId,
    date,
    text: args.text.trim(),
    source: args.source,
    updatedAt: now,
    createdBy: existing.exists() ? (existing.data() as ReflectionEntry).createdBy : args.by,
    createdAt: existing.exists() ? (existing.data() as ReflectionEntry).createdAt : now,
  };
  if (args.scanUrl) data.scanUrl = args.scanUrl;
  await setDoc(ref, data, { merge: true });
}

/** Attach Kaya's structured feedback to a saved reflection. */
export async function saveReflectionFeedback(
  familyId: string, kidId: string, date: string, feedback: ReflectionFeedback,
): Promise<void> {
  if (isGuestActive()) return;
  await setDoc(
    reflectionDoc(familyId, kidId, date),
    { feedback, updatedAt: serverTimestamp() },
    { merge: true },
  );
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
