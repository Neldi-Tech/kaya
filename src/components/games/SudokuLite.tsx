'use client';

import { useState } from 'react';
import type { GameProps } from './types';

// 4×4 Sudoku — every row, column and 2×2 box holds 1–4. Baked, verified
// boards (givens are a subset of the solution).

interface Puzzle { givens: number[]; solution: number[] }

const PUZZLES: Puzzle[] = [
  { solution: [1, 2, 3, 4, 3, 4, 1, 2, 2, 1, 4, 3, 4, 3, 2, 1], givens: [1, 0, 0, 4, 0, 4, 1, 0, 0, 1, 4, 0, 4, 0, 0, 1] },
  { solution: [2, 3, 4, 1, 4, 1, 2, 3, 1, 4, 3, 2, 3, 2, 1, 4], givens: [2, 0, 4, 0, 0, 1, 0, 3, 1, 0, 3, 0, 0, 2, 0, 4] },
  { solution: [4, 1, 2, 3, 2, 3, 4, 1, 1, 4, 3, 2, 3, 2, 1, 4], givens: [4, 0, 0, 3, 0, 3, 4, 0, 0, 4, 3, 0, 3, 0, 0, 4] },
];

export default function SudokuLite({ onComplete }: GameProps) {
  const [puzzle] = useState(() => PUZZLES[Math.floor(Math.random() * PUZZLES.length)]);
  const [board, setBoard] = useState<number[]>(() => [...puzzle.givens]);
  const [sel, setSel] = useState<number | null>(null);
  const [wrong, setWrong] = useState(false);

  const isGiven = (i: number) => puzzle.givens[i] !== 0;

  const place = (n: number) => {
    if (sel === null || isGiven(sel)) return;
    const nb = [...board];
    nb[sel] = nb[sel] === n ? 0 : n;
    setBoard(nb);
    setWrong(false);
    if (nb.every((v) => v !== 0)) {
      if (nb.every((v, i) => v === puzzle.solution[i])) {
        window.setTimeout(() => onComplete({ success: true, score: 1, message: 'Sudoku solved! 🎉' }), 300);
      } else {
        setWrong(true);
      }
    }
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Fill 1–4 · no repeats in a row, column or box</p>
      <div className="grid grid-cols-4 mx-auto rounded-kaya overflow-hidden" style={{ width: 'min(100%, 264px)', border: '2px solid #4A1FB8' }}>
        {board.map((v, i) => {
          const r = Math.floor(i / 4), c = i % 4;
          const given = isGiven(i);
          const selected = sel === i;
          return (
            <button
              key={i}
              type="button"
              onClick={() => !given && setSel(i)}
              disabled={given}
              className={`aspect-square flex items-center justify-center font-display font-black text-xl ${
                selected ? 'bg-games-violet/20' : 'bg-games-card'
              } ${given ? 'text-games-ink' : 'text-games-violet'}`}
              style={{
                borderRight: c % 2 === 1 ? '2px solid #4A1FB8' : '1px solid #EDE9FE',
                borderBottom: r % 2 === 1 ? '2px solid #4A1FB8' : '1px solid #EDE9FE',
              }}
            >
              {v || ''}
            </button>
          );
        })}
      </div>
      {wrong && <p className="text-center text-xs font-bold text-games-coral mt-3">Not quite — check for repeats and fix a cell.</p>}
      <div className="flex justify-center gap-2.5 mt-5">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => place(n)}
            disabled={sel === null}
            className="w-12 h-12 rounded-kaya bg-games-violet text-white font-display font-black text-xl shadow-[0_4px_12px_rgba(26,18,64,0.12)] active:scale-90 transition-transform disabled:opacity-40"
          >
            {n}
          </button>
        ))}
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-4">Tap a blank cell, then a number. Tap the same number to clear.</p>
    </div>
  );
}
