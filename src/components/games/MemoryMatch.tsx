'use client';

import { useEffect, useMemo, useState } from 'react';
import type { GameProps } from './types';

// Flip cards, find the 6 pairs. Fewer moves = better. Fully offline.

const DECK = ['🦁', '🐼', '🦊', '🐸', '🐙', '🦄'];

function shuffledDeck(): { key: number; emoji: string }[] {
  const cards = DECK.flatMap((e, i) => [
    { key: i * 2, emoji: e },
    { key: i * 2 + 1, emoji: e },
  ]);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export default function MemoryMatch({ onComplete }: GameProps) {
  const cards = useMemo(shuffledDeck, []);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  const [busy, setBusy] = useState(false);

  const flip = (idx: number) => {
    if (busy || flipped.includes(idx) || matched.has(idx)) return;
    const next = [...flipped, idx];
    setFlipped(next);
    if (next.length === 2) {
      setMoves((m) => m + 1);
      setBusy(true);
      const [a, b] = next;
      const isMatch = cards[a].emoji === cards[b].emoji;
      window.setTimeout(() => {
        if (isMatch) {
          setMatched((prev) => {
            const s = new Set(prev);
            s.add(a); s.add(b);
            return s;
          });
        }
        setFlipped([]);
        setBusy(false);
      }, isMatch ? 320 : 720);
    }
  };

  useEffect(() => {
    if (cards.length > 0 && matched.size === cards.length) {
      const t = window.setTimeout(
        () => onComplete({ success: true, score: moves, message: 'All matched! 🎉' }),
        400,
      );
      return () => window.clearTimeout(t);
    }
  }, [matched, cards.length, moves, onComplete]);

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Moves: {moves}</p>
      <div className="grid grid-cols-4 gap-2.5">
        {cards.map((c, i) => {
          const show = flipped.includes(i) || matched.has(i);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => flip(i)}
              disabled={show || busy}
              aria-label={show ? c.emoji : 'Hidden card'}
              className={`aspect-square rounded-kaya flex items-center justify-center text-2xl select-none transition-all ${
                show
                  ? 'bg-games-card shadow-[0_4px_12px_rgba(26,18,64,0.08)]'
                  : 'bg-gradient-to-br from-games-violet to-games-violet-deep text-white/90'
              } ${matched.has(i) ? 'opacity-60' : ''}`}
            >
              {show ? c.emoji : '?'}
            </button>
          );
        })}
      </div>
    </div>
  );
}
