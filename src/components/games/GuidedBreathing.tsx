'use client';

import { useEffect, useState } from 'react';
import type { GameProps } from './types';

// Guided 4-7-8 breathing. An expanding circle paces the breath for 3 cycles.

const PATTERN = [
  { label: 'Breathe in', secs: 4, big: true },
  { label: 'Hold', secs: 7, big: true },
  { label: 'Breathe out', secs: 8, big: false },
];
const CYCLES = 3;

export default function GuidedBreathing({ onComplete }: GameProps) {
  const [phase, setPhase] = useState(0);
  const [cycle, setCycle] = useState(0);
  const [left, setLeft] = useState(PATTERN[0].secs);
  const [scale, setScale] = useState(0.5);
  const [done, setDone] = useState(false);

  useEffect(() => {
    setScale(PATTERN[phase].big ? 1 : 0.5);
  }, [phase]);

  useEffect(() => {
    if (done) return;
    if (left <= 0) {
      const nextPhase = (phase + 1) % PATTERN.length;
      const nextCycle = nextPhase === 0 ? cycle + 1 : cycle;
      if (nextCycle >= CYCLES) { setDone(true); return; }
      setPhase(nextPhase);
      setCycle(nextCycle);
      setLeft(PATTERN[nextPhase].secs);
      return;
    }
    const t = window.setTimeout(() => setLeft((l) => l - 1), 1000);
    return () => window.clearTimeout(t);
  }, [left, phase, cycle, done]);

  useEffect(() => {
    if (done) {
      const t = window.setTimeout(
        () => onComplete({ success: true, score: CYCLES, message: 'Calm & centred 🌿' }),
        500,
      );
      return () => window.clearTimeout(t);
    }
  }, [done, onComplete]);

  return (
    <div className="flex flex-col items-center pt-6" style={{ maxWidth: 320, margin: '0 auto' }}>
      <div className="relative flex items-center justify-center" style={{ width: 240, height: 240 }}>
        <div
          className="rounded-full bg-gradient-to-br from-games-teal to-games-sky"
          style={{
            width: 200,
            height: 200,
            transform: `scale(${scale})`,
            transitionProperty: 'transform',
            transitionDuration: `${PATTERN[phase].secs}s`,
            transitionTimingFunction: 'ease-in-out',
          }}
        />
        <div className="absolute text-center">
          <p className="font-display text-xl font-black text-games-ink">{PATTERN[phase].label}</p>
          <p className="text-3xl font-display font-black text-games-violet">{left}</p>
        </div>
      </div>
      <p className="text-xs font-semibold text-games-ink-soft mt-6">Round {Math.min(cycle + 1, CYCLES)} of {CYCLES}</p>
      <button
        type="button"
        onClick={() => setDone(true)}
        className="mt-4 text-xs font-bold text-games-ink-soft underline"
      >
        I&rsquo;m done
      </button>
    </div>
  );
}
