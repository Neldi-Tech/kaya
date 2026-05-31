'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GameProps } from './types';
import { getGame } from '@/lib/gamesCatalog';
import MultiDeviceRoom from './MultiDeviceRoom';
import {
  type Difficulty, type MazeWorld, type Maze, type Pt, type Coin, type Entity, type Dir,
  MAZE_DIFFS, MAZE_WORLDS, DELTA, makeRng, generateMaze, canMove, bfsNext, bfsPath,
  placeCoins, coinTarget, soloSize, pickStory, drawMaze, fmtTime,
} from '@/lib/maze';

// Maze Quest — a solo level-climber + a two-phone race (the race lives in the
// shared MultiDeviceRoom, like Snakes & Ladders). This file owns the menu and
// the single-player game; MazeRace.tsx owns the two-phone play.

type Choice = 'solo' | 'multi' | null;

export default function MazeQuest({ onComplete }: GameProps) {
  const [choice, setChoice] = useState<Choice>(null);
  const [cfg, setCfg] = useState<{ diff: Difficulty; world: MazeWorld; chaser: boolean } | null>(null);

  if (choice === null) return <ModeSelect onPick={setChoice} />;

  if (choice === 'multi') {
    const game = getGame('maze-quest');
    if (!game) return null;
    return <MultiDeviceRoom game={game} onComplete={onComplete} />;
  }

  if (!cfg) return <SoloSetup onBack={() => setChoice(null)} onStart={setCfg} />;
  return <SoloMaze diff={cfg.diff} world={cfg.world} chaser={cfg.chaser} onComplete={onComplete} onQuit={() => setCfg(null)} />;
}

// ── Mode select ──────────────────────────────────────────────────────────────
function ModeSelect({ onPick }: { onPick: (c: Choice) => void }) {
  const Card = ({ ic, t, s, onClick }: { ic: string; t: string; s: string; onClick: () => void }) => (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-games-card rounded-kaya p-4 shadow-[0_4px_12px_rgba(26,18,64,0.08)] active:scale-95 transition-transform text-left"
    >
      <span className="text-3xl">{ic}</span>
      <span className="flex-1">
        <span className="block font-display font-extrabold text-games-ink">{t}</span>
        <span className="block text-[11px] font-semibold text-games-ink-soft leading-snug">{s}</span>
      </span>
      <span className="text-games-ink-soft text-lg">›</span>
    </button>
  );
  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <p className="text-center text-sm font-extrabold text-games-ink mb-4">How do you want to play?</p>
      <div className="space-y-2.5">
        <Card ic="🧗" t="Solo Adventure" s="Climb the levels — each maze bigger than the last. Your level is always on show." onClick={() => onPick('solo')} />
        <Card ic="📲" t="Family Race" s="Everyone on their own phone — same maze. First one out wins, or fastest time. Best of 3." onClick={() => onPick('multi')} />
      </div>
      <div className="grid grid-cols-4 gap-2 mt-4">
        {[['🤖', 'AI worlds'], ['🪙', 'Coins'], ['👻', 'Chaser'], ['💡', 'Hints']].map(([e, l]) => (
          <div key={l} className="bg-games-bg rounded-kaya-sm py-2.5 text-center">
            <div className="text-lg">{e}</div>
            <div className="text-[10px] font-bold text-games-ink-soft mt-0.5">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Solo setup ───────────────────────────────────────────────────────────────
function SoloSetup({ onBack, onStart }: { onBack: () => void; onStart: (c: { diff: Difficulty; world: MazeWorld; chaser: boolean }) => void }) {
  const [diff, setDiff] = useState<Difficulty>('easy');
  const [worldIdx, setWorldIdx] = useState(0);
  const [chaser, setChaser] = useState(MAZE_DIFFS.easy.chaserDefault);

  const pickDiff = (d: Difficulty) => { setDiff(d); setChaser(MAZE_DIFFS[d].chaserDefault); };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <button type="button" onClick={onBack} className="text-xs font-bold text-games-ink-soft mb-3">‹ Back</button>

      <p className="text-[11px] font-extrabold uppercase tracking-wider text-games-ink-soft mb-2">Difficulty</p>
      <div className="flex gap-2">
        {(Object.keys(MAZE_DIFFS) as Difficulty[]).map((d) => {
          const c = MAZE_DIFFS[d];
          const on = diff === d;
          return (
            <button
              key={d}
              type="button"
              onClick={() => pickDiff(d)}
              className={`flex-1 rounded-kaya-sm py-2.5 text-center border-[1.5px] transition-colors ${on ? 'border-games-violet bg-games-bg' : 'border-transparent bg-games-card'} shadow-[0_4px_12px_rgba(26,18,64,0.06)]`}
            >
              <div className="text-base">{c.emoji}</div>
              <div className="text-[12px] font-extrabold text-games-ink">{c.label}</div>
              <div className="text-[9px] text-games-ink-soft">{c.blurb}</div>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] font-extrabold uppercase tracking-wider text-games-ink-soft mt-4 mb-2">
        World <span className="text-games-violet normal-case font-bold">✨ AI builds a fresh maze + story</span>
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MAZE_WORLDS.map((w, i) => {
          const on = worldIdx === i;
          return (
            <button
              key={w.id}
              type="button"
              onClick={() => setWorldIdx(i)}
              className={`flex-none w-[88px] rounded-kaya py-3 text-center border-[1.5px] relative transition-colors ${on ? 'border-games-gold bg-games-bg' : 'border-transparent bg-games-card'} shadow-[0_4px_12px_rgba(26,18,64,0.06)]`}
            >
              <span className="absolute top-1.5 right-1.5 text-[7px] font-black tracking-wide bg-games-violet text-white px-1.5 py-0.5 rounded-full">AI</span>
              <div className="text-2xl">{w.emoji}</div>
              <div className="text-[10px] font-extrabold text-games-ink mt-1 leading-tight">{w.name}</div>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-3 bg-games-card rounded-kaya p-3 mt-4 shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
        <span className="text-xl">👻</span>
        <div className="flex-1">
          <div className="text-[13px] font-extrabold text-games-ink">AI chaser</div>
          <div className="text-[11px] text-games-ink-soft leading-snug">Hunts you. Catches cost a coin — never game-over.</div>
        </div>
        <button
          type="button"
          aria-pressed={chaser}
          onClick={() => setChaser((v) => !v)}
          className={`w-12 h-7 rounded-full relative transition-colors flex-none ${chaser ? 'bg-games-violet' : 'bg-games-bg'}`}
        >
          <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${chaser ? 'left-6' : 'left-1'}`} />
        </button>
      </div>

      <button
        type="button"
        onClick={() => onStart({ diff, world: MAZE_WORLDS[worldIdx], chaser })}
        className="w-full bg-games-violet text-white font-display font-extrabold py-3.5 rounded-full mt-5 active:scale-95 transition-transform"
      >
        Start Maze ▶
      </button>
    </div>
  );
}

// ── Solo game ────────────────────────────────────────────────────────────────
interface SoloState {
  maze: Maze; exit: Pt; coins: Coin[];
  player: Entity; chaser: Entity | null;
  cell: number; view: number;
  running: boolean; stunned: boolean; cleared: boolean;
  startTs: number; elapsedMs: number; lastTs: number;
  heldDir: Dir | null; lastStep: number; chaserAcc: number;
  hintCells: Pt[] | null; hintUntil: number;
  level: number; bankCoins: number;
}

const center = (c: number, r: number, cell: number) => ({ x: (c + 0.5) * cell, y: (r + 0.5) * cell });

function SoloMaze({
  diff, world, chaser: chaserOn, onComplete, onQuit,
}: {
  diff: Difficulty; world: MazeWorld; chaser: boolean;
  onComplete: GameProps['onComplete']; onQuit: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gRef = useRef<SoloState | null>(null);
  const rafRef = useRef<number>(0);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const coinRef = useRef<HTMLSpanElement | null>(null);

  const [level, setLevel] = useState(1);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [cleared, setCleared] = useState<{ coins: number } | null>(null);
  const toastTimer = useRef<number>(0);

  const showToast = useCallback((t: string) => {
    setToast(t);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  const fitCanvas = useCallback(() => {
    const cv = canvasRef.current;
    const g = gRef.current;
    if (!cv || !g) return;
    const w = cv.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(w * dpr);
    const ctx = cv.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.view = w;
    g.cell = w / g.maze.cols;
    for (const e of [g.player, g.chaser]) {
      if (!e) continue;
      const p = center(e.c, e.r, g.cell);
      e.x = p.x; e.y = p.y;
    }
  }, []);

  const draw = useCallback(() => {
    const cv = canvasRef.current;
    const g = gRef.current;
    if (!cv || !g) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    drawMaze(ctx, {
      maze: g.maze, world, cell: g.cell, view: g.view, coins: g.coins, exit: g.exit,
      player: g.player, playerGlyph: '🦊', chaser: g.chaser, hintCells: g.hintCells, stunned: g.stunned,
    });
  }, [world]);

  const clearLevel = useCallback(() => {
    const g = gRef.current;
    if (!g || g.cleared) return;
    g.cleared = true;
    g.running = false;
    const got = g.coins.filter((k) => k.got).length;
    g.bankCoins += got;
    setCleared({ coins: got });
  }, []);

  const caught = useCallback(() => {
    const g = gRef.current;
    if (!g || g.stunned || g.cleared) return;
    g.stunned = true;
    const got = g.coins.filter((k) => k.got);
    if (got.length) { got[got.length - 1].got = false; if (coinRef.current) coinRef.current.textContent = String(g.coins.filter((k) => k.got).length); }
    showToast('Caught! 👻 −1 coin. Keep moving!');
    window.setTimeout(() => {
      const gg = gRef.current;
      if (!gg || !gg.chaser) return;
      gg.stunned = false;
      gg.chaser.c = gg.maze.cols - 1; gg.chaser.r = 0;
      const p = center(gg.chaser.c, gg.chaser.r, gg.cell);
      gg.chaser.x = p.x; gg.chaser.y = p.y;
    }, 750);
  }, [showToast]);

  const step = useCallback((dir: Dir) => {
    const g = gRef.current;
    if (!g || !g.running || g.stunned || g.cleared) return;
    if (!canMove(g.maze, g.player, dir)) return;
    g.player.c += DELTA[dir][0];
    g.player.r += DELTA[dir][1];
    g.lastStep = performance.now();
    for (const k of g.coins) {
      if (!k.got && k.c === g.player.c && k.r === g.player.r) {
        k.got = true;
        if (coinRef.current) coinRef.current.textContent = String(g.coins.filter((z) => z.got).length);
      }
    }
    if (g.player.c === g.exit.c && g.player.r === g.exit.r) clearLevel();
  }, [clearLevel]);

  const loop = useCallback((ts: number) => {
    const g = gRef.current;
    if (!g) return;
    if (g.running) {
      g.elapsedMs = ts - g.startTs;
      if (timeRef.current) timeRef.current.textContent = fmtTime(g.elapsedMs);
      if (g.heldDir && ts - g.lastStep > 70) {
        const p = center(g.player.c, g.player.r, g.cell);
        if (Math.hypot(g.player.x - p.x, g.player.y - p.y) < g.cell * 0.46) step(g.heldDir);
      }
      if (g.chaser) {
        g.chaserAcc += ts - g.lastTs;
        if (g.chaserAcc > MAZE_DIFFS[diff].chaserMs) {
          g.chaserAcc = 0;
          const nx = bfsNext(g.maze, g.chaser, g.player);
          if (nx) { g.chaser.c = nx.c; g.chaser.r = nx.r; }
          if (g.chaser.c === g.player.c && g.chaser.r === g.player.r) caught();
        }
      }
    }
    g.lastTs = ts;
    // ease pixels toward cell centres
    for (const e of [g.player, g.chaser]) {
      if (!e) continue;
      const p = center(e.c, e.r, g.cell);
      e.x += (p.x - e.x) * 0.5;
      e.y += (p.y - e.y) * 0.5;
    }
    if (g.hintCells && ts > g.hintUntil) g.hintCells = null;
    draw();
    rafRef.current = window.requestAnimationFrame(loop);
  }, [diff, step, caught, draw]);

  const initLevel = useCallback((n: number) => {
    const size = soloSize(MAZE_DIFFS[diff].base, n);
    const rng = makeRng((Date.now() >>> 0) ^ (n * 2654435761));
    const maze = generateMaze(size, size, rng);
    const exit: Pt = { c: size - 1, r: size - 1 };
    const coins = placeCoins(maze, rng, exit, coinTarget(size));
    const player: Entity = { c: 0, r: 0, x: 0, y: 0 };
    const chaser: Entity | null = chaserOn ? { c: size - 1, r: 0, x: 0, y: 0 } : null;
    const prevBank = gRef.current?.bankCoins ?? 0;
    gRef.current = {
      maze, exit, coins, player, chaser, cell: 1, view: 300,
      running: false, stunned: false, cleared: false,
      startTs: 0, elapsedMs: 0, lastTs: performance.now(),
      heldDir: null, lastStep: 0, chaserAcc: 0, hintCells: null, hintUntil: 0,
      level: n, bankCoins: prevBank,
    };
    setLevel(n);
    setCleared(null);
    if (coinRef.current) coinRef.current.textContent = '0';
    if (timeRef.current) timeRef.current.textContent = '00:00';
    fitCanvas();
    showToast(`Kaya built “${world.name}” — ${pickStory(world, rng)}`);
    // 3-2-1 countdown, then run
    let n3 = 3;
    setCountdown(n3);
    const ci = window.setInterval(() => {
      n3 -= 1;
      if (n3 <= 0) {
        window.clearInterval(ci);
        setCountdown(null);
        const g = gRef.current;
        if (g) { g.running = true; g.startTs = performance.now(); g.lastTs = g.startTs; }
      } else {
        setCountdown(n3);
      }
    }, 650);
  }, [diff, chaserOn, world, fitCanvas, showToast]);

  // Mount: start level 1, wire keys, run the loop. Unmount: tear down.
  useEffect(() => {
    initLevel(1);
    rafRef.current = window.requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = {
        ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E',
        w: 'N', s: 'S', a: 'W', d: 'E', W: 'N', S: 'S', A: 'W', D: 'E',
      };
      const dir = map[e.key];
      if (!dir) return;
      e.preventDefault();
      const g = gRef.current;
      if (g && !e.repeat) { g.heldDir = dir; step(dir); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', s: 'S', a: 'W', d: 'E' };
      const dir = map[e.key];
      const g = gRef.current;
      if (g && dir && g.heldDir === dir) g.heldDir = null;
    };
    const onResize = () => fitCanvas();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.clearTimeout(toastTimer.current);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      gRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const held = (dir: Dir, on: boolean) => { const g = gRef.current; if (!g) return; if (on) { g.heldDir = dir; step(dir); } else if (g.heldDir === dir) g.heldDir = null; };

  const swipeStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => { swipeStart.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = swipeStart.current; swipeStart.current = null;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (Math.abs(dx) < 13 && Math.abs(dy) < 13) return;
    if (Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? 'E' : 'W'); else step(dy > 0 ? 'S' : 'N');
  };

  const useHint = () => {
    const g = gRef.current;
    if (!g || !g.running) return;
    g.hintCells = bfsPath(g.maze, g.player, g.exit, 6);
    g.hintUntil = performance.now() + 1600;
    showToast('Kaya: follow the glowing path! 💡');
  };

  const Pad = ({ d, label, cls }: { d: Dir; label: string; cls: string }) => (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); held(d, true); }}
      onPointerUp={() => held(d, false)}
      onPointerLeave={() => held(d, false)}
      className={`bg-games-card rounded-kaya w-12 h-12 flex items-center justify-center text-xl font-black text-games-violet shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-90 transition-transform ${cls}`}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex items-center gap-2 mb-3">
        <div className="bg-games-card rounded-kaya-sm px-2.5 py-1.5 text-center shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
          <div className="text-[8px] font-extrabold uppercase tracking-wide text-games-ink-soft">Level</div>
          <div className="font-display font-black text-games-ink leading-none mt-0.5">{level}</div>
        </div>
        <div className="bg-games-card rounded-kaya-sm px-2.5 py-1.5 text-center shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
          <div className="text-[8px] font-extrabold uppercase tracking-wide text-games-ink-soft">Time</div>
          <div className="font-display font-black text-games-ink leading-none mt-0.5"><span ref={timeRef}>00:00</span></div>
        </div>
        <div className="bg-games-card rounded-kaya-sm px-2.5 py-1.5 text-center shadow-[0_4px_12px_rgba(26,18,64,0.06)]">
          <div className="text-[8px] font-extrabold uppercase tracking-wide text-games-ink-soft">Coins</div>
          <div className="font-display font-black text-games-ink leading-none mt-0.5">🪙 <span ref={coinRef}>0</span></div>
        </div>
        <div className="flex-1" />
        <span className="text-[11px] font-bold text-games-ink-soft">{world.emoji} {world.name}</span>
      </div>

      <div className="relative mx-auto rounded-kaya overflow-hidden border border-games-bg" style={{ width: '100%', maxWidth: 320, aspectRatio: '1 / 1' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          className="block w-full h-full"
          style={{ touchAction: 'none' }}
        />
        {countdown !== null && (
          <div className="absolute inset-0 grid place-items-center bg-games-bg/85 font-display font-black text-6xl text-games-violet">{countdown}</div>
        )}
        {toast && (
          <div className="absolute left-2 right-2 top-2 bg-games-ink text-white rounded-kaya px-3 py-2 text-[11px] leading-snug flex gap-2 items-start shadow-lg">
            <span className="text-[8px] font-black bg-games-violet px-1.5 py-0.5 rounded-full flex-none mt-0.5">AI</span>
            <span>{toast}</span>
          </div>
        )}
        {cleared && (
          <div className="absolute inset-0 grid place-items-center bg-games-ink/55 p-4">
            <div className="bg-games-card rounded-kaya-lg p-5 w-full max-w-[260px] text-center animate-slide-up">
              <div className="text-4xl">🎉</div>
              <p className="font-display text-xl font-black text-games-ink mt-1">Level {level} cleared!</p>
              <p className="text-[12px] text-games-ink-soft mt-1">🪙 {cleared.coins} coins · the next maze is bigger.</p>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => initLevel(level + 1)} className="flex-1 bg-games-violet text-white font-extrabold text-sm py-2.5 rounded-full">Next level ▶</button>
                <button
                  type="button"
                  onClick={() => onComplete({ success: true, score: gRef.current?.bankCoins ?? cleared.coins, message: `Level ${level} cleared! 🪙 ${gRef.current?.bankCoins ?? cleared.coins} coins banked` })}
                  className="flex-1 bg-games-bg text-games-violet-deep font-extrabold text-sm py-2.5 rounded-full"
                >
                  Finish 🏁
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mt-3">
        <div className="grid grid-cols-3 gap-1.5 w-fit">
          <span /><Pad d="N" label="▲" cls="" /><span />
          <Pad d="W" label="◀" cls="" /><span /><Pad d="E" label="▶" cls="" />
          <span /><Pad d="S" label="▼" cls="" /><span />
        </div>
        <div className="flex flex-col gap-2 items-end">
          <button type="button" onClick={useHint} className="bg-games-bg text-games-violet font-extrabold text-[12px] px-3 py-2 rounded-kaya">💡 Kaya hint</button>
          <button type="button" onClick={() => initLevel(level)} className="bg-games-card text-games-ink-soft font-extrabold text-[12px] px-3 py-2 rounded-kaya border border-games-bg">🔀 New maze</button>
          <button type="button" onClick={onQuit} className="text-games-ink-soft font-bold text-[11px] px-1">‹ Menu</button>
        </div>
      </div>
      <p className="text-center text-[11px] text-games-ink-soft mt-3 leading-snug">Arrow keys / swipe / D-pad. Reach the {world.exit} to clear the level.</p>
    </div>
  );
}
