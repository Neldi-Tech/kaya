'use client';

import { useEffect, useState } from 'react';
import type { GameProps } from './types';

// 3×3 sliding puzzle. Tap a tile next to the gap to slide it. Order 1–8 wins.

const N = 3;

function isSolved(a: number[]): boolean {
  for (let i = 0; i < a.length - 1; i++) if (a[i] !== i + 1) return false;
  return a[a.length - 1] === 0;
}
function solvable(a: number[]): boolean {
  const t = a.filter((v) => v !== 0);
  let inv = 0;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i] > t[j]) inv++;
  return inv % 2 === 0; // odd-width board → solvable iff inversions even
}
function shuffled(): number[] {
  let a: number[];
  do {
    a = [...Array(N * N).keys()];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  } while (!solvable(a) || isSolved(a));
  return a;
}

export default function SlidingPuzzle({ onComplete }: GameProps) {
  const [tiles, setTiles] = useState<number[]>(shuffled);
  const [moves, setMoves] = useState(0);
  const blank = tiles.indexOf(0);

  const adjacent = (i: number): boolean => {
    const r = Math.floor(i / N), c = i % N;
    const br = Math.floor(blank / N), bc = blank % N;
    return Math.abs(r - br) + Math.abs(c - bc) === 1;
  };

  const tap = (i: number) => {
    if (!adjacent(i)) return;
    const nt = [...tiles];
    [nt[i], nt[blank]] = [nt[blank], nt[i]];
    setTiles(nt);
    setMoves((m) => m + 1);
  };

  useEffect(() => {
    if (isSolved(tiles)) {
      const t = window.setTimeout(() => onComplete({ success: true, score: moves, message: 'Solved! 🎉' }), 320);
      return () => window.clearTimeout(t);
    }
  }, [tiles, moves, onComplete]);

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Moves: {moves}</p>
      <div className="grid grid-cols-3 gap-2 mx-auto" style={{ width: 'min(80vw, 280px)' }}>
        {tiles.map((v, i) => (
          v === 0 ? (
            <div key={i} className="aspect-square rounded-kaya bg-games-bg" />
          ) : (
            <button
              key={i}
              type="button"
              onClick={() => tap(i)}
              className="aspect-square rounded-kaya bg-gradient-to-br from-games-violet to-games-violet-deep text-white font-display font-black text-2xl shadow-[0_4px_12px_rgba(26,18,64,0.12)] active:scale-95 transition-transform"
            >
              {v}
            </button>
          )
        ))}
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-4">Slide tiles into order: 1–8 with the gap last.</p>
    </div>
  );
}
