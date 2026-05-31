'use client';

import { useEffect, useState } from 'react';
import type { GameProps } from './types';

// Charades — pass-and-play. One person acts the prompt, the others guess.
// Tap "Got it" when someone guesses, "Skip" to pass. 60 seconds.

const DECK = [
  'Elephant', 'Brushing teeth', 'Superhero', 'Riding a bike', 'Penguin', 'Cooking',
  'Robot', 'Swimming', 'Lion', 'Playing guitar', 'Sleeping', 'Monkey', 'Driving a car',
  'Dancing', 'Dinosaur', 'Eating ice cream', 'Airplane', 'Playing football', 'Cat',
  'Brushing hair', 'Frog', 'Reading a book', 'Snake', 'Climbing a tree', 'Butterfly',
  'Singing', 'Kangaroo', 'Fishing', 'Tiger', 'Painting',
];
const DURATION = 60;

function shuffle<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

export default function Charades({ onComplete }: GameProps) {
  const [deck] = useState(() => shuffle(DECK));
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(DURATION);
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready');

  useEffect(() => {
    if (phase !== 'play') return;
    if (left <= 0) { setPhase('done'); return; }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [phase, left]);

  useEffect(() => {
    if (phase === 'done') {
      const t = window.setTimeout(
        () => onComplete({ success: score > 0, score, message: score > 0 ? `${score} guessed! 🎉` : "Time's up! Try again" }),
        300,
      );
      return () => window.clearTimeout(t);
    }
  }, [phase, score, onComplete]);

  const advance = (got: boolean) => {
    if (got) setScore((s) => s + 1);
    setIdx((i) => (i + 1) % deck.length);
  };

  if (phase === 'ready') {
    return (
      <div className="text-center pt-10 mx-auto" style={{ maxWidth: 320 }}>
        <div className="text-5xl mb-3">🎭</div>
        <p className="font-display text-xl font-extrabold text-games-ink mb-2">Pass to the actor</p>
        <p className="text-sm text-games-ink-soft mb-8">They act it out, everyone else guesses. 60 seconds!</p>
        <button type="button" onClick={() => setPhase('play')} className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full">
          Start acting
        </button>
      </div>
    );
  }
  if (phase === 'done') {
    return <p className="text-center text-games-ink-soft pt-16">Time&rsquo;s up!</p>;
  }
  return (
    <div className="mx-auto text-center" style={{ maxWidth: 320 }}>
      <div className="flex items-center justify-between mb-6">
        <span className="text-xs font-bold text-games-ink-soft">Guessed: {score}</span>
        <span className="text-xs font-bold text-games-ink-soft">⏱ {left}s</span>
      </div>
      <div className="rounded-kaya-lg bg-games-card py-12 px-4 mb-6 shadow-[0_8px_24px_rgba(26,18,64,0.08)]">
        <p className="font-display text-3xl font-black text-games-violet">{deck[idx]}</p>
      </div>
      <div className="flex gap-2.5">
        <button type="button" onClick={() => advance(false)} className="flex-1 bg-games-bg text-games-ink-soft font-extrabold py-3.5 rounded-full">Skip</button>
        <button type="button" onClick={() => advance(true)} className="flex-1 bg-games-teal text-games-ink font-extrabold py-3.5 rounded-full">Got it ✓</button>
      </div>
    </div>
  );
}
