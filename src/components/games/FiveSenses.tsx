'use client';

import { useState } from 'react';
import type { GameProps } from './types';

// 5-4-3-2-1 grounding — a guided walk through the senses.

const STEPS = [
  { n: 5, sense: 'see', icon: '👀', verb: 'can see' },
  { n: 4, sense: 'hear', icon: '👂', verb: 'can hear' },
  { n: 3, sense: 'feel', icon: '✋', verb: 'can feel' },
  { n: 2, sense: 'smell', icon: '👃', verb: 'can smell' },
  { n: 1, sense: 'taste', icon: '👅', verb: 'can taste' },
];

export default function FiveSenses({ onComplete }: GameProps) {
  const [step, setStep] = useState(0);
  const s = STEPS[step];

  const next = () => {
    if (step >= STEPS.length - 1) {
      onComplete({ success: true, score: STEPS.length, message: 'Grounded & present 🌿' });
    } else {
      setStep((n) => n + 1);
    }
  };

  return (
    <div className="mx-auto text-center pt-4" style={{ maxWidth: 320 }}>
      <div className="flex justify-center gap-1.5 mb-8">
        {STEPS.map((_, i) => (
          <span key={i} className={`h-1.5 rounded-full transition-all ${i <= step ? 'bg-games-teal w-6' : 'bg-games-ink/15 w-3'}`} />
        ))}
      </div>
      <div className="text-6xl mb-4">{s.icon}</div>
      <p className="font-display text-2xl font-black text-games-ink mb-1">
        Find <span className="text-games-teal">{s.n}</span> thing{s.n > 1 ? 's' : ''}
      </p>
      <p className="text-sm font-semibold text-games-ink-soft mb-8">you {s.verb} right now</p>
      <button
        type="button"
        onClick={next}
        className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full"
      >
        {step >= STEPS.length - 1 ? 'Finish' : 'Got them — next'}
      </button>
    </div>
  );
}
