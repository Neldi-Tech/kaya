'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameProps } from './types';

// Quick Tap (Kaya Lab beta) — wait for green, tap as fast as you can. Best of 3.

type Phase = 'idle' | 'waiting' | 'go' | 'early';
const ROUNDS = 3;

export default function ReactionTap({ onComplete }: GameProps) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [times, setTimes] = useState<number[]>([]);
  const [msg, setMsg] = useState('Tap to start');
  const goAt = useRef(0);
  const timer = useRef<number | null>(null);

  const arm = () => {
    setPhase('waiting');
    setMsg('Wait for green…');
    timer.current = window.setTimeout(() => {
      goAt.current = Date.now();
      setPhase('go');
      setMsg('TAP!');
    }, 1200 + Math.random() * 2600);
  };

  const onTap = () => {
    if (phase === 'idle' || phase === 'early') { arm(); return; }
    if (phase === 'waiting') {
      if (timer.current) window.clearTimeout(timer.current);
      setPhase('early');
      setMsg('Too soon! Tap to try again');
      return;
    }
    if (phase === 'go') {
      const ms = Date.now() - goAt.current;
      const nt = [...times, ms];
      setTimes(nt);
      if (nt.length >= ROUNDS) { setPhase('idle'); setMsg('Done!'); }
      else { setMsg(`${ms} ms! Round ${nt.length + 1}/${ROUNDS}`); arm(); }
    }
  };

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (times.length >= ROUNDS) {
      const best = Math.min(...times);
      const t = window.setTimeout(() => onComplete({ success: true, score: best, message: `Best ${best} ms ⚡` }), 350);
      return () => window.clearTimeout(t);
    }
  }, [times, onComplete]);

  const bg = phase === 'go' ? '#6BCB77' : phase === 'waiting' ? '#FF6B6B' : phase === 'early' ? '#FFC93C' : '#6B3FE0';

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Round {Math.min(times.length + 1, ROUNDS)} of {ROUNDS}</p>
      <button
        type="button"
        onClick={onTap}
        className="w-full rounded-kaya-lg flex items-center justify-center font-display font-black text-white text-2xl transition-colors active:brightness-95"
        style={{ height: 320, background: bg }}
      >
        {msg}
      </button>
      <div className="flex justify-center gap-2 mt-4">
        {times.map((t, i) => (
          <span key={i} className="text-xs font-bold text-games-ink-soft bg-games-bg px-2 py-1 rounded-full">{t} ms</span>
        ))}
      </div>
    </div>
  );
}
