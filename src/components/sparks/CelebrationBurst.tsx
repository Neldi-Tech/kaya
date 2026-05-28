'use client';

// Kaya Sparks · celebration burst. Hand-rolled SVG confetti for the
// qualifying revision submit moment. No dependency — 80 LOC, fires for
// ~1.5s then unmounts itself. Respects prefers-reduced-motion.
//
// Mount it conditionally (e.g. `{celebrating && <CelebrationBurst …/>}`)
// — the component schedules its own teardown via onDone after the
// animation completes.

import { useEffect, useMemo, useRef } from 'react';

interface Props {
  /** Fired ~1.6s after mount, after the animation finishes. */
  onDone: () => void;
}

interface Particle {
  x: number;       // initial x in % of viewport width
  y: number;       // initial y in % of viewport height (always 50)
  dx: number;      // px horizontal drift
  dy: number;      // px vertical drop
  rot: number;     // final rotation deg
  size: number;    // px
  shape: 'rect' | 'circle' | 'star';
  color: string;
  delay: number;   // s
}

const PALETTE = ['#FF6B6B', '#FFD93D', '#6BCB77', '#A66CFF', '#4ECDC4', '#FF8E72', '#D4A847'];

function makeParticles(count: number): Particle[] {
  const out: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const dir = (Math.random() - 0.5) * 2; // -1 → 1
    out.push({
      x: 50 + dir * 8,
      y: 50,
      dx: dir * (120 + Math.random() * 280),
      dy: -200 + Math.random() * 600,
      rot: (Math.random() - 0.5) * 720,
      size: 6 + Math.random() * 8,
      shape: (['rect', 'circle', 'star'] as const)[Math.floor(Math.random() * 3)],
      color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      delay: Math.random() * 0.15,
    });
  }
  return out;
}

export default function CelebrationBurst({ onDone }: Props) {
  const fired = useRef(false);
  const particles = useMemo(() => makeParticles(60), []);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    const prefersReduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(onDone, prefersReduce ? 600 : 1700);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 pointer-events-none z-[70] overflow-hidden"
      aria-hidden="true"
    >
      {particles.map((p, idx) => (
        <span
          key={idx}
          className="absolute animate-confetti"
          style={{
            left: `${p.x}%`,
            top:  `${p.y}%`,
            width: p.size,
            height: p.size,
            background: p.shape === 'star' ? 'transparent' : p.color,
            borderRadius: p.shape === 'circle' ? '50%' : '2px',
            // CSS vars consumed by the @keyframes below.
            ['--dx' as string]: `${p.dx}px`,
            ['--dy' as string]: `${p.dy}px`,
            ['--rot' as string]: `${p.rot}deg`,
            animationDelay: `${p.delay}s`,
          } as React.CSSProperties}
        >
          {p.shape === 'star' && (
            <svg viewBox="0 0 10 10" width={p.size} height={p.size} aria-hidden>
              <path d="M5 0 L6.2 3.8 L10 5 L6.2 6.2 L5 10 L3.8 6.2 L0 5 L3.8 3.8 Z" fill={p.color} />
            </svg>
          )}
        </span>
      ))}
      <style jsx>{`
        @keyframes confettiFall {
          0%   { transform: translate(0, 0) rotate(0deg); opacity: 1; }
          15%  { opacity: 1; }
          100% { transform: translate(var(--dx), var(--dy)) rotate(var(--rot)); opacity: 0; }
        }
        .animate-confetti {
          animation: confettiFall 1.5s cubic-bezier(0.16, 0.84, 0.44, 1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-confetti { animation: none; opacity: 0; }
        }
      `}</style>
    </div>
  );
}
