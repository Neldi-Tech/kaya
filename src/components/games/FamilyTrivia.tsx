'use client';

import { updateSession, updateSessionFields, type GameSession } from '@/lib/gameSessions';

// Multi-device Family Trivia. Everyone answers the same question on their own
// phone; the host reveals + advances. v1 uses a built-in kid-friendly bank
// (parent-authored question packs are a fast-follow). Each player writes only
// their own answer field, so concurrent buzz-ins never clobber the doc.

interface TriviaQ { q: string; choices: string[]; answer: number }

const BANK: TriviaQ[] = [
  { q: 'How many legs does a spider have?', choices: ['6', '8', '10', '4'], answer: 1 },
  { q: 'What planet do we live on?', choices: ['Mars', 'Venus', 'Earth', 'Jupiter'], answer: 2 },
  { q: 'Mix blue and yellow — what colour?', choices: ['Green', 'Purple', 'Orange', 'Pink'], answer: 0 },
  { q: 'How many days are in a week?', choices: ['5', '6', '7', '8'], answer: 2 },
  { q: 'Which animal is "king of the jungle"?', choices: ['Tiger', 'Lion', 'Bear', 'Wolf'], answer: 1 },
  { q: 'What do bees make?', choices: ['Milk', 'Honey', 'Silk', 'Bread'], answer: 1 },
  { q: 'How many sides does a triangle have?', choices: ['3', '4', '5', '6'], answer: 0 },
  { q: 'What is frozen water called?', choices: ['Steam', 'Ice', 'Rain', 'Cloud'], answer: 1 },
  { q: 'Which is the biggest ocean?', choices: ['Atlantic', 'Indian', 'Pacific', 'Arctic'], answer: 2 },
  { q: 'What sound does a cat make?', choices: ['Woof', 'Moo', 'Meow', 'Quack'], answer: 2 },
  { q: 'How many colours are in a rainbow?', choices: ['5', '6', '7', '9'], answer: 2 },
  { q: 'What do you call a baby dog?', choices: ['Kitten', 'Puppy', 'Cub', 'Calf'], answer: 1 },
];

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export function triviaInitialState(): Record<string, unknown> {
  return { qIndex: 0, questions: shuffle(BANK).slice(0, 6), roundAnswers: {}, scores: {}, revealed: false };
}

export default function FamilyTriviaPlay({
  session, me, familyId,
}: {
  session: GameSession;
  me: string;
  familyId: string;
}) {
  const st = session.state;
  const questions = (st.questions as TriviaQ[]) || [];
  const qIndex = (st.qIndex as number) || 0;
  const roundAnswers = (st.roundAnswers as Record<string, number>) || {};
  const scores = (st.scores as Record<string, number>) || {};
  const revealed = !!st.revealed;
  const isHost = session.hostUid === me;
  const q = questions[qIndex];
  const myAnswer = roundAnswers[me];
  const total = questions.length;
  const allAnswered = session.players.length > 0 && session.players.every((p) => roundAnswers[p.uid] !== undefined);

  if (!q) return <p className="text-center text-games-ink-soft py-10">Loading question…</p>;

  const pick = (c: number) => {
    if (revealed || myAnswer !== undefined) return;
    void updateSessionFields(familyId, session.id, { [`state.roundAnswers.${me}`]: c });
  };
  const reveal = () => {
    const ns = { ...scores };
    for (const [uid, ch] of Object.entries(roundAnswers)) if (ch === q.answer) ns[uid] = (ns[uid] || 0) + 1;
    void updateSessionFields(familyId, session.id, { 'state.scores': ns, 'state.revealed': true });
  };
  const next = () => {
    if (qIndex + 1 >= total) void updateSession(familyId, session.id, { status: 'done' });
    else void updateSessionFields(familyId, session.id, { 'state.qIndex': qIndex + 1, 'state.roundAnswers': {}, 'state.revealed': false });
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">🎯 Question {qIndex + 1} of {total}</p>
      <div className="bg-games-card rounded-kaya-lg p-5 mb-4 text-center shadow-[0_8px_24px_rgba(26,18,64,0.08)]">
        <p className="font-display text-lg font-extrabold text-games-ink">{q.q}</p>
      </div>
      <div className="flex flex-col gap-2.5 mb-4">
        {q.choices.map((c, i) => {
          const correct = revealed && i === q.answer;
          const mineWrong = revealed && myAnswer === i && i !== q.answer;
          const chosen = myAnswer === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => pick(i)}
              disabled={revealed || myAnswer !== undefined}
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
      {myAnswer !== undefined && !revealed && (
        <p className="text-center text-xs text-games-ink-soft mb-3">Answered — waiting for the others…</p>
      )}

      <div className="bg-games-bg rounded-kaya p-3 mb-4">
        {session.players.map((p) => (
          <div key={p.uid} className="flex justify-between text-sm py-0.5">
            <span className="font-bold text-games-ink">{p.name}{p.uid === me ? ' (you)' : ''}</span>
            <span className="font-display font-black text-games-violet">{scores[p.uid] || 0}</span>
          </div>
        ))}
      </div>

      {isHost ? (
        revealed ? (
          <button type="button" onClick={next} className="w-full bg-games-violet text-white font-extrabold py-3 rounded-full">
            {qIndex + 1 >= total ? 'See results' : 'Next question'}
          </button>
        ) : (
          <button type="button" onClick={reveal} className="w-full bg-games-gold text-games-ink font-extrabold py-3 rounded-full">
            {allAnswered ? 'Reveal answer' : 'Reveal answer (waiting…)'}
          </button>
        )
      ) : (
        <p className="text-center text-xs text-games-ink-soft">{revealed ? 'Host will move on…' : 'Tap your answer above'}</p>
      )}
    </div>
  );
}
