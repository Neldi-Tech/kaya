'use client';

// Kaya Games — Question of the Day.
//
// ONE shared trivia question per family per day that EVERYONE (parents + kids)
// answers from their My Day to-do. Answering keeps a personal STREAK alive;
// streaks pay Fun-Points, with a celebratory burst every `qotdStreakTarget`
// days (default 3, set in Games Controls).
//
//   • The day's question lives at families/{fid}/gameMeta/qotd (family
//     read+write). The first member to open My Day on a new day generates it
//     via the existing /api/games/trivia route; everyone else reads the same one
//     — so the family can chat about "today's question".
//   • Per-player streaks live on gameStats/{uid} and are written server-side by
//     /api/games/qotd/answer (gameStats is client-write-false → can't be forged).
//
// Fails SAFE end to end: if the AI generator is unavailable, a hand-authored
// bank keeps the daily question appearing; every Firestore call is best-effort.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '@/lib/firebase';
import { localDateKey } from '@/lib/games';
import { QOTD_BANK, qotdFingerprint } from '@/lib/qotdBank';

export interface QotdDoc {
  date: string;          // YYYY-MM-DD (local) this question belongs to
  q: string;
  choices: string[];
  answer: number;        // 0-based index of the correct choice
  context?: string;      // playful one-line framing
  fact?: string;         // "Did you know?" follow-up
  subject?: string;
  /** Lifetime question counter — "Question #142 · never repeats". */
  serial?: number;
  /** Family members who answered today (family progress line). */
  answeredUids?: string[];
}

export interface QotdStreak {
  last: string;          // last YYYY-MM-DD answered ('' = never)
  streak: number;        // consecutive days answered
  best: number;
  days: string[];        // answered-day history (last 60) — powers the dot strip
}

export interface QotdAnswerResult {
  ok?: boolean;
  alreadyAnswered?: boolean;
  correct?: boolean;
  answer?: number;       // the correct index (to reveal)
  fact?: string;
  streak?: number;
  best?: number;
  funAwarded?: number;
  milestone?: boolean;   // streak just hit a multiple of the target
  target?: number;
  shieldUsed?: boolean;  // 🛡️ a missed day was auto-forgiven this answer
  repaired?: boolean;    // one-time streak repair (rotation-bug era) applied
  days?: string[];       // answered-day history (last 60) for the dot strip
  error?: string;
  skipped?: boolean;
}

// Subjects the daily question rotates through (mirrors the Family Trivia bank).
const SUBJECTS = ['animals', 'science', 'geography', 'sports', 'words', 'mixed'];

/** Today's LOCAL day key for this device (matches the server's localDateKey). */
export function todayKey(): string {
  return localDateKey(Date.now(), -new Date().getTimezoneOffset());
}

function qotdRef(familyId: string) {
  return doc(db, 'families', familyId, 'gameMeta', 'qotd');
}

/** Read today's question, or null if missing / from an earlier day. */
export async function readQotd(familyId: string): Promise<QotdDoc | null> {
  try {
    const snap = await getDoc(qotdRef(familyId));
    const d = snap.data() as QotdDoc | undefined;
    if (d && d.date === todayKey() && Array.isArray(d.choices) && d.choices.length === 4) return d;
    return null;
  } catch { return null; }
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Ensure a question exists for today and return it.
 *
 *  2026-07-19 — rotation is now primarily SERVER-SIDE (the hourly
 *  /api/cron/qotd-rotate cron); this client path is only the backup for a
 *  family's very first question or a cron miss. It now honours the same
 *  no-repeat contract: passes the `seen` fingerprints as the trivia
 *  route's `avoid` list, draws bank fallbacks from the curated 120-question
 *  bank excluding seen, and preserves `serial`/`seen` on the doc. */
export async function ensureQotd(familyId: string): Promise<QotdDoc> {
  const today = todayKey();
  const existing = await readQotd(familyId);
  if (existing) return existing;

  // Raw read for the rotation bookkeeping (seen/serial survive the day flip).
  let seen: string[] = [];
  let serial = 0;
  try {
    const raw = (await getDoc(qotdRef(familyId))).data() as { seen?: string[]; serial?: number } | undefined;
    if (Array.isArray(raw?.seen)) seen = raw!.seen!.filter((s) => typeof s === 'string');
    serial = Number(raw?.serial) || 0;
  } catch { /* fresh family */ }

  const subject = SUBJECTS[hash(today) % SUBJECTS.length];

  let built: Omit<QotdDoc, 'date'> | null = null;
  try {
    const res = await fetch('/api/games/trivia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, difficulty: 'medium', count: 4, avoid: seen.slice(-40) }),
    });
    const data = (await res.json().catch(() => null)) as { questions?: QotdDoc[] } | null;
    const q = data?.questions?.find(
      (x) => x && Array.isArray(x.choices) && x.choices.length === 4
        && typeof x.answer === 'number' && !seen.includes(qotdFingerprint(x.q)),
    );
    if (q) built = { q: q.q, choices: q.choices, answer: q.answer, context: q.context, fact: q.fact, subject };
  } catch { /* fall through to the bank */ }
  if (!built) {
    const unseen = QOTD_BANK.filter((b) => !seen.includes(qotdFingerprint(b.q)));
    const pick = (unseen.length ? unseen : QOTD_BANK)[hash(today) % (unseen.length ? unseen.length : QOTD_BANK.length)];
    built = { q: pick.q, choices: [...pick.choices], answer: pick.answer, context: pick.context, fact: pick.fact, subject: pick.subject };
  }

  const fp = qotdFingerprint(built.q);
  const docData: QotdDoc = { date: today, ...built, serial: serial + 1, answeredUids: [] };
  try {
    // Re-check right before writing: if someone beat us to it this very moment,
    // keep theirs so the whole family shares one question.
    const fresh = await readQotd(familyId);
    if (fresh) return fresh;
    await setDoc(qotdRef(familyId), {
      ...docData,
      seen: [...seen.filter((s) => s !== fp), fp].slice(-400),
      rotatedBy: 'client',
      createdAt: Date.now(),
    }, { merge: true });
  } catch { /* best-effort — this player still sees `docData` */ }
  return docData;
}

/** This player's QotD streak (read from their gameStats doc). */
export async function readMyStreak(familyId: string, uid: string): Promise<QotdStreak> {
  try {
    const snap = await getDoc(doc(db, 'families', familyId, 'gameStats', uid));
    const d = snap.data() as { qotdLast?: string; qotdStreak?: number; qotdBest?: number; qotdDays?: string[] } | undefined;
    return {
      last: d?.qotdLast || '',
      streak: Number(d?.qotdStreak) || 0,
      best: Number(d?.qotdBest) || 0,
      days: Array.isArray(d?.qotdDays) ? d!.qotdDays!.filter((x) => typeof x === 'string') : [],
    };
  } catch { return { last: '', streak: 0, best: 0, days: [] }; }
}

/** Did this player already answer today's question? */
export function answeredToday(s: QotdStreak): boolean {
  return !!s.last && s.last === todayKey();
}

/** Submit the player's answer. Streak + Fun-Points are credited server-side. */
export async function answerQotd(choice: number): Promise<QotdAnswerResult> {
  const user = auth.currentUser;
  if (!user) return { error: 'not-signed-in' };
  let token: string;
  try { token = await user.getIdToken(); }
  catch { return { error: 'token-failed' }; }
  try {
    const res = await fetch('/api/games/qotd/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ choice, tzOffsetMinutes: -new Date().getTimezoneOffset() }),
    });
    return (await res.json()) as QotdAnswerResult;
  } catch (e) {
    return { error: String(e) };
  }
}
