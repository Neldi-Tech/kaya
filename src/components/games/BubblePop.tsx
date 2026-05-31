'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameProps } from './types';

// Bubble Pop (Kaya Lab beta) — bubbles drift up, tap to pop, 30 seconds.

interface Bubble { id: number; x: number; size: number }
const DURATION = 30;

export default function BubblePop({ onComplete }: GameProps) {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(DURATION);
  const [done, setDone] = useState(false);
  const nextId = useRef(0);

  useEffect(() => {
    if (done) return;
    if (left <= 0) { setDone(true); return; }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, done]);

  useEffect(() => {
    if (done) return;
    const iv = window.setInterval(() => {
      setBubbles((prev) => [
        ...prev,
        { id: nextId.current++, x: 6 + Math.random() * 78, size: 34 + Math.random() * 30 },
      ].slice(-16));
    }, 620);
    return () => window.clearInterval(iv);
  }, [done]);

  useEffect(() => {
    if (done) {
      const t = window.setTimeout(
        () => onComplete({ success: score > 0, score, message: score > 0 ? `${score} popped! 🫧` : 'Time! Try again' }),
        300,
      );
      return () => window.clearTimeout(t);
    }
  }, [done, score, onComplete]);

  const pop = (id: number) => { setBubbles((prev) => prev.filter((b) => b.id !== id)); setScore((s) => s + 1); };
  const expire = (id: number) => setBubbles((prev) => prev.filter((b) => b.id !== id));

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex justify-between mb-2">
        <span className="text-xs font-bold text-games-ink-soft">Popped: {score}</span>
        <span className="text-xs font-bold text-games-ink-soft">⏱ {left}s</span>
      </div>
      <div className="relative overflow-hidden rounded-kaya bg-gradient-to-b from-games-bg to-white" style={{ height: 360 }}>
        <style>{'@keyframes kaya-bubble-rise { from { transform: translateY(0); } to { transform: translateY(-400px); } }'}</style>
        {bubbles.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => pop(b.id)}
            onAnimationEnd={() => expire(b.id)}
            aria-label="Pop bubble"
            className="absolute rounded-full bg-gradient-to-br from-games-sky to-games-teal active:scale-90"
            style={{ left: `${b.x}%`, bottom: -10, width: b.size, height: b.size, opacity: 0.85, animation: 'kaya-bubble-rise 3.2s linear forwards' }}
          />
        ))}
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-3">Tap the bubbles before they float away!</p>
    </div>
  );
}
