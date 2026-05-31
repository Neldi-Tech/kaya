'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import MultiDeviceRoom from './MultiDeviceRoom';
import { shuffledDeck } from '@/lib/memoryMatch';

// Flip cards, find the 6 pairs. Three ways:
//   • 🙂 Just me — fewer moves = better (solo).
//   • 👫 Same device — pass-and-play: take turns; a match keeps your turn.
//   • 📲 Two phones — each player on their own device via a room code.
// Points follow the parent's per-game value + approval.

type Mode = 'solo' | 'duo' | 'multi';

export default function MemoryMatch({ onComplete }: GameProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const cards = useMemo(shuffledDeck, []);
  const [flipped, setFlipped] = useState<number[]>([]);
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  const [busy, setBusy] = useState(false);
  const [scores, setScores] = useState<[number, number]>([0, 0]); // duo pairs
  const [current, setCurrent] = useState<0 | 1>(0);               // duo turn
  const doneRef = useRef(false);

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
          if (mode === 'duo') setScores((sc) => (current === 0 ? [sc[0] + 1, sc[1]] : [sc[0], sc[1] + 1]));
          // match → same player goes again (turn unchanged)
        } else if (mode === 'duo') {
          setCurrent((c) => (c === 0 ? 1 : 0)); // miss → pass the turn
        }
        setFlipped([]);
        setBusy(false);
      }, isMatch ? 320 : 720);
    }
  };

  useEffect(() => {
    if (mode === 'multi' || mode === null) return;
    if (cards.length === 0 || matched.size !== cards.length || doneRef.current) return;
    doneRef.current = true;
    const [p1, p2] = scores;
    const message = mode === 'duo'
      ? (p1 > p2 ? `🟣 Player 1 wins! 🎉 (${p1}–${p2})`
        : p2 > p1 ? `🟠 Player 2 wins! 🎉 (${p2}–${p1})`
        : `It's a tie! 🤝 (${p1}–${p2})`)
      : 'All matched! 🎉';
    const score = mode === 'duo' ? Math.max(p1, p2) : moves;
    const t = window.setTimeout(() => onComplete({ success: true, score, message }), 500);
    return () => window.clearTimeout(t);
  }, [matched, cards.length, moves, mode, scores, onComplete]);

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
              <span className="block text-[11px] font-semibold text-games-ink-soft">Take turns · a match keeps your go · most pairs wins</span>
            </span>
          </button>
          <button type="button" onClick={() => setMode('multi')} className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left">
            <span className="text-3xl">📲</span>
            <span>
              <span className="block font-display font-extrabold text-games-ink">Two phones</span>
              <span className="block text-[11px] font-semibold text-games-ink-soft">Each player on their own device · room code</span>
            </span>
          </button>
          <button type="button" onClick={() => setMode('solo')} className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left">
            <span className="text-3xl">🙂</span>
            <span>
              <span className="block font-display font-extrabold text-games-ink">Just me</span>
              <span className="block text-[11px] font-semibold text-games-ink-soft">Find all 6 pairs in the fewest moves</span>
            </span>
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'multi') {
    const game = getGame('memory-match');
    return game ? <MultiDeviceRoom game={game} onComplete={onComplete} /> : null;
  }

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      {mode === 'duo' ? (
        <div className="flex items-center justify-center gap-3 mb-3 text-xs font-extrabold">
          <span className={`px-2.5 py-1 rounded-full ${current === 0 ? 'bg-games-violet text-white' : 'bg-games-bg text-games-ink-soft'}`}>🟣 P1 · {scores[0]}</span>
          <span className={`px-2.5 py-1 rounded-full ${current === 1 ? 'bg-games-coral text-white' : 'bg-games-bg text-games-ink-soft'}`}>🟠 P2 · {scores[1]}</span>
        </div>
      ) : (
        <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Moves: {moves}</p>
      )}
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
      {mode === 'duo' && (
        <p className="text-center text-[11px] font-semibold text-games-ink-soft mt-3">
          {current === 0 ? '🟣 Player 1' : '🟠 Player 2'}&rsquo;s turn · pass the device on a miss
        </p>
      )}
    </div>
  );
}
