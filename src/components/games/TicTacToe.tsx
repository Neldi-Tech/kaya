'use client';

import { useCallback, useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import { type Cell, decideTicTacToe as decide, aiMove, tttGlyph as glyph } from '@/lib/ticTacToe';
import MultiDeviceRoom from './MultiDeviceRoom';

// Tic-Tac-Toe, three ways:
//   • 👫 Play a friend — pass-and-play, 2 family members on one device (X vs O).
//   • 📲 Play on two phones — each player on their own device via a room code
//     (reuses the multi-device room; board syncs through the session).
//   • 🤖 Play the computer — vs a simple beatable AI; kid is X.
// Points follow the same rules as every game: the parent's per-game value
// (default 0 = just for fun) + approval — nothing special here.

type Mode = 'duo' | 'multi' | 'ai';

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
          <PickerButton emoji="👫" title="Play a friend" sub="Two players, take turns on this device" onClick={() => setMode('duo')} />
          <PickerButton emoji="📲" title="Play on two phones" sub="Each player on their own device · room code" onClick={() => setMode('multi')} />
          <PickerButton emoji="🤖" title="Play the computer" sub="You're ❌ · beat the bot" onClick={() => setMode('ai')} />
        </div>
      </div>
    );
  }

  // ── Two-device room ────────────────────────────────────────────────────────
  if (mode === 'multi') {
    const game = getGame('tic-tac-toe');
    if (!game) return null;
    return <MultiDeviceRoom game={game} onComplete={onComplete} />;
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

function PickerButton({ emoji, title, sub, onClick }: { emoji: string; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left"
    >
      <span className="text-3xl">{emoji}</span>
      <span>
        <span className="block font-display font-extrabold text-games-ink">{title}</span>
        <span className="block text-[11px] font-semibold text-games-ink-soft">{sub}</span>
      </span>
    </button>
  );
}
