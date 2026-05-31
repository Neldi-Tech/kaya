'use client';

import { useEffect, useRef, useState } from 'react';
import type { GameProps } from './types';

// Pictionary — pass-and-play. One person draws the word on the canvas, the
// others guess. Finger or mouse. 60 seconds.

const WORDS = [
  'House', 'Sun', 'Cat', 'Tree', 'Car', 'Star', 'Fish', 'Boat', 'Flower', 'Apple',
  'Dog', 'Ball', 'Heart', 'Cake', 'Rainbow', 'Cloud', 'Moon', 'Banana', 'Snake', 'Hat',
  'Bird', 'Key', 'Cup', 'Kite', 'Smiley face',
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

export default function Pictionary({ onComplete }: GameProps) {
  const [deck] = useState(() => shuffle(WORDS));
  const [idx, setIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(DURATION);
  const [phase, setPhase] = useState<'ready' | 'play' | 'done'>('ready');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

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

  useEffect(() => {
    if (phase !== 'play') return;
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = cv.getBoundingClientRect();
    cv.width = rect.width * dpr;
    cv.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#4A1FB8';
    let drawing = false;
    let lastX = 0, lastY = 0;
    const at = (e: PointerEvent): [number, number] => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    };
    const down = (e: PointerEvent) => { drawing = true; [lastX, lastY] = at(e); try { cv.setPointerCapture(e.pointerId); } catch { /* noop */ } };
    const move = (e: PointerEvent) => {
      if (!drawing) return;
      const [x, y] = at(e);
      ctx.beginPath(); ctx.moveTo(lastX, lastY); ctx.lineTo(x, y); ctx.stroke();
      [lastX, lastY] = [x, y];
      e.preventDefault();
    };
    const up = () => { drawing = false; };
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      cv.removeEventListener('pointerdown', down);
      cv.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [phase]);

  const clearCanvas = () => {
    const cv = canvasRef.current;
    const ctx = cv?.getContext('2d');
    if (cv && ctx) ctx.clearRect(0, 0, cv.width, cv.height);
  };

  const advance = (got: boolean) => {
    if (got) setScore((s) => s + 1);
    clearCanvas();
    setIdx((i) => (i + 1) % deck.length);
  };

  if (phase === 'ready') {
    return (
      <div className="text-center pt-10 mx-auto" style={{ maxWidth: 320 }}>
        <div className="text-5xl mb-3">✏️</div>
        <p className="font-display text-xl font-extrabold text-games-ink mb-2">Pass to the artist</p>
        <p className="text-sm text-games-ink-soft mb-8">Draw the word, everyone else guesses. 60 seconds!</p>
        <button type="button" onClick={() => setPhase('play')} className="w-full bg-games-violet text-white font-extrabold py-3.5 rounded-full">
          Start drawing
        </button>
      </div>
    );
  }
  if (phase === 'done') {
    return <p className="text-center text-games-ink-soft pt-16">Time&rsquo;s up!</p>;
  }
  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-games-ink-soft">Guessed: {score}</span>
        <span className="font-display font-black text-games-violet text-lg">{deck[idx]}</span>
        <span className="text-xs font-bold text-games-ink-soft">⏱ {left}s</span>
      </div>
      <canvas
        ref={canvasRef}
        className="w-full rounded-kaya bg-games-card shadow-[0_4px_12px_rgba(26,18,64,0.06)]"
        style={{ height: 260, touchAction: 'none' }}
      />
      <div className="flex gap-2.5 mt-3">
        <button type="button" onClick={clearCanvas} className="bg-games-bg text-games-ink-soft font-extrabold px-4 py-3 rounded-full">Clear</button>
        <button type="button" onClick={() => advance(false)} className="flex-1 bg-games-bg text-games-ink-soft font-extrabold py-3 rounded-full">Skip</button>
        <button type="button" onClick={() => advance(true)} className="flex-1 bg-games-teal text-games-ink font-extrabold py-3 rounded-full">Got it ✓</button>
      </div>
    </div>
  );
}
