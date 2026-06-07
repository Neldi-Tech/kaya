'use client';

import { useEffect, useRef, useState } from 'react';
import { updateSession, updateSessionFields, type GameSession } from '@/lib/gameSessions';
import { readTriviaSeen, recordTriviaSeen, dedupeAgainst } from '@/lib/triviaSeen';
import { countryByCode } from '@/lib/countries';
import { recordCountryPlayed } from '@/lib/triviaPassport';

// Multi-device Family Trivia v2 — pick a subject, then race: every question is
// TIMED and auto-advances (no host button). Points scale with speed and the
// FIRST correct answer gets a bonus. The host's client is the single writer of
// state transitions (reveal/advance) so devices never race; players only write
// their own answer. The host generates fresh AI questions per subject via
// /api/games/trivia, with the hand-authored bank below as an instant fallback.

export interface TriviaQ { q: string; choices: string[]; answer: number; context?: string; fact?: string }

const QUESTION_SECS = 15;
const REVEAL_SECS = 5; // a touch longer so the "Did you know?" fact can be read
const PER_GAME = 8;

// Difficulty → Fun-Points multiplier (harder = learn more + more ✨) + a glyph.
const FUN_MULT: Record<string, number> = { easy: 1, medium: 1.5, hard: 2 };
const LEVEL_EMOJI: Record<string, string> = { easy: '🟢', medium: '🟡', hard: '🔴' };

export const TRIVIA_SUBJECTS: { id: string; label: string; icon: string }[] = [
  { id: 'animals', label: 'Animals', icon: '🦁' },
  { id: 'science', label: 'Science', icon: '🔬' },
  { id: 'geography', label: 'Geography', icon: '🌍' },
  { id: 'sports', label: 'Sports', icon: '⚽' },
  { id: 'words', label: 'Words & Books', icon: '📚' },
  { id: 'mixed', label: 'Fun & Mixed', icon: '🎲' },
];

const BANKS: Record<string, TriviaQ[]> = {
  animals: [
    { q: 'How many legs does a spider have?', choices: ['6', '8', '10', '4'], answer: 1 },
    { q: 'What do bees make?', choices: ['Milk', 'Honey', 'Silk', 'Bread'], answer: 1 },
    { q: 'Which animal is "king of the jungle"?', choices: ['Tiger', 'Lion', 'Bear', 'Wolf'], answer: 1 },
    { q: 'What is a baby dog called?', choices: ['Kitten', 'Puppy', 'Cub', 'Calf'], answer: 1 },
    { q: 'What sound does a cat make?', choices: ['Woof', 'Moo', 'Meow', 'Quack'], answer: 2 },
    { q: 'Which is the fastest land animal?', choices: ['Cheetah', 'Horse', 'Dog', 'Elephant'], answer: 0 },
    { q: 'A group of wolves is called a…', choices: ['Herd', 'Pack', 'Flock', 'School'], answer: 1 },
  ],
  science: [
    { q: 'What planet do we live on?', choices: ['Mars', 'Venus', 'Earth', 'Jupiter'], answer: 2 },
    { q: 'What is frozen water called?', choices: ['Steam', 'Ice', 'Rain', 'Cloud'], answer: 1 },
    { q: 'How many planets are in our solar system?', choices: ['7', '8', '9', '10'], answer: 1 },
    { q: 'What gas do we breathe to live?', choices: ['Oxygen', 'Helium', 'Smoke', 'Sugar'], answer: 0 },
    { q: 'A magnet attracts…', choices: ['Wood', 'Metal', 'Plastic', 'Paper'], answer: 1 },
    { q: 'What do plants need to grow?', choices: ['Sunlight', 'Darkness', 'Candy', 'Ice'], answer: 0 },
    { q: 'What is the closest star to Earth?', choices: ['The Moon', 'The Sun', 'Mars', 'Pluto'], answer: 1 },
  ],
  geography: [
    { q: 'Which is the biggest ocean?', choices: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], answer: 2 },
    { q: 'How many continents are there?', choices: ['5', '6', '7', '8'], answer: 2 },
    { q: 'What is the tallest mountain on Earth?', choices: ['Kilimanjaro', 'Everest', 'Alps', 'Fuji'], answer: 1 },
    { q: 'The Sahara is a huge…', choices: ['Ocean', 'Desert', 'Forest', 'City'], answer: 1 },
    { q: 'What is frozen at the North & South Poles?', choices: ['Sand', 'Ice', 'Lava', 'Grass'], answer: 1 },
    { q: 'Which is bigger — a city or a country?', choices: ['City', 'Country', 'Same', 'Neither'], answer: 1 },
  ],
  sports: [
    { q: 'How many players are on a soccer team on the field?', choices: ['9', '10', '11', '12'], answer: 2 },
    { q: 'How many rings are on the Olympic flag?', choices: ['4', '5', '6', '7'], answer: 1 },
    { q: 'Which sport uses a racket and a net?', choices: ['Tennis', 'Boxing', 'Swimming', 'Golf'], answer: 0 },
    { q: 'What does a goalkeeper guard?', choices: ['The ball', 'The goal', 'The flag', 'The bench'], answer: 1 },
    { q: 'In basketball, you score by getting the ball in the…', choices: ['Net/Hoop', 'Goal', 'Hole', 'Box'], answer: 0 },
    { q: 'How many players run in a 4×100m relay team?', choices: ['2', '3', '4', '5'], answer: 2 },
  ],
  words: [
    { q: 'What is the opposite of "hot"?', choices: ['Warm', 'Cold', 'Big', 'Fast'], answer: 1 },
    { q: 'How many letters are in the English alphabet?', choices: ['24', '25', '26', '27'], answer: 2 },
    { q: 'What is the past tense of "run"?', choices: ['Runned', 'Ran', 'Running', 'Runs'], answer: 1 },
    { q: 'Which word rhymes with "cat"?', choices: ['Dog', 'Hat', 'Cup', 'Sun'], answer: 1 },
    { q: 'What does a library lend you?', choices: ['Books', 'Food', 'Shoes', 'Toys'], answer: 0 },
    { q: 'A word that means a baby cat is a…', choices: ['Puppy', 'Kitten', 'Cub', 'Foal'], answer: 1 },
  ],
  mixed: [
    { q: 'How many colours are in a rainbow?', choices: ['5', '6', '7', '9'], answer: 2 },
    { q: 'Mix blue and yellow — what colour?', choices: ['Green', 'Purple', 'Orange', 'Pink'], answer: 0 },
    { q: 'How many days are in a week?', choices: ['5', '6', '7', '8'], answer: 2 },
    { q: 'How many sides does a triangle have?', choices: ['3', '4', '5', '6'], answer: 0 },
    { q: 'Which shape has no corners?', choices: ['Square', 'Circle', 'Triangle', 'Star'], answer: 1 },
    { q: 'What number comes right after 9?', choices: ['8', '10', '11', '19'], answer: 1 },
  ],
};

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function pickQuestions(subject: string): TriviaQ[] {
  const bank = BANKS[subject] || BANKS.mixed;
  return shuffle(bank).slice(0, PER_GAME);
}

// Ask the server to generate FRESH AI questions for this subject. Returns []
// on any failure / when the AI key isn't set, so the caller falls back to the
// hand-authored bank above. Shape-guarded so a bad payload can't crash a game.
interface GenOpts { subject?: string; country?: string; discipline?: string; difficulty: string; count: number; avoid?: string[] }
async function fetchAiTrivia(opts: GenOpts): Promise<TriviaQ[]> {
  try {
    const res = await fetch('/api/games/trivia', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { questions?: TriviaQ[]; skipped?: boolean };
    if (data.skipped || !Array.isArray(data.questions)) return [];
    return data.questions.filter((q) =>
      !!q && typeof q.q === 'string' && q.q.trim().length > 0
      && Array.isArray(q.choices) && q.choices.length === 4
      && q.choices.every((c) => typeof c === 'string' && c.trim().length > 0)
      && typeof q.answer === 'number' && q.answer >= 0 && q.answer <= 3);
  } catch {
    return [];
  }
}

// Empty until the host picks a subject in-game (keeps the subject picker inside
// this component, so the multi-device room needs no trivia-specific edits).
export function triviaInitialState(): Record<string, unknown> {
  return { subject: '', difficulty: 'medium', funMult: 1.5, questions: [], qIndex: 0, qStartAt: 0, answers: {}, scores: {}, revealed: false };
}

interface Ans { choice: number; at: number }

export default function FamilyTriviaPlay({
  session, me, familyId,
}: {
  session: GameSession;
  me: string;
  familyId: string;
}) {
  const st = session.state;
  const subject = (st.subject as string) || '';
  const difficulty = (st.difficulty as string) || 'medium';
  const country = (st.country as string) || '';        // Local Trivia (ISO code)
  const discipline = (st.discipline as string) || 'mixed';
  const isLocal = country !== '';
  const questions = (st.questions as TriviaQ[]) || [];
  const qIndex = (st.qIndex as number) || 0;
  const qStartAt = (st.qStartAt as number) || 0;
  const answers = (st.answers as Record<string, Ans>) || {};
  const scores = (st.scores as Record<string, number>) || {};
  const revealed = !!st.revealed;
  const generating = !!st.generating;
  const explored = (st.explored as number) || 0;
  const isHost = session.hostUid === me;
  const players = session.players;
  const q = questions[qIndex];
  const total = questions.length;
  const myAnswer = answers[me];

  // Local clock so every device can show the countdown off the shared qStartAt.
  const [nowMs, setNowMs] = useState(() => qStartAt || 0);
  useEffect(() => {
    const iv = window.setInterval(() => setNowMs(Date.now()), 200);
    return () => window.clearInterval(iv);
  }, []);
  const elapsed = qStartAt ? Math.max(0, (nowMs - qStartAt) / 1000) : 0;
  const remaining = Math.max(0, Math.ceil(QUESTION_SECS - elapsed));
  const allAnswered = players.length > 0 && players.every((p) => answers[p.uid] !== undefined);

  // Host generates the question set once a subject is picked: AI first, with
  // the hand-authored bank as an instant fallback. Only the host writes them,
  // so every device gets the same questions. Fires once per subject (genRef).
  const genRef = useRef('');
  useEffect(() => {
    if (!isHost || (subject === '' && country === '') || questions.length > 0) return;
    const key = `${subject}|${country}|${discipline}|${difficulty}`;
    if (genRef.current === key) return;
    genRef.current = key;
    let cancelled = false;
    (async () => {
      // Never-repeats: over-fetch, tell the AI what we've recently asked, then
      // drop any that still slipped through, and remember the fresh ones.
      // Scoped per mode (general vs each country) so pools stay separate.
      const scope = isLocal ? `local_${country}` : 'general';
      const seen = await readTriviaSeen(familyId, scope);
      const cname = countryByCode(country)?.name || country;
      let qs = dedupeAgainst(await fetchAiTrivia({
        subject: isLocal ? undefined : subject,
        country: isLocal ? cname : undefined,
        discipline: isLocal ? discipline : undefined,
        difficulty, count: PER_GAME + 8, avoid: seen.recent.slice(0, 50),
      }), seen.recent);
      if (qs.length < 4) qs = pickQuestions(subject || 'mixed'); // AI down/keyless → bank
      if (cancelled) return;
      const chosen = qs.slice(0, PER_GAME);
      const explored = await recordTriviaSeen(familyId, chosen.map((c) => c.q), seen, scope);
      if (isLocal) void recordCountryPlayed(familyId, country); // 🛂 stamp the passport
      await updateSessionFields(familyId, session.id, {
        'state.questions': chosen,
        'state.qStartAt': Date.now(),
        'state.generating': false,
        'state.funMult': FUN_MULT[difficulty] ?? 1.5,
        'state.explored': explored,
      });
    })();
    return () => { cancelled = true; };
  }, [isHost, subject, country, discipline, difficulty, questions.length, familyId, session.id, isLocal]);

  // Host writes the reveal once the timer runs out or everyone has answered.
  // Idempotent per question via revealedRef — safe to re-evaluate each tick.
  const revealedRef = useRef('');
  useEffect(() => {
    if (!isHost || !q || !qStartAt || subject === '' || revealed) return;
    if (elapsed < QUESTION_SECS && !allAnswered) return;
    const key = `reveal-${qIndex}`;
    if (revealedRef.current === key) return;
    revealedRef.current = key;
    const ns = { ...scores };
    Object.entries(answers)
      .filter(([, a]) => a.choice === q.answer)
      .sort((a, b) => a[1].at - b[1].at)
      .forEach(([uid, a], i) => {
        ns[uid] = (ns[uid] || 0) + Math.max(10, Math.round(100 - a.at * 6)) + (i === 0 ? 25 : 0);
      });
    void updateSessionFields(familyId, session.id, { 'state.scores': ns, 'state.revealed': true });
  }, [isHost, q, qStartAt, subject, revealed, elapsed, allAnswered, qIndex, answers, scores, familyId, session.id]);

  // Host advances (or ends) a beat after the reveal. NOT tied to the clock
  // tick, so the timeout isn't cleared on every render.
  useEffect(() => {
    if (!isHost || !revealed) return;
    const t = window.setTimeout(() => {
      if (qIndex + 1 >= total) void updateSession(familyId, session.id, { status: 'done' });
      else void updateSessionFields(familyId, session.id, {
        'state.qIndex': qIndex + 1, 'state.qStartAt': Date.now(), 'state.answers': {}, 'state.revealed': false,
      });
    }, REVEAL_SECS * 1000);
    return () => window.clearTimeout(t);
  }, [isHost, revealed, qIndex, total, familyId, session.id]);

  const pick = (c: number) => {
    if (revealed || myAnswer !== undefined || elapsed >= QUESTION_SECS) return;
    void updateSessionFields(familyId, session.id, { [`state.answers.${me}`]: { choice: c, at: Number(elapsed.toFixed(2)) } });
  };

  // ── Subject picker (host) — family mode only; Local Trivia is set in lobby ──
  if (subject === '' && !isLocal) {
    if (!isHost) return <p className="text-center text-sm text-games-ink-soft py-12">The host is choosing a subject…</p>;
    return (
      <div className="mx-auto" style={{ maxWidth: 340 }}>
        <p className="text-center font-display font-extrabold text-games-ink mb-4">Pick a subject 🎯</p>
        <div className="grid grid-cols-2 gap-2.5">
          {TRIVIA_SUBJECTS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => updateSession(familyId, session.id, {
                state: { subject: s.id, questions: [], qIndex: 0, qStartAt: 0, answers: {}, scores: {}, revealed: false, generating: true },
              })}
              className="bg-games-card rounded-kaya p-4 text-center shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-95 transition-transform"
            >
              <div className="text-3xl mb-1">{s.icon}</div>
              <div className="font-display font-extrabold text-sm text-games-ink">{s.label}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (!q) return (
    <p className="text-center text-sm text-games-ink-soft py-12">
      {generating ? '✨ Making fresh questions…' : 'Loading questions…'}
    </p>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-bold text-games-ink-soft">{isLocal ? (countryByCode(country)?.flag || '🌍') : '🎯'} Q{qIndex + 1}/{total} · {LEVEL_EMOJI[difficulty] || '🟡'}</span>
        <span className={`text-sm font-display font-black ${remaining <= 5 && !revealed ? 'text-games-coral' : 'text-games-ink-soft'}`}>
          {revealed ? '✓ answer' : `⏱ ${remaining}s`}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-games-bg mb-4 overflow-hidden">
        <div className="h-full bg-games-teal" style={{ width: `${revealed ? 100 : (remaining / QUESTION_SECS) * 100}%`, transition: 'width 0.2s linear' }} />
      </div>

      <div className="bg-games-card rounded-kaya-lg p-5 mb-4 text-center shadow-[0_8px_24px_rgba(26,18,64,0.08)]">
        {q.context && <span className="inline-block bg-games-gold text-[#5b3d00] text-[10px] font-extrabold px-2.5 py-1 rounded-full mb-2 font-display">{q.context}</span>}
        <p className="font-display text-lg font-extrabold text-games-ink">{q.q}</p>
      </div>

      <div className="flex flex-col gap-2.5 mb-4">
        {q.choices.map((c, i) => {
          const correct = revealed && i === q.answer;
          const mineWrong = revealed && myAnswer?.choice === i && i !== q.answer;
          const chosen = myAnswer?.choice === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={revealed || myAnswer !== undefined || elapsed >= QUESTION_SECS}
              className={`rounded-kaya py-3 px-4 text-left font-bold text-sm shadow-[0_4px_12px_rgba(26,18,64,0.06)] ${
                correct ? 'bg-games-mint text-games-ink'
                  : mineWrong ? 'bg-[#FFE4E4] text-games-coral'
                    : chosen ? 'bg-games-violet text-white'
                      : 'bg-games-card text-games-ink'
              }`}
            >
              {c}{correct ? ' ✓' : ''}
            </button>
          );
        })}
      </div>
      {revealed && q.fact && (
        <div className="bg-gradient-to-br from-[#FFF7E6] to-[#FFFBF0] border border-[#FFE6A8] rounded-kaya p-3 mb-3 text-left">
          <p className="text-[13px] leading-snug text-games-ink"><b className="text-[#9a6a00]">💡 Did you know?</b> {q.fact}</p>
        </div>
      )}
      {myAnswer !== undefined && !revealed && (
        <p className="text-center text-xs text-games-ink-soft mb-3">Locked in! Fastest correct answers score the most ⚡</p>
      )}

      <div className="bg-games-bg rounded-kaya p-3">
        {[...players].sort((a, b) => (scores[b.uid] || 0) - (scores[a.uid] || 0)).map((p) => (
          <div key={p.uid} className="flex justify-between text-sm py-0.5">
            <span className="font-bold text-games-ink">{p.name}{p.uid === me ? ' (you)' : ''}</span>
            <span className="font-display font-black text-games-violet">{scores[p.uid] || 0}</span>
          </div>
        ))}
      </div>
      {explored > 0 && (
        <p className="text-center text-[10px] font-semibold text-games-ink-soft mt-2">🧠 {explored.toLocaleString()} questions explored — never repeated!</p>
      )}
    </div>
  );
}
