'use client';

import { useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import { slAdvance, slRollDie } from '@/lib/snakesLadders';
import SnakesLaddersBoard from './SnakesLaddersBoard';
import MultiDeviceRoom from './MultiDeviceRoom';

// Snakes & Ladders, two ways:
//   • 👫 Same device — pass-and-play, 2 players take turns on one device.
//   • 📲 Two phones — each player on their own device via a room code.
// Roll, climb ladders, dodge snakes, first to exactly 100 wins. Points follow
// the parent's per-game value + approval, like every game.

type Mode = 'duo' | 'multi';

export default function SnakesLadders({ onComplete }: GameProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [die, setDie] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);

  const roll = () => {
    if (winner !== null || rolling) return;
    setRolling(true);
    const d = slRollDie();
    setDie(d);
    const next = slAdvance(pos[turn], d);
    const np: [number, number] = turn === 0 ? [next, pos[1]] : [pos[0], next];
    window.setTimeout(() => {
      setPos(np);
      if (next === 100) {
        setWinner(turn);
        window.setTimeout(() => onComplete({ success: true, score: 1, message: `${turn === 0 ? '🔴 Player 1' : '🟡 Player 2'} wins! 🎉` }), 500);
      } else {
        setTurn(turn === 0 ? 1 : 0);
      }
      setRolling(false);
    }, 350);
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
    const game = getGame('snakes-ladders');
    if (!game) return null;
    return <MultiDeviceRoom game={game} onComplete={onComplete} />;
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <SnakesLaddersBoard pos={pos} />

      <div className="flex items-center justify-center gap-4 mt-5">
        <div className="text-center">
          <p className="text-[11px] font-bold text-games-ink-soft">🔴 P1: {pos[0]} · 🟡 P2: {pos[1]}</p>
          <p className={`text-sm font-extrabold ${turn === 0 ? 'text-games-coral' : 'text-games-gold'}`}>
            {winner !== null ? 'Game over' : `${turn === 0 ? '🔴 Player 1' : '🟡 Player 2'}'s roll`}
          </p>
        </div>
        <button
          type="button"
          onClick={roll}
          disabled={winner !== null || rolling}
          className="bg-games-violet text-white font-display font-black text-xl w-16 h-16 rounded-kaya shadow-[0_4px_12px_rgba(26,18,64,0.15)] active:scale-90 transition-transform disabled:opacity-50"
        >
          {die ?? '🎲'}
        </button>
      </div>
    </div>
  );
}
