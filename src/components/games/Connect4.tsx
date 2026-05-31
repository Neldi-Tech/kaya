'use client';

import { useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import { type Disc, C4_COLS, C4_ROWS, c4DropRow, c4CheckWin, c4IsFull, c4DiscColor } from '@/lib/connect4';
import MultiDeviceRoom from './MultiDeviceRoom';

// Connect 4, two ways:
//   • 👫 Same device — pass-and-play, 2 players take turns on one device.
//   • 📲 Two phones — each player on their own device via a room code (board
//     syncs through the multi-device room).
// Drop a disc into a column; first to four in a row (any direction) wins.
// Points follow the parent's per-game value + approval, like every game.

type Mode = 'duo' | 'multi';

export default function Connect4({ onComplete }: GameProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [board, setBoard] = useState<Disc[]>(() => Array(C4_ROWS * C4_COLS).fill(0));
  const [turn, setTurn] = useState<1 | 2>(1);
  const [winner, setWinner] = useState<Disc>(0);

  const drop = (c: number) => {
    if (winner) return;
    const idx = c4DropRow(board, c);
    if (idx < 0) return;
    const nb = [...board];
    nb[idx] = turn;
    setBoard(nb);
    const w = c4CheckWin(nb, idx);
    if (w) {
      setWinner(w);
      window.setTimeout(() => onComplete({ success: true, score: 1, message: `${w === 1 ? '🔴 Red' : '🟡 Yellow'} wins! 🎉` }), 450);
      return;
    }
    if (c4IsFull(nb)) {
      window.setTimeout(() => onComplete({ success: true, score: 0, message: "It's a draw 🤝" }), 450);
      return;
    }
    setTurn(turn === 1 ? 2 : 1);
  };

  // ── Mode picker ──────────────────────────────────────────────────────────
  if (!mode) {
    return (
      <div className="mx-auto" style={{ maxWidth: 320 }}>
        <p className="text-center text-sm font-extrabold text-games-ink mb-4">How do you want to play?</p>
        <div className="space-y-2.5">
          <button type="button" onClick={() => setMode('duo')} className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left">
            <span className="text-3xl">👫</span>
            <span>
              <span className="block font-display font-extrabold text-games-ink">Same device</span>
              <span className="block text-[11px] font-semibold text-games-ink-soft">Two players, take turns on this device</span>
            </span>
          </button>
          <button type="button" onClick={() => setMode('multi')} className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left">
            <span className="text-3xl">📲</span>
            <span>
              <span className="block font-display font-extrabold text-games-ink">Two phones</span>
              <span className="block text-[11px] font-semibold text-games-ink-soft">Each player on their own device · room code</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'multi') {
    const game = getGame('connect-4');
    if (!game) return null;
    return <MultiDeviceRoom game={game} onComplete={onComplete} />;
  }

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
            onClick={() => drop(i % C4_COLS)}
            className="aspect-square rounded-full flex items-center justify-center"
            style={{ background: c4DiscColor(v) }}
            aria-label={`Column ${(i % C4_COLS) + 1}`}
          />
        ))}
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-4">Tap a column to drop your disc · 4 in a row wins</p>
    </div>
  );
}
