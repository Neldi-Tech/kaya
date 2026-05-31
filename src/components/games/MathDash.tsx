'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GameProps } from './types';

// Timed mental-arithmetic sprint. As many correct as you can in 45s.

const DURATION = 45;

interface Problem { text: string; answer: number; choices: number[] }

function makeProblem(): Problem {
  const op = Math.random() < 0.5 ? '+' : '-';
  let a = 1 + Math.floor(Math.random() * 12);
  let b = 1 + Math.floor(Math.random() * 12);
  if (op === '-' && b > a) [a, b] = [b, a];
  const answer = op === '+' ? a + b : a - b;
  const choices = new Set<number>([answer]);
  while (choices.size < 4) {
    const d = answer + (Math.floor(Math.random() * 7) - 3);
    if (d >= 0 && d !== answer) choices.add(d);
  }
  const arr = [...choices];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return { text: `${a} ${op} ${b}`, answer, choices: arr };
}

export default function MathDash({ onComplete }: GameProps) {
  const [problem, setProblem] = useState<Problem>(makeProblem);
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
    </div>
  );
}
