// HP2 · Kids review helpers — question sets (D11, approved 2026-08-23).
// Pure module (no Firebase) shared by the kid flow, the Admin route and
// the parent tab / emails.
//
// 4 face-taps: Q1 is common ("How did this week feel?"), Q2–Q4 are
// flavoured by the helper's preset so a driver is asked about time +
// safety and a tutor about patience + explaining. Faces score
// 100 / 70 / 40 / 0; the kid-review % for a week = mean of the 4. The
// helper-level number parents see = mean across the kids who reviewed.
// Then "One thing you liked" + "One thing to change" chips (+ optional
// short note). Version the set so stored reviews stay readable.

export const KID_REVIEW_VERSION = 1;

export const FACES = [
  { idx: 0, emoji: '😃', score: 100 },
  { idx: 1, emoji: '🙂', score: 70 },
  { idx: 2, emoji: '😐', score: 40 },
  { idx: 3, emoji: '🙁', score: 0 },
] as const;

export interface KidQuestion {
  id: string;
  /** Shown to the kid with {name} replaced by the helper's first name. */
  text: string;
  /** Labels under the four faces (😃 🙂 😐 🙁). */
  labels: [string, string, string, string];
}

export interface KidQuestionSet {
  key: 'nanny' | 'tutor' | 'driver' | 'other';
  questions: [KidQuestion, KidQuestion, KidQuestion, KidQuestion];
  liked: string[];
  change: string[];
}

const Q1: KidQuestion = { id: 'feel', text: 'How did this week with {name} feel?', labels: ['Great', 'Good', 'So-so', 'Not good'] };
const YESNO: [string, string, string, string] = ['Always', 'Mostly', 'Sometimes', 'No'];

const SETS: Record<KidQuestionSet['key'], KidQuestionSet> = {
  nanny: {
    key: 'nanny',
    questions: [
      Q1,
      { id: 'kind', text: 'Was {name} kind to you?', labels: YESNO },
      { id: 'listen', text: 'Did {name} listen to you?', labels: YESNO },
      { id: 'help', text: 'Did {name} help you (food, bath, homework)?', labels: YESNO },
    ],
    liked: ['played with me', 'helped with homework', 'made nice food', 'kept me safe', 'listened to me', 'was on time'],
    change: ['was late', 'shouted', 'on the phone a lot', 'forgot something', 'nothing!'],
  },
  tutor: {
    key: 'tutor',
    questions: [
      Q1,
      { id: 'explain', text: 'Did {name} explain things well?', labels: YESNO },
      { id: 'patient', text: 'Was {name} patient with you?', labels: YESNO },
      { id: 'fun', text: 'Were the lessons fun?', labels: YESNO },
    ],
    liked: ['explained it well', 'was patient', 'made it fun', 'helped me get it', 'was on time', 'believed in me'],
    change: ['was late', 'went too fast', 'on the phone a lot', 'too much homework', 'nothing!'],
  },
  driver: {
    key: 'driver',
    questions: [
      Q1,
      { id: 'ontime', text: 'Was {name} on time?', labels: YESNO },
      { id: 'safe', text: 'Safe and careful in the car?', labels: YESNO },
      { id: 'kindcar', text: 'Kind in the car?', labels: YESNO },
    ],
    liked: ['was on time', 'played music I like', 'listened to me', 'kept me safe', 'waited for me', 'was friendly'],
    change: ['was late', 'on the phone a lot', 'drove fast', 'forgot something', 'nothing!'],
  },
  other: {
    key: 'other',
    questions: [
      Q1,
      { id: 'kind', text: 'Was {name} kind?', labels: YESNO },
      { id: 'helpful', text: 'Was {name} helpful?', labels: YESNO },
      { id: 'ontime', text: 'Was {name} on time?', labels: YESNO },
    ],
    liked: ['was kind', 'helped me', 'was on time', 'listened to me', 'made me laugh', 'kept me safe'],
    change: ['was late', 'shouted', 'on the phone a lot', 'forgot something', 'nothing!'],
  },
};

/** Pick the question set for a helper preset. */
export function questionSetFor(preset: string | undefined): KidQuestionSet {
  if (preset === 'nanny' || preset === 'grandparent') return SETS.nanny;
  if (preset === 'tutor') return SETS.tutor;
  if (preset === 'driver') return SETS.driver;
  return SETS.other;
}

export function fillName(text: string, firstName: string): string {
  return text.replace('{name}', firstName);
}

/** Score 4 face indices (0–3) → 0–100 mean. Returns null if incomplete. */
export function scoreAnswers(answers: number[]): number | null {
  if (answers.length !== 4 || answers.some((a) => !Number.isInteger(a) || a < 0 || a > 3)) return null;
  const sum = answers.reduce((acc, a) => acc + FACES[a].score, 0);
  return Math.round(sum / 4);
}

export function starsFor(pct: number): string {
  return '⭐'.repeat(Math.max(1, Math.min(5, Math.round(pct / 20))));
}

// ── Review window (D10 / Q2) ─────────────────────────────────────
// Fri 12:00 → Sun 23:59 in the family's day. Kaya has no per-family
// timezone yet; the server runs UTC. We open the window Fri 09:00 UTC
// (Fri 12:00 Dar / 13:00 Dubai / Fri 05:00 US-East) and close it Mon
// 02:59 UTC (Sun 23:59 US-West). Kids in Dar can review until Monday
// breakfast — that's fine; the week is still the settled one.
export function reviewWindowOpen(now: Date = new Date()): boolean {
  const dow = now.getUTCDay();      // 0 Sun … 6 Sat
  const h = now.getUTCHours();
  if (dow === 5) return h >= 9;     // Friday from 09:00 UTC
  if (dow === 6 || dow === 0) return true;
  if (dow === 1) return h < 3;      // Monday until 02:59 UTC
  return false;
}

/** The ISO week the open window reviews — Mon–Sun containing the
 *  Friday that opened it (on Monday 00–02:59 UTC, that's LAST week). */
export function reviewWeekAnchor(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  if (d.getUTCDay() === 1) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Next Friday 09:00 UTC after `now` (for "opens Friday" copy). */
export function nextWindowOpen(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 9, 0, 0));
  const dow = d.getUTCDay();
  const add = (5 - dow + 7) % 7;
  d.setUTCDate(d.getUTCDate() + (add === 0 && now.getTime() >= d.getTime() ? 7 : add));
  return d;
}
