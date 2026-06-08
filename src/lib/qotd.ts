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

export interface QotdDoc {
  date: string;          // YYYY-MM-DD (local) this question belongs to
  q: string;
  choices: string[];
  answer: number;        // 0-based index of the correct choice
  context?: string;      // playful one-line framing
  fact?: string;         // "Did you know?" follow-up
  subject?: string;
}

export interface QotdStreak {
  last: string;          // last YYYY-MM-DD answered ('' = never)
  streak: number;        // consecutive days answered
  best: number;
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

// A tiny hand-authored fallback bank so the Question of the Day ALWAYS appears,
// even when the AI generator is offline. One is picked from the day's date so
// the whole family still lands on the same question.
const FALLBACK: Omit<QotdDoc, 'date'>[] = [
  { q: 'Which planet is closest to the Sun?', choices: ['Mercury', 'Mars', 'Earth', 'Jupiter'], answer: 0, context: '☀️ Out in space…', fact: 'Did you know? Mercury is the smallest planet and races around the Sun in just 88 days.' },
  { q: 'What do bees make?', choices: ['Honey', 'Milk', 'Bread', 'Silk'], answer: 0, context: '🐝 In the garden…', fact: 'Did you know? One bee makes only about a twelfth of a teaspoon of honey in its whole life.' },
  { q: 'How many legs does a spider have?', choices: ['8', '6', '4', '10'], answer: 0, context: '🕷️ On the web…', fact: 'Did you know? Spiders are not insects — insects have six legs, but spiders have eight.' },
  { q: 'Which is the largest ocean on Earth?', choices: ['Pacific', 'Atlantic', 'Indian', 'Arctic'], answer: 0, context: '🌊 Around the world…', fact: 'Did you know? The Pacific Ocean is so wide it covers about a third of the whole planet.' },
  { q: 'Mixing blue and yellow paint makes…', choices: ['Green', 'Purple', 'Orange', 'Brown'], answer: 0, context: '🎨 In the art room…', fact: 'Did you know? Plants look green because of a colour called chlorophyll that catches sunlight.' },
  { q: 'How many days are there in a week?', choices: ['7', '5', '10', '12'], answer: 0, context: '📅 On the calendar…', fact: 'Did you know? The seven-day week is thousands of years old and used almost everywhere on Earth.' },
  { q: 'What is a baby frog called?', choices: ['Tadpole', 'Cub', 'Kitten', 'Calf'], answer: 0, context: '🐸 At the pond…', fact: 'Did you know? A tadpole slowly grows legs and loses its tail as it turns into a frog.' },
  { q: 'Which animal is the tallest in the world?', choices: ['Giraffe', 'Elephant', 'Horse', 'Camel'], answer: 0, context: '🦒 On the savanna…', fact: 'Did you know? A giraffe is so tall it can look into a first-floor window — and its tongue is dark blue!' },
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Ensure a question exists for today and return it. The first family member to
 *  open My Day on a new day generates it (via the AI trivia route, falling back
 *  to the hand-authored bank); everyone else just reads it. */
export async function ensureQotd(familyId: string): Promise<QotdDoc> {
  const today = todayKey();
  const existing = await readQotd(familyId);
  if (existing) return existing;

  // Pick the subject deterministically from the date, so a same-day double
  // generate still lands on the same topic.
  const subject = SUBJECTS[hash(today) % SUBJECTS.length];

  let built: Omit<QotdDoc, 'date'> | null = null;
  try {
    const res = await fetch('/api/games/trivia', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, difficulty: 'medium', count: 1 }),
    });
    const data = (await res.json().catch(() => null)) as { questions?: QotdDoc[] } | null;
    const q = data?.questions?.[0];
    if (q && Array.isArray(q.choices) && q.choices.length === 4 && typeof q.answer === 'number') {
      built = { q: q.q, choices: q.choices, answer: q.answer, context: q.context, fact: q.fact, subject };
    }
  } catch { /* fall through to the bank */ }
  if (!built) built = { ...FALLBACK[hash(today) % FALLBACK.length], subject: 'mixed' };

  const docData: QotdDoc = { date: today, ...built };
  try {
    // Re-check right before writing: if someone beat us to it this very moment,
    // keep theirs so the whole family shares one question.
    const fresh = await readQotd(familyId);
    if (fresh) return fresh;
    await setDoc(qotdRef(familyId), { ...docData, createdAt: Date.now() }, { merge: true });
  } catch { /* best-effort — this player still sees `docData` */ }
  return docData;
}

/** This player's QotD streak (read from their gameStats doc). */
export async function readMyStreak(familyId: string, uid: string): Promise<QotdStreak> {
  try {
    const snap = await getDoc(doc(db, 'families', familyId, 'gameStats', uid));
    const d = snap.data() as { qotdLast?: string; qotdStreak?: number; qotdBest?: number } | undefined;
    return { last: d?.qotdLast || '', streak: Number(d?.qotdStreak) || 0, best: Number(d?.qotdBest) || 0 };
  } catch { return { last: '', streak: 0, best: 0 }; }
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
