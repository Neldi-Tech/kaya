'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameProps } from './types';

// 2048 — combine tiles to reach big numbers. Arrow keys or the D-pad.

const SIZE = 4;
type Board = number[];
type Dir = 'L' | 'R' | 'U' | 'D';

function spawn(b: Board): Board {
  const empty = b.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  if (!empty.length) return b;
  const idx = empty[Math.floor(Math.random() * empty.length)];
  const nb = [...b];
  nb[idx] = Math.random() < 0.9 ? 2 : 4;
  return nb;
}
function newBoard(): Board { return spawn(spawn(Array(SIZE * SIZE).fill(0))); }

function slide(row: number[]): [number[], number] {
  const nums = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      out.push(nums[i] * 2); gained += nums[i] * 2; i++;
    } else out.push(nums[i]);
  }
  while (out.length < SIZE) out.push(0);
  return [out, gained];
}

function move(b: Board, dir: Dir): [Board, number, boolean] {
  const nb = [...b];
  let gained = 0; let moved = false;
  for (let i = 0; i < SIZE; i++) {
    let line = dir === 'L' || dir === 'R'
      ? [b[i * 4], b[i * 4 + 1], b[i * 4 + 2], b[i * 4 + 3]]
      : [b[i], b[i + 4], b[i + 8], b[i + 12]];
    if (dir === 'R' || dir === 'D') line = line.reverse();
    const [slid, g] = slide(line);
    gained += g;
    if (dir === 'R' || dir === 'D') slid.reverse();
    for (let j = 0; j < SIZE; j++) {
      const idx = dir === 'L' || dir === 'R' ? i * 4 + j : j * 4 + i;
      if (nb[idx] !== slid[j]) moved = true;
      nb[idx] = slid[j];
    }
  }
  return [nb, gained, moved];
}
function canMove(b: Board): boolean {
  return (['L', 'R', 'U', 'D'] as Dir[]).some((d) => move(b, d)[2]);
}

const TILE: Record<number, string> = {
  0: '#EDE9FE', 2: '#DDD6FE', 4: '#C4B5FD', 8: '#A78BFA', 16: '#8B5CF6',
  32: '#7C3AED', 64: '#6D28D9', 128: '#FBBF24', 256: '#F59E0B',
  512: '#FF8FB1', 1024: '#FF6B6B', 2048: '#2DD4BF',
};

export default function Game2048({ onComplete }: GameProps) {
  const [board, setBoard] = useState<Board>(newBoard);
  const [score, setScore] = useState(0);
  const [over, setOver] = useState(false);
  const boardRef = useRef(board); boardRef.current = board;
  const overRef = useRef(false);

  const doMove = useCallback((dir: Dir) => {
    if (overRef.current) return;
    const [nb, g, moved] = move(boardRef.current, dir);
    if (!moved) return;
    const withSpawn = spawn(nb);
    setBoard(withSpawn);
    setScore((s) => s + g);
    if (!canMove(withSpawn)) { overRef.current = true; setOver(true); }
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m: Record<string, Dir> = { ArrowLeft: 'L', ArrowRight: 'R', ArrowUp: 'U', ArrowDown: 'D' };
      const d = m[e.key];
      if (d) { e.preventDefault(); doMove(d); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doMove]);

  useEffect(() => {
    if (over) {
      const best = Math.max(...board);
      const won = best >= 64;
      const t = window.setTimeout(
        () => onComplete({ success: won, score: best, message: won ? `Reached ${best}! 🎉` : 'Game over — try again' }),
        350,
      );
      return () => window.clearTimeout(t);
    }
  }, [over, board, onComplete]);

  const finish = () => {
    if (overRef.current) return;
    overRef.current = true;
    setOver(true);
  };

  const Pad = ({ d, label }: { d: Dir; label: string }) => (
    <button type="button" onClick={() => doMove(d)} aria-label={label}
      className="bg-games-card rounded-kaya w-12 h-12 flex items-center justify-center text-xl font-black text-games-violet shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-90 transition-transform">
      {label}
    </button>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 320 }}>
      <p className="text-center text-xs font-bold text-games-ink-soft mb-3">Score: {score} · reach 64+ to win</p>
      <div className="grid grid-cols-4 gap-2 p-2 rounded-kaya bg-games-bg" style={{ width: 'min(100%, 300px)', margin: '0 auto' }}>
        {board.map((v, i) => (
          <div key={i} className="aspect-square rounded-kaya-sm flex items-center justify-center font-display font-black"
            style={{ background: TILE[v] || '#1A1240', color: v >= 8 ? '#fff' : '#4A1FB8', fontSize: v >= 1000 ? 16 : 20 }}>
            {v || ''}
          </div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 w-fit mx-auto">
        <span /><Pad d="U" label="▲" /><span />
        <Pad d="L" label="◀" /><span /><Pad d="R" label="▶" />
        <span /><Pad d="D" label="▼" /><span />
      </div>
      <div className="text-center mt-4">
        <button type="button" onClick={finish} className="text-xs font-bold text-games-ink-soft underline">Finish &amp; claim</button>
      </div>
    </div>
  );
}
