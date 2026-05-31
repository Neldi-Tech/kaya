'use client';

import { useState } from 'react';
import type { GameProps } from './types';

// A one-tap mood check-in. The chosen mood is recorded as the score so a
// family mood-trend view can read it later.

const MOODS = [
  { emoji: '😢', label: 'Rough', value: 1 },
  { emoji: '😟', label: 'Meh', value: 2 },
  { emoji: '😐', label: 'Okay', value: 3 },
  { emoji: '🙂', label: 'Good', value: 4 },
  { emoji: '😄', label: 'Great', value: 5 },
];

export default function MoodCheckin({ onComplete }: GameProps) {
  const [picked, setPicked] = useState<number | null>(null);

  return (
    <div className="mx-auto text-center pt-6" style={{ maxWidth: 320 }}>
      <p className="font-display text-2xl font-black text-games-ink mb-1">How are you feeling?</p>
      <p className="text-sm font-semibold text-games-ink-soft mb-8">Tap the face that fits right now.</p>
      <div className="flex justify-between mb-10">
        {MOODS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setPicked(m.value)}
            aria-label={m.label}
            className={`flex flex-col items-center gap-1 transition-transform ${picked === m.value ? 'scale-125' : 'opacity-60'}`}
          >
            <span className="text-4xl">{m.emoji}</span>
            <span className="text-[10px] font-bold text-games-ink-soft">{m.label}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={picked === null}
        onClick={() => onComplete({ success: true, score: picked ?? 3, message: 'Thanks for checking in 😊' })}
        className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full disabled:opacity-50"
      >
        That&rsquo;s me
      </button>
    </div>
  );
}
