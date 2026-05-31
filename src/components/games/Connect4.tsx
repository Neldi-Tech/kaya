'use client';

import { useState } from 'react';
import type { GameProps } from './types';

// Connect 4 — pass-and-play, 2 players on one device. Drop a disc into a
// column; first to four in a row (any direction) wins.

const COLS = 7;
const ROWS = 6;
type Disc = 0 | 1 | 2;

function checkWin(b: Disc[], last: number): Disc {
  const player = b[last];
  if (!player) return 0;
  const r = Math.floor(last / COLS), c = last % COLS;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let rr = r + dr * sign, cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && b[rr * COLS + cc] === player) {
        count++; rr += dr * sign; cc += dc * sign;
      }
    }
    if (count >= 4) return player;
  }
  return 0;
}

export default function Connect4({ onComplete }: GameProps) {
  const [board, setBoard] = useState<Disc[]>(() => Array(ROWS * COLS).fill(0));
  const [turn, setTurn] = useState<1 | 2>(1);
  const [winner, setWinner] = useState<Disc>(0);

  const drop = (c: number) => {
    if (winner) return;
    let row = -1;
    for (let r = ROWS - 1; r >= 0; r--) { if (board[r * COLS + c] === 0) { row = r; break; } }
    if (row < 0) return;
    const idx = row * COLS + c;
    const nb = [...board];
    nb[idx] = turn;
    setBoard(nb);
    const w = checkWin(nb, idx);
    if (w) {
      setWinner(w);
      window.setTimeout(() => onComplete({ success: true, score: 1, message: `${w === 1 ? '🔴 Red' : '🟡 Yellow'} wins! 🎉` }), 450);
      return;
    }
    if (nb.every((v) => v !== 0)) {
      window.setTimeout(() => onComplete({ success: true, score: 0, message: "It's a draw 🤝" }), 450);
      return;
    }
    setTurn(turn === 1 ? 2 : 1);
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <p className="text-center text-sm font-extrabold mb-3">
        {winner ? (winner === 1 ? '🔴 Red wins!' : '🟡 Yellow wins!') : (
          <span className={turn === 1 ? 'text-games-coral' : 'text-games-gold'}>
            {turn === 1 ? '🔴 Red' : '🟡 Yellow'}&rsquo;s turn
          </span>
        )}
      </p>
      <div className="grid grid-cols-7 gap-1.5 p-2 rounded-kaya bg-games-violet" style={{ width: 'min(92vw, 320px)', margin: '0 auto' }}>
        {board.map((v, i) => (
          <button
            key={i}
            type="button"
            onClick={() => drop(i % COLS)}
            className="aspect-square rounded-full flex items-center justify-center"
            style={{ background: v === 0 ? '#F5F0FF' : v === 1 ? '#FF6B6B' : '#FFC93C' }}
            aria-label={`Column ${(i % COLS) + 1}`}
          />
        ))}
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-4">Tap a column to drop your disc · 4 in a row wins</p>
    </div>
  );
}
