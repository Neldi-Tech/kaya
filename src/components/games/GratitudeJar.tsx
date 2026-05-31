'use client';

import { useState } from 'react';
import type { GameProps } from './types';

// Type three things you're grateful for, then seal the jar.

export default function GratitudeJar({ onComplete }: GameProps) {
  const [items, setItems] = useState(['', '', '']);
  const filled = items.filter((s) => s.trim()).length;

  const set = (i: number, v: string) => {
    setItems((prev) => prev.map((s, idx) => (idx === i ? v : s)));
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <div className="text-center mb-5">
        <div className="text-5xl mb-2">🫙</div>
        <p className="text-sm font-semibold text-games-ink-soft">Three good things from today…</p>
      </div>
      <div className="flex flex-col gap-3 mb-5">
        {items.map((v, i) => (
          <div key={i} className="bg-games-card rounded-kaya px-3 py-2.5 shadow-[0_4px_12px_rgba(26,18,64,0.06)] flex items-center gap-2">
            <span className="text-lg">🙏</span>
            <input
              value={v}
              onChange={(e) => set(i, e.target.value)}
              placeholder={`I'm grateful for…`}
              maxLength={80}
              className="flex-1 bg-transparent text-sm font-semibold text-games-ink outline-none placeholder:text-games-ink-soft/60"
            />
          </div>
        ))}
      </div>
      <button
        type="button"
        disabled={filled < 3}
        onClick={() => onComplete({ success: true, score: filled, message: 'Jar sealed 🙏' })}
        className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full disabled:opacity-50"
      >
        {filled < 3 ? `Add ${3 - filled} more` : 'Seal the jar'}
      </button>
    </div>
  );
}
