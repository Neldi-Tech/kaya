'use client';

import { useEffect, useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import MultiDeviceRoom from './MultiDeviceRoom';
import { spIsSolved, spShuffled, spAdjacent } from '@/lib/slidingPuzzle';

// 3×3 sliding puzzle. Tap a tile next to the gap to slide it. Order 1–8 wins.
// Solo by default, with a one-tap "race on 2 phones" mode — same scramble,
// first to solve wins.

export default function SlidingPuzzle({ onComplete }: GameProps) {
  const [mode, setMode] = useState<'solo' | 'multi'>('solo');
  if (mode === 'multi') {
    const game = getGame('sliding-puzzle');
    return game ? <MultiDeviceRoom game={game} onComplete={onComplete} /> : null;
  }
  return <SlidingPuzzleSolo onComplete={onComplete} onRace={() => setMode('multi')} />;
}

function SlidingPuzzleSolo({ onComplete, onRace }: GameProps & { onRace: () => void }) {
  const [tiles, setTiles] = useState<number[]>(spShuffled);
  const [moves, setMoves] = useState(0);
  const blank = tiles.indexOf(0);
  const solved = spIsSolved(tiles);

  const tap = (i: number) => {
    if (!spAdjacent(i, blank)) return;
    const nt = [...tiles];
    [nt[i], nt[blank]] = [nt[blank], nt[i]];
    setTiles(nt);
    setMoves((m) => m + 1);
  };

  useEffect(() => {
    if (spIsSolved(tiles)) {
      const t = window.setTimeout(() => onComplete({ success: true, score: moves, message: 'Solved! 🎉' }), 320);
      return () => window.clearTimeout(t);
    }
  }, [tiles, moves, onComplete]);

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Moves: {moves}</p>
      <div className="grid grid-cols-3 gap-2 mx-auto" style={{ width: 'min(100%, 280px)' }}>
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
      {!solved && (
        <div className="text-center mt-3">
          <button type="button" onClick={onRace} className="text-xs font-bold text-games-ink-soft underline">
            📲 Race a friend on 2 phones
          </button>
        </div>
      )}
    </div>
  );
}
