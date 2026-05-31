'use client';

import { useCallback, useState } from 'react';
import type { GameProps } from './types';

// Tic-Tac-Toe vs a simple (beatable but not dumb) AI. Kid is X, AI is O.
// Calls onComplete once the board resolves. Fully offline, no deps.

type Cell = 'X' | 'O' | null;

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

function decide(b: Cell[]): Cell | 'draw' | null {
  for (const [a, c, d] of LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return b.every(Boolean) ? 'draw' : null;
}

function aiMove(b: Cell[]): number {
  const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const tryWin = (p: Cell): number => {
    for (const i of empty) {
      const t = [...b]; t[i] = p;
      if (decide(t) === p) return i;
    }
    return -1;
  };
  let m = tryWin('O'); if (m >= 0) return m;          // win if we can
  m = tryWin('X'); if (m >= 0) return m;              // else block the kid
  if (b[4] == null) return 4;                         // take centre
  const corners = [0, 2, 6, 8].filter((i) => b[i] == null);
  if (corners.length) return corners[0];              // then a corner
  return empty[0] ?? -1;                              // then anything
}

export default function TicTacToe({ onComplete }: GameProps) {
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [done, setDone] = useState(false);

  const play = useCallback((i: number) => {
    if (done || board[i]) return;
    const next = [...board];
    next[i] = 'X';
    let result = decide(next);
    if (!result) {
      const ai = aiMove(next);
      if (ai >= 0 && next[ai] == null) next[ai] = 'O';
      result = decide(next);
    }
    setBoard(next);
    if (result) {
      setDone(true);
      const won = result === 'X';
      const draw = result === 'draw';
      window.setTimeout(() => onComplete({
        success: won || draw,
        score: won ? 1 : 0,
        message: won ? 'You won! 🎉' : draw ? "It's a draw 🤝" : 'So close!',
      }), 400);
    }
  }, [board, done, onComplete]);

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="grid grid-cols-3 gap-2.5">
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => play(i)}
            disabled={done || !!cell}
            aria-label={`Square ${i + 1}${cell ? `, ${cell}` : ''}`}
            className={`aspect-square rounded-kaya bg-games-card shadow-[0_4px_12px_rgba(26,18,64,0.08)] flex items-center justify-center font-display font-black select-none transition-transform active:scale-95 ${
              cell ? '' : 'hover:-translate-y-0.5'
            }`}
            style={{ fontSize: 44 }}
          >
            <span className={cell === 'X' ? 'text-games-violet' : 'text-games-coral'}>
              {cell ?? ''}
            </span>
          </button>
        ))}
      </div>
      <p className="text-center text-xs font-semibold text-games-ink-soft mt-4">
        You&rsquo;re <span className="text-games-violet font-extrabold">X</span> · tap a square to play
      </p>
    </div>
  );
}
