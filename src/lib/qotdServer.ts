// Kaya Games — server-side Question-of-the-Day rotation (2026-07-19).
//
// THE fix for "same question every day": rotation no longer depends on a
// client freshly opening My Day. An hourly cron calls rotateQotdForFamily
// for every family that has ever used QotD; the family's question doc is
// replaced the first run after local midnight. Selection order:
//
//   1. 🎂 Birthday special — if a child's birthday is today, the question
//      IS about them (surprise #2).
//   2. Pool — spare AI questions banked from an earlier generation batch.
//   3. Fresh AI batch (Claude, same contract as /api/games/trivia): 1 for
//      today + spares into the pool. Failure → visible alertLog entry.
//   4. Curated 120-question bank (see qotdBank.ts), never repeating until
//      the whole bank has been seen (then least-recently-seen first).
//
// The doc keeps a `seen` fingerprint list (cap 400) so NO source may
// repeat a question the family has already had, a `serial` counter
// ("Question #142"), and `answeredUids` reset each day for the family
// progress line. Everything is Admin-SDK — no Firestore-rules change.

import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import Anthropic from '@anthropic-ai/sdk';
import { QOTD_BANK, qotdFingerprint, type QotdBankItem } from './qotdBank';

const apiKey = process.env.ANTHROPIC_API_KEY;
const client = apiKey ? new Anthropic({ apiKey }) : null;

/** Phase-1 timezone (matches pulseGenerate) — per-family tz can layer in later. */
export const QOTD_TZ = 'Africa/Dar_es_Salaam';

/** Sun..Sat weekly subject rhythm (approved design 2026-07-19). */
export const WEEKDAY_SUBJECTS = [
  'faith & family', 'science', 'geography', 'animals', 'numbers', 'words', 'sports & fun',
] as const;

export interface QotdQuestion {
  q: string;
  choices: string[];
  answer: number;
  context?: string;
  fact?: string;
  subject?: string;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function validQuestion(x: unknown): x is QotdQuestion {
  const q = x as QotdQuestion;
  return !!q && typeof q.q === 'string' && q.q.length > 0
    && Array.isArray(q.choices) && q.choices.length === 4
    && q.choices.every((c) => typeof c === 'string' && c.length > 0)
    && typeof q.answer === 'number' && q.answer >= 0 && q.answer <= 3;
}

/** Deterministic-ish shuffle keyed by the day so re-runs agree. */
function shuffledBy<T>(items: T[], key: string): T[] {
  return items
    .map((v, i) => ({ v, k: hash(`${key}:${i}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.v);
}

// ── 🎂 Surprise #2 — birthday special ────────────────────────────────
/** When a child's birthday (MM-DD) is today, the question is about THEM. */
async function birthdayQuestion(
  famRef: DocumentReference,
  todayKey: string,
): Promise<QotdQuestion | null> {
  try {
    const snap = await famRef.collection('children').get();
    const kids = snap.docs.map((d) => d.data() as { name?: string; birthday?: string });
    const mmdd = todayKey.slice(5);
    const star = kids.find((k) => typeof k.birthday === 'string' && k.birthday.slice(5) === mmdd && k.name);
    if (!star?.name) return null;
    const name = String(star.name).split(' ')[0];

    const birthYear = Number(String(star.birthday).slice(0, 4));
    const age = Number(todayKey.slice(0, 4)) - birthYear;
    if (Number.isFinite(age) && age > 0 && age < 25) {
      const options = shuffledBy([age, age - 1, age + 1, age + 2], todayKey);
      return {
        q: `🎂 It's ${name}'s birthday today! How old is ${name} turning?`,
        choices: options.map(String),
        answer: options.indexOf(age),
        context: '🎂 A very special day…',
        fact: `Happy birthday, ${name}! 🥳 The whole family wishes you a wonderful year ${age}.`,
        subject: 'birthday',
      };
    }
    // Year unknown → "whose birthday?" with sibling decoys.
    const others = kids.map((k) => String(k.name || '').split(' ')[0]).filter((n) => n && n !== name);
    const decoys = [...others, 'Mama', 'Baba'].slice(0, 3);
    if (decoys.length < 3) return null;
    const options = shuffledBy([name, ...decoys], todayKey);
    return {
      q: '🎂 Someone in this family has a birthday TODAY — who is it?',
      choices: options,
      answer: options.indexOf(name),
      context: '🎂 A very special day…',
      fact: `It's ${name}! 🥳 Make sure they get an extra-loud happy birthday today.`,
      subject: 'birthday',
    };
  } catch { return null; }
}

// ── Age-aware audience line (Elia, 21-Jul-2026) ──────────────────────
/** Real family age span from the kids' birthdays — e.g. "kids aged 5–11 and
 *  their parents". Kids without a birthday don't restrict anything; no
 *  birthdays at all falls back to the generic mixed-age line. */
async function familyAudience(famRef: DocumentReference, todayKey: string): Promise<string> {
  const generic = 'a mixed-age family (6–45)';
  try {
    const snap = await famRef.collection('children').get();
    const year = Number(todayKey.slice(0, 4));
    const ages = snap.docs
      .map((d) => (d.data() as { birthday?: string }).birthday)
      .filter((b): b is string => typeof b === 'string' && /^\d{4}-/.test(b))
      .map((b) => year - Number(b.slice(0, 4)))
      .filter((a) => Number.isFinite(a) && a > 0 && a < 25);
    if (ages.length === 0) return generic;
    const lo = Math.min(...ages);
    const hi = Math.max(...ages);
    return `a family with kids aged ${lo === hi ? lo : `${lo}–${hi}`} and their parents`;
  } catch { return generic; }
}

// ── Fresh AI batch (mirrors /api/games/trivia contract) ──────────────
const genSystem = (audience: string) => `You are Kaya's family trivia writer. Write kid-friendly multiple-choice questions ${audience} enjoys answering together — pitched so the youngest kids have a real shot while staying fun for everyone. Plain text only, no markdown. Vary which position holds the correct answer. Never repeat or paraphrase any question in the avoid list. No dark or scary themes. Each question gets a playful one-line "context" chip (with one emoji) and a true, delightful "Did you know?" fact.`;

async function generateBatch(subject: string, avoid: string[], audience: string): Promise<QotdQuestion[]> {
  if (!client) throw new Error('ANTHROPIC_API_KEY not set');
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1400,
    system: genSystem(audience),
    messages: [{
      role: 'user',
      content:
        `Write 4 medium-difficulty questions on the subject "${subject}".\n` +
        (avoid.length ? `Avoid these already-used questions:\n- ${avoid.join('\n- ')}\n` : '') +
        `Return ONLY JSON: {"questions":[{"q":string,"choices":[string,string,string,string],"answer":number,"context":string,"fact":string}]}`,
    }],
  });
  const text = response.content.find((b) => b.type === 'text')?.text ?? '';
  const jsonStart = text.indexOf('{');
  const parsed = JSON.parse(text.slice(jsonStart)) as { questions?: unknown[] };
  return (parsed.questions || []).filter(validQuestion).map((q) => ({ ...q, subject }));
}

/** Best-effort visibility for generation trouble — lands in the same 📜
 *  alertLog trail as the utility alerts, so failures are seen same-day. */
async function logGenFailure(famRef: DocumentReference, detail: string): Promise<void> {
  try {
    await famRef.collection('alertLog').add({
      kind: 'qotd-generate-failed',
      detail: detail.slice(0, 500),
      at: Date.now(),
    });
  } catch { /* never blocks rotation */ }
}

// ── The rotation ─────────────────────────────────────────────────────
export type RotateOutcome = 'fresh' | 'rotated' | 'skipped' | 'error';

/** Rotate the family's QotD doc to `todayKey` if it isn't already there.
 *  `onlyIfExists` (cron default) skips families that never used QotD —
 *  the client-side ensure covers a family's very first question. */
export async function rotateQotdForFamily(
  db: Firestore,
  familyId: string,
  todayKey: string,
  opts?: { onlyIfExists?: boolean },
): Promise<RotateOutcome> {
  const famRef = db.collection('families').doc(familyId);
  const ref = famRef.collection('gameMeta').doc('qotd');
  try {
    const snap = await ref.get();
    if (!snap.exists && opts?.onlyIfExists) return 'skipped';
    const cur = (snap.data() || {}) as {
      date?: string; serial?: number; seen?: string[]; pool?: QotdQuestion[];
    };
    if (cur.date === todayKey) return 'fresh';

    const seen: string[] = Array.isArray(cur.seen) ? cur.seen.filter((s) => typeof s === 'string') : [];
    const pool: QotdQuestion[] = Array.isArray(cur.pool) ? cur.pool.filter(validQuestion) : [];
    const dow = new Date(`${todayKey}T12:00:00Z`).getUTCDay();
    const subject = WEEKDAY_SUBJECTS[dow];

    // 1) 🎂 birthday beats everything
    let picked: QotdQuestion | null = await birthdayQuestion(famRef, todayKey);
    let nextPool = pool;

    // 2) banked pool spare (not yet seen)
    if (!picked) {
      const i = pool.findIndex((p) => !seen.includes(qotdFingerprint(p.q)));
      if (i >= 0) { picked = pool[i]; nextPool = pool.filter((_, j) => j !== i); }
    }

    // 3) fresh AI batch — 1 today + spares to the pool
    if (!picked) {
      try {
        const audience = await familyAudience(famRef, todayKey);
        const batch = (await generateBatch(subject, seen.slice(-40), audience)).filter(
          (q) => !seen.includes(qotdFingerprint(q.q)),
        );
        if (batch.length > 0) {
          picked = batch[0];
          nextPool = [...pool, ...batch.slice(1)].slice(0, 6);
        }
      } catch (e) {
        await logGenFailure(famRef, String(e));
      }
    }

    // 4) curated bank — prefer today's subject, never repeat until exhausted
    if (!picked) {
      const unseen = QOTD_BANK.filter((b) => !seen.includes(qotdFingerprint(b.q)));
      const preferred = unseen.filter((b) => b.subject === subject);
      const from: QotdBankItem[] = preferred.length ? preferred : unseen;
      if (from.length) {
        picked = from[hash(todayKey) % from.length];
      } else {
        // Whole bank seen — recycle least-recently-seen first.
        const bySeenOrder = [...QOTD_BANK].sort(
          (a, b) => seen.indexOf(qotdFingerprint(a.q)) - seen.indexOf(qotdFingerprint(b.q)),
        );
        picked = bySeenOrder[0];
      }
    }

    const fp = qotdFingerprint(picked.q);
    const nextSeen = [...seen.filter((s) => s !== fp), fp].slice(-400);
    // Full replace (not merge): clears answeredUids + any stale fields.
    await ref.set({
      date: todayKey,
      q: picked.q,
      choices: picked.choices,
      answer: picked.answer,
      context: picked.context || '',
      fact: picked.fact || '',
      subject: picked.subject || subject,
      serial: (Number(cur.serial) || 0) + 1,
      seen: nextSeen,
      pool: nextPool,
      answeredUids: [],
      rotatedBy: 'cron',
      createdAt: Date.now(),
    });
    return 'rotated';
  } catch {
    return 'error';
  }
}
