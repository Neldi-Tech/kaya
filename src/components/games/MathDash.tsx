'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import MultiDeviceRoom from './MultiDeviceRoom';
import { makeProblem, type MathProblem, MATH_DASH_SECONDS as DURATION } from '@/lib/mathDash';

// Timed mental-arithmetic sprint. As many correct as you can in 45s.
// Solo by default, with a one-tap "race on 2 phones" mode (room code) so
// siblings can go head-to-head on the same problems.

export default function MathDash({ onComplete }: GameProps) {
  const [mode, setMode] = useState<'solo' | 'multi'>('solo');
  if (mode === 'multi') {
    const game = getGame('math-dash');
    return game ? <MultiDeviceRoom game={game} onComplete={onComplete} /> : null;
  }
  return <MathDashSolo onComplete={onComplete} onRace={() => setMode('multi')} />;
}

function MathDashSolo({ onComplete, onRace }: GameProps & { onRace: () => void }) {
  const [problem, setProblem] = useState<MathProblem>(makeProblem);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(DURATION);
  const [flash, setFlash] = useState<'ok' | 'no' | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (done) return;
    if (left <= 0) { setDone(true); return; }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, done]);

  useEffect(() => {
    if (done) {
      const t = window.setTimeout(
        () => onComplete({
          success: score > 0,
          score,
          message: score > 0 ? `${score} correct! 🎉` : "Time's up! Try again",
        }),
        300,
      );
      return () => window.clearTimeout(t);
    }
  }, [done, score, onComplete]);

  const answer = useCallback((c: number) => {
    if (done) return;
    setFlash(c === problem.answer ? 'ok' : 'no');
    if (c === problem.answer) setScore((s) => s + 1);
    window.setTimeout(() => { setFlash(null); setProblem(makeProblem()); }, 200);
  }, [problem, done]);

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-bold text-games-ink-soft">Score: {score}</span>
        <span className="text-xs font-bold text-games-ink-soft">⏱ {left}s</span>
      </div>
      <div className="h-1.5 rounded-full bg-games-bg mb-5 overflow-hidden">
        <div className="h-full bg-games-teal transition-all duration-1000" style={{ width: `${(left / DURATION) * 100}%` }} />
      </div>
      <div
        className={`rounded-kaya-lg py-8 text-center mb-5 font-display font-black text-4xl text-games-ink transition-colors ${
          flash === 'ok' ? 'bg-games-mint' : flash === 'no' ? 'bg-[#FFE4E4]' : 'bg-games-card'
        }`}
      >
        {problem.text} = ?
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {problem.choices.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => answer(c)}
            disabled={done}
            className="bg-games-card rounded-kaya py-4 font-display font-extrabold text-xl text-games-violet shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-95 transition-transform"
          >
            {c}
          </button>
        ))}
      </div>
      {!done && (
        <div className="text-center mt-5">
          <button type="button" onClick={onRace} className="text-xs font-bold text-games-ink-soft underline">
            📲 Race a friend on 2 phones
          </button>
        </div>
      )}
    </div>
  );
}
