'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameProps } from './types';

// Classic Snake on a 13×13 grid. Arrow keys or the on-screen D-pad. Eat the
// fruit to grow + score; hit a wall or yourself and it's over. Offline.

const N = 13;
const TICK = 200;

type P = { x: number; y: number };
type Dir = 'U' | 'D' | 'L' | 'R';

const DELTA: Record<Dir, P> = { U: { x: 0, y: -1 }, D: { x: 0, y: 1 }, L: { x: -1, y: 0 }, R: { x: 1, y: 0 } };
const OPP: Record<Dir, Dir> = { U: 'D', D: 'U', L: 'R', R: 'L' };

function spawnFood(snake: P[]): P {
  // Bounded grid; loop is safe until the board is nearly full.
  for (let guard = 0; guard < 500; guard++) {
    const f = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
    if (!snake.some((s) => s.x === f.x && s.y === f.y)) return f;
  }
  return { x: 0, y: 0 };
}

export default function Snake({ onComplete }: GameProps) {
  const [snake, setSnake] = useState<P[]>([{ x: 6, y: 6 }, { x: 5, y: 6 }, { x: 4, y: 6 }]);
  const foodRef = useRef<P>({ x: 9, y: 6 });
  const [food, setFoodState] = useState<P>(foodRef.current);
  const setFood = (p: P) => { foodRef.current = p; setFoodState(p); };
  const dirRef = useRef<Dir>('R');
  const pendingRef = useRef<Dir>('R');
  const scoreRef = useRef(0);
  const [score, setScore] = useState(0);
  const [dead, setDead] = useState(false);

  const turn = useCallback((d: Dir) => {
    if (d !== OPP[dirRef.current]) pendingRef.current = d;
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: 'U', ArrowDown: 'D', ArrowLeft: 'L', ArrowRight: 'R' };
      const d = map[e.key];
      if (d) { e.preventDefault(); turn(d); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn]);

  useEffect(() => {
    if (dead) return;
    const iv = window.setInterval(() => {
      setSnake((prev) => {
        const nd = pendingRef.current;
        dirRef.current = nd;
        const head = prev[0];
        const nh = { x: head.x + DELTA[nd].x, y: head.y + DELTA[nd].y };
        const hitWall = nh.x < 0 || nh.x >= N || nh.y < 0 || nh.y >= N;
        const hitSelf = prev.some((s) => s.x === nh.x && s.y === nh.y);
        if (hitWall || hitSelf) { setDead(true); return prev; }
        const ate = nh.x === foodRef.current.x && nh.y === foodRef.current.y;
        const body = ate ? prev : prev.slice(0, -1);
        const ns = [nh, ...body];
        if (ate) {
          scoreRef.current += 1;
          setScore(scoreRef.current);
          setFood(spawnFood(ns));
        }
        return ns;
      });
    }, TICK);
    return () => window.clearInterval(iv);
  }, [dead]);

  useEffect(() => {
    if (dead) {
      const t = window.setTimeout(
        () => onComplete({
          success: scoreRef.current > 0,
          score: scoreRef.current,
          message: scoreRef.current > 0 ? `${scoreRef.current} fruit eaten! 🎉` : 'Crashed! Try again',
        }),
        350,
      );
      return () => window.clearTimeout(t);
    }
  }, [dead, onComplete]);

  const cellKind = (x: number, y: number): 'head' | 'body' | 'food' | null => {
    if (food.x === x && food.y === y) return 'food';
    const idx = snake.findIndex((s) => s.x === x && s.y === y);
    if (idx === 0) return 'head';
    if (idx > 0) return 'body';
    return null;
  };

  const Pad = ({ d, label, cls }: { d: Dir; label: string; cls: string }) => (
    <button
      type="button"
      onClick={() => turn(d)}
      aria-label={label}
      className={`bg-games-card rounded-kaya w-12 h-12 flex items-center justify-center text-xl font-black text-games-violet shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-90 transition-transform ${cls}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Score: {score}</p>
      <div
        className="mx-auto rounded-kaya overflow-hidden bg-games-bg p-1"
        style={{ width: 'min(86vw, 300px)' }}
      >
        <div className="grid" style={{ gridTemplateColumns: `repeat(${N}, 1fr)`, gap: 1 }}>
          {Array.from({ length: N * N }, (_, i) => {
            const x = i % N;
            const y = Math.floor(i / N);
            const kind = cellKind(x, y);
            const bg =
              kind === 'head' ? 'bg-games-violet-deep'
                : kind === 'body' ? 'bg-games-violet'
                  : kind === 'food' ? 'bg-games-coral'
                    : 'bg-games-card';
            return <div key={i} className={`aspect-square rounded-[3px] ${bg}`} />;
          })}
        </div>
      </div>

      {/* D-pad for touch devices */}
      <div className="mt-5 grid grid-cols-3 gap-2 w-fit mx-auto">
        <span /><Pad d="U" label="▲" cls="" /><span />
        <Pad d="L" label="◀" cls="" /><span /><Pad d="R" label="▶" cls="" />
        <span /><Pad d="D" label="▼" cls="" /><span />
      </div>
    </div>
  );
}
