'use client';

import { useCallback, useState } from 'react';
import type { GameProps } from './types';

// Tic-Tac-Toe, two ways:
//   • "Play a friend" — pass-and-play, 2 family members on one device (X vs O).
//   • "Play the computer" — vs a simple (beatable but not dumb) AI; kid is X.
// Calls onComplete once the board resolves. Fully offline, no deps.
// Points follow the same rules as every game: governed by the parent's
// per-game value (default 0 = just for fun) + approval — nothing special here.

type Cell = 'X' | 'O' | null;
type Mode = 'duo' | 'ai';

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

const glyph = (p: Cell) => (p === 'X' ? '❌' : p === 'O' ? '⭕' : '');

export default function TicTacToe({ onComplete }: GameProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [board, setBoard] = useState<Cell[]>(Array(9).fill(null));
  const [turn, setTurn] = useState<'X' | 'O'>('X'); // whose turn (duo mode)
  const [done, setDone] = useState(false);

  const finish = useCallback((result: Cell | 'draw') => {
    setDone(true);
    const draw = result === 'draw';
    const message = draw
      ? "It's a draw 🤝"
      : mode === 'ai'
        ? (result === 'X' ? 'You won! 🎉' : 'So close!')
        : `${glyph(result)} ${result} wins! 🎉`;
    // In friend mode a finished game always counts (like Connect 4); vs the
    // computer, only a win or draw counts as success.
    const success = mode === 'duo' ? true : (result === 'X' || draw);
    window.setTimeout(() => onComplete({ success, score: result === 'X' || (mode === 'duo' && !draw) ? 1 : 0, message }), 400);
  }, [mode, onComplete]);

  // vs the computer — kid plays X, AI replies as O.
  const playAi = useCallback((i: number) => {
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
    if (result) finish(result);
  }, [board, done, finish]);

  // pass-and-play — players alternate X then O on the same device.
  const playDuo = useCallback((i: number) => {
    if (done || board[i]) return;
    const next = [...board];
    next[i] = turn;
    setBoard(next);
    const result = decide(next);
    if (result) finish(result);
    else setTurn(turn === 'X' ? 'O' : 'X');
  }, [board, done, turn, finish]);

  // ── Mode picker ──────────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="mx-auto" style={{ maxWidth: 320 }}>
        <p className="text-center text-sm font-extrabold text-games-ink mb-4">How do you want to play?</p>
        <div className="space-y-2.5">
          <button
            type="button"
            onClick={() => setMode('duo')}
            className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left"
          >
            <span className="text-3xl">👫</span>
            <span>
              <span className="block font-display font-extrabold text-games-ink">Play a friend</span>
              <span className="block text-[11px] font-semibold text-games-ink-soft">Two players, take turns on this device</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => setMode('ai')}
            className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left"
          >
            <span className="text-3xl">🤖</span>
            <span>
              <span className="block font-display font-extrabold text-games-ink">Play the computer</span>
              <span className="block text-[11px] font-semibold text-games-ink-soft">You&rsquo;re ❌ · beat the bot</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  const play = mode === 'ai' ? playAi : playDuo;

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      {mode === 'duo' && (
        <p className="text-center text-sm font-extrabold mb-3">
          {done ? 'Game over' : (
            <span className={turn === 'X' ? 'text-games-violet' : 'text-games-coral'}>
              {glyph(turn)} {turn}&rsquo;s turn
            </span>
          )}
        </p>
      )}
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
        {mode === 'ai'
          ? <>You&rsquo;re <span className="text-games-violet font-extrabold">❌</span> · tap a square to play</>
          : <>Pass the device after each turn · three in a row wins</>}
      </p>
    </div>
  );
}
