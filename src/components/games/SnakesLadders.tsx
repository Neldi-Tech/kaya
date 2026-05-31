'use client';

import { useState } from 'react';
import type { GameProps } from './types';

// Snakes & Ladders — pass-and-play, 2 players. Roll, climb ladders, dodge
// snakes, first to exactly 100 wins. Same-device.

const LADDERS: Record<number, number> = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 51: 67, 72: 91, 80: 99 };
const SNAKES: Record<number, number> = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 79 };

function cellNumber(rowFromTop: number, col: number): number {
  const br = 9 - rowFromTop;
  return br % 2 === 0 ? br * 10 + col + 1 : br * 10 + (10 - col);
}

export default function SnakesLadders({ onComplete }: GameProps) {
  const [pos, setPos] = useState<[number, number]>([0, 0]);
  const [turn, setTurn] = useState<0 | 1>(0);
  const [die, setDie] = useState<number | null>(null);
  const [winner, setWinner] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);

  const roll = () => {
    if (winner !== null || rolling) return;
    setRolling(true);
    const d = 1 + Math.floor(Math.random() * 6);
    setDie(d);
    const cur = pos[turn];
    let next = cur + d;
    if (next > 100) next = cur; // must land exactly on 100
    if (LADDERS[next]) next = LADDERS[next];
    else if (SNAKES[next]) next = SNAKES[next];
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

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="grid grid-cols-10 gap-px rounded-kaya overflow-hidden bg-games-ink/10 p-1 mx-auto" style={{ width: 'min(94vw, 330px)' }}>
        {Array.from({ length: 100 }, (_, i) => {
          const r = Math.floor(i / 10), c = i % 10;
          const n = cellNumber(r, c);
          const hasP1 = pos[0] === n;
          const hasP2 = pos[1] === n;
          const ladder = LADDERS[n] !== undefined;
          const snake = SNAKES[n] !== undefined;
          return (
            <div
              key={i}
              className="aspect-square flex items-center justify-center relative"
              style={{ background: n === 100 ? '#A7F3D0' : ladder ? '#DBEAFE' : snake ? '#FFE4E4' : '#FFFFFF', fontSize: 7 }}
            >
              <span className="absolute top-0 left-0.5 text-games-ink-soft font-bold" style={{ fontSize: 6 }}>{n}</span>
              {ladder && <span style={{ fontSize: 9 }}>🪜</span>}
              {snake && <span style={{ fontSize: 9 }}>🐍</span>}
              <span className="absolute bottom-0 right-0 flex" style={{ fontSize: 8 }}>
                {hasP1 && <span>🔴</span>}
                {hasP2 && <span>🟡</span>}
              </span>
            </div>
          );
        })}
      </div>

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
