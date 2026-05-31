'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { updateSession, updateSessionFields, type GameSession } from '@/lib/gameSessions';
import {
  type Difficulty, type MazeWorld, type Maze, type Pt, type Coin, type Entity, type Dir,
  MAZE_DIFFS, MAZE_WORLDS, DELTA, makeRng, generateMaze, canMove,
  placeCoins, coinTarget, stageSize, bfsPath, progressPct, drawMaze, fmtTime,
} from '@/lib/maze';

// Family Maze Race — lives inside MultiDeviceRoom's Play dispatch. EVERYONE in
// the room races the SAME maze (shared seed) on their own phone, best-of-3
// growing stages. Each device reports ONLY its own progress + finish; every
// device computes the stage winner identically from the finishes map (no
// arbiter races). The host writes the low-frequency stage transitions + 'done'.

type Mode = 'first' | 'time';
interface RaceFinish { ms: number; coins: number }
interface RaceResult { stage: number; winnerUid: string; times: Record<string, number> }
interface RaceState {
  seed?: number; mode?: Mode; diff?: Difficulty; worldId?: string;
  stage?: number; totalStages?: number; goAt?: number;
  finishes?: Record<string, RaceFinish>; progress?: Record<string, number>;
  results?: RaceResult[]; doneMessage?: string;
}

const TOTAL_STAGES = 3;
const DNF = 9_999_999;
// Distinct ghost runners + matching halo + progress-bar colour, by racer order.
const GLYPHS = ['🐢', '🐰', '🦉', '🐱', '🐼', '🐸', '🦝', '🐧'];
const HALOS = ['rgba(255,107,107,0.30)', 'rgba(45,212,191,0.32)', 'rgba(255,201,60,0.34)', 'rgba(255,143,177,0.30)', 'rgba(125,211,252,0.34)', 'rgba(167,243,208,0.42)', 'rgba(107,63,224,0.26)', 'rgba(90,79,122,0.30)'];
const BARS = ['bg-games-coral', 'bg-games-teal', 'bg-games-gold', 'bg-games-pink', 'bg-games-sky', 'bg-games-mint', 'bg-games-violet', 'bg-games-ink-soft'];

const center = (c: number, r: number, cell: number) => ({ x: (c + 0.5) * cell, y: (r + 0.5) * cell });
const worldOf = (id?: string): MazeWorld => MAZE_WORLDS.find((w) => w.id === id) || MAZE_WORLDS[0];

function decideStage(mode: Mode, finishes: Record<string, RaceFinish>, racers: string[]): { decided: boolean; winnerUid: string } {
  const done = racers.map((uid) => ({ uid, f: finishes[uid] })).filter((x) => x.f) as Array<{ uid: string; f: RaceFinish }>;
  if (mode === 'first') {
    if (!done.length) return { decided: false, winnerUid: '' };
  } else if (done.length < racers.length) {
    return { decided: false, winnerUid: '' };
  }
  done.sort((a, b) => a.f.ms - b.f.ms);
  return { decided: true, winnerUid: done[0].uid };
}

function matchWinner(results: RaceResult[], racers: string[]): string {
  const wins: Record<string, number> = {};
  const total: Record<string, number> = {};
  for (const uid of racers) { wins[uid] = 0; total[uid] = 0; }
  for (const r of results) {
    if (r.winnerUid) wins[r.winnerUid] = (wins[r.winnerUid] || 0) + 1;
    for (const uid of racers) total[uid] += Number(r.times?.[uid] || 0) || DNF;
  }
  const sorted = [...racers].sort((a, b) => (wins[b] - wins[a]) || (total[a] - total[b]));
  // ambiguous if the top two are level on both wins and total time
  if (sorted.length >= 2 && wins[sorted[0]] === wins[sorted[1]] && total[sorted[0]] === total[sorted[1]]) return '';
  return sorted[0];
}

export default function MazeRaceMultiPlay({ session, me, familyId }: { session: GameSession; me: string; familyId: string }) {
  const st = session.state as RaceState;
  const players = session.players;
  const racers = players.map((p) => p.uid); // everyone in the room races
  const isHost = session.hostUid === me;
  const stage = st.stage ?? 0;
  const mode: Mode = st.mode === 'time' ? 'time' : 'first';
  const finishes = st.finishes || {};
  const results = st.results || [];
  const advancedRef = useRef(-1);

  const { decided, winnerUid } = decideStage(mode, finishes, racers);

  // Host: once a stage is decided, pause for the tally then advance / finish.
  useEffect(() => {
    if (!isHost || stage < 1 || !decided || advancedRef.current === stage) return;
    advancedRef.current = stage;
    const times: Record<string, number> = {};
    for (const uid of racers) if (finishes[uid]) times[uid] = finishes[uid].ms;
    const newResults = [...results, { stage, winnerUid, times }];
    const t = window.setTimeout(() => {
      if (stage >= (st.totalStages ?? TOTAL_STAGES)) {
        const mw = matchWinner(newResults, racers);
        const wName = players.find((p) => p.uid === mw)?.name;
        const doneMessage = mw ? `${wName} wins the maze match! 🏆` : "It's a tie — great racing! 🤝";
        void updateSession(familyId, session.id, {
          state: { ...st, results: newResults, finishes: {}, progress: {}, doneMessage },
          status: 'done',
          ...(mw ? { winnerUid: mw } : {}),
        });
      } else {
        void updateSession(familyId, session.id, {
          state: { ...st, results: newResults, finishes: {}, progress: {}, stage: stage + 1, goAt: Date.now() + 3500 },
        });
      }
    }, 2600);
    return () => window.clearTimeout(t);
  }, [decided, isHost, stage, winnerUid]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Setup (host picks mode + difficulty + world; others wait) ──────────────
  if (stage === 0) {
    if (isHost) return <RaceSetup familyId={familyId} session={session} />;
    return <p className="text-center text-sm text-games-ink-soft py-16">The host is setting up the race… 🏁</p>;
  }

  if (decided) {
    return <StageTally session={session} me={me} mode={mode} stage={stage} winnerUid={winnerUid} finishes={finishes} results={results} racers={racers} />;
  }

  return <RaceBoard key={stage} session={session} me={me} familyId={familyId} racers={racers} isHost={isHost} />;
}

// ── Host race setup ──────────────────────────────────────────────────────────
function RaceSetup({ familyId, session }: { familyId: string; session: GameSession }) {
  const [mode, setMode] = useState<Mode>('first');
  const [diff, setDiff] = useState<Difficulty>('easy');
  const [worldIdx, setWorldIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    await updateSession(familyId, session.id, {
      state: {
        seed: Math.floor(Math.random() * 1_000_000_000),
        mode, diff, worldId: MAZE_WORLDS[worldIdx].id,
        stage: 1, totalStages: TOTAL_STAGES, goAt: Date.now() + 3500,
        finishes: {}, progress: {}, results: [],
      },
    });
  };

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <p className="text-center text-sm font-extrabold text-games-ink mb-1">Set up the race 🏁</p>
      <p className="text-center text-[11px] text-games-ink-soft mb-4">{session.players.length} players · same maze on every phone</p>

      <p className="text-[11px] font-extrabold uppercase tracking-wider text-games-ink-soft mb-2">How do you win?</p>
      <div className="flex bg-games-bg rounded-kaya p-1 gap-1">
        {([['first', '🏁 First to finish', 'First one out wins'], ['time', '⏱️ Time to finish', 'Lowest total time wins']] as const).map(([m, t, s]) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-kaya-sm py-2 text-center transition-colors ${mode === m ? 'bg-games-card shadow' : ''}`}
          >
            <div className={`text-[12px] font-extrabold ${mode === m ? 'text-games-ink' : 'text-games-ink-soft'}`}>{t}</div>
            <div className="text-[9px] text-games-ink-soft">{s}</div>
          </button>
        ))}
      </div>

      <p className="text-[11px] font-extrabold uppercase tracking-wider text-games-ink-soft mt-4 mb-2">Difficulty</p>
      <div className="flex gap-2">
        {(Object.keys(MAZE_DIFFS) as Difficulty[]).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDiff(d)}
            className={`flex-1 rounded-kaya-sm py-2.5 border-[1.5px] ${diff === d ? 'border-games-violet bg-games-bg' : 'border-transparent bg-games-card'} shadow-[0_4px_12px_rgba(26,18,64,0.06)]`}
          >
            <div className="text-base">{MAZE_DIFFS[d].emoji}</div>
            <div className="text-[12px] font-extrabold text-games-ink">{MAZE_DIFFS[d].label}</div>
          </button>
        ))}
      </div>

      <p className="text-[11px] font-extrabold uppercase tracking-wider text-games-ink-soft mt-4 mb-2">World <span className="text-games-violet normal-case font-bold">✨ AI</span></p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {MAZE_WORLDS.map((w, i) => (
          <button
            key={w.id}
            type="button"
            onClick={() => setWorldIdx(i)}
            className={`flex-none w-[80px] rounded-kaya py-2.5 text-center border-[1.5px] ${worldIdx === i ? 'border-games-gold bg-games-bg' : 'border-transparent bg-games-card'} shadow-[0_4px_12px_rgba(26,18,64,0.06)]`}
          >
            <div className="text-xl">{w.emoji}</div>
            <div className="text-[9px] font-extrabold text-games-ink mt-1 leading-tight">{w.name}</div>
          </button>
        ))}
      </div>

      <button type="button" disabled={busy} onClick={start} className="w-full bg-games-violet text-white font-display font-extrabold py-3.5 rounded-full mt-5 disabled:opacity-50">
        {busy ? 'Starting…' : 'Start race ▶ · best of 3'}
      </button>
    </div>
  );
}

// ── The live race board ──────────────────────────────────────────────────────
interface BoardState {
  maze: Maze; exit: Pt; coins: Coin[]; player: Entity; opps: Record<string, Entity>;
  solution: Pt[]; cell: number; view: number;
  running: boolean; finished: boolean; heldDir: Dir | null; lastStep: number;
  startMs: number; lastProgress: number; lastProgWrite: number;
}

function RaceBoard({ session, me, familyId, racers, isHost }: { session: GameSession; me: string; familyId: string; racers: string[]; isHost: boolean }) {
  const st = session.state as RaceState;
  const world = worldOf(st.worldId);
  const diff = (st.diff || 'easy') as Difficulty;
  const stage = st.stage ?? 1;
  const seed = st.seed ?? 1;
  const goAt = st.goAt ?? Date.now();
  const others = racers.filter((u) => u !== me);
  const progress = st.progress || {};
  const finishes = st.finishes || {};

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gRef = useRef<BoardState | null>(null);
  const rafRef = useRef<number>(0);
  const progRef = useRef<Record<string, number>>({});
  const othersRef = useRef<string[]>(others);
  const timeRef = useRef<HTMLSpanElement | null>(null);
  const coinRef = useRef<HTMLSpanElement | null>(null);
  const youBarRef = useRef<HTMLDivElement | null>(null);

  const [countdown, setCountdown] = useState<number | null>(3);
  const [finishedView, setFinishedView] = useState(false);

  progRef.current = progress;
  othersRef.current = others;

  const fitCanvas = useCallback(() => {
    const cv = canvasRef.current; const g = gRef.current;
    if (!cv || !g) return;
    const w = cv.clientWidth || 300;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(w * dpr);
    const ctx = cv.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.view = w; g.cell = w / g.maze.cols;
    const snap = (e: Entity) => { const p = center(e.c, e.r, g.cell); e.x = p.x; e.y = p.y; };
    snap(g.player);
    for (const uid of Object.keys(g.opps)) snap(g.opps[uid]);
  }, []);

  const finish = useCallback(() => {
    const g = gRef.current;
    if (!g || g.finished) return;
    g.finished = true; g.running = false;
    setFinishedView(true);
    const ms = Math.max(0, Date.now() - goAt);
    const coins = g.coins.filter((k) => k.got).length;
    void updateSessionFields(familyId, session.id, { [`state.finishes.${me}`]: { ms, coins } });
  }, [familyId, session.id, me, goAt]);

  const step = useCallback((dir: Dir) => {
    const g = gRef.current;
    if (!g || !g.running || g.finished) return;
    if (!canMove(g.maze, g.player, dir)) return;
    g.player.c += DELTA[dir][0]; g.player.r += DELTA[dir][1];
    g.lastStep = performance.now();
    for (const k of g.coins) if (!k.got && k.c === g.player.c && k.r === g.player.r) { k.got = true; if (coinRef.current) coinRef.current.textContent = String(g.coins.filter((z) => z.got).length); }
    if (g.player.c === g.exit.c && g.player.r === g.exit.r) finish();
  }, [finish]);

  const loop = useCallback((ts: number) => {
    const g = gRef.current;
    if (!g) return;
    const now = Date.now();
    if (!g.running && !g.finished && now >= goAt) { g.running = true; g.startMs = now; setCountdown(null); }
    if (!g.running && !g.finished) { const left = Math.ceil((goAt - now) / 1000); setCountdown(left > 0 ? left : null); }

    if (g.running) {
      if (timeRef.current) timeRef.current.textContent = fmtTime(now - goAt);
      if (g.heldDir && ts - g.lastStep > 95) {
        const p = center(g.player.c, g.player.r, g.cell);
        if (Math.hypot(g.player.x - p.x, g.player.y - p.y) < g.cell * 0.2) step(g.heldDir);
      }
      // progress report — coarse (every ~8% / 1.5s) so many racers don't hammer
      // the single session doc (Firestore ~1 write/sec/doc soft limit).
      const pct = progressPct(g.maze, g.player, g.exit);
      if (now - g.lastProgWrite > 1500 && pct - g.lastProgress >= 8) {
        g.lastProgress = pct; g.lastProgWrite = now;
        void updateSessionFields(familyId, session.id, { [`state.progress.${me}`]: pct });
      }
      if (youBarRef.current) youBarRef.current.style.width = `${pct}%`;
    }
    // other racers' ghosts, placed along the shared solution path by their pct
    for (const uid of othersRef.current) {
      const ent = g.opps[uid];
      if (!ent) continue;
      const op = Number(progRef.current[uid] || 0);
      const oi = Math.min(g.solution.length - 1, Math.max(0, Math.round((op / 100) * (g.solution.length - 1))));
      const oc = g.solution[oi] || g.solution[0];
      ent.c = oc.c; ent.r = oc.r;
    }
    const ease = (e: Entity) => { const p = center(e.c, e.r, g.cell); e.x += (p.x - e.x) * 0.38; e.y += (p.y - e.y) * 0.38; };
    ease(g.player);
    for (const uid of Object.keys(g.opps)) ease(g.opps[uid]);

    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) {
      drawMaze(ctx, {
        maze: g.maze, world, cell: g.cell, view: g.view, coins: g.coins, exit: g.exit,
        player: g.player, playerGlyph: '🦊',
        opponents: othersRef.current
          .map((uid, i) => { const e = g.opps[uid]; return e ? { e, glyph: GLYPHS[i % GLYPHS.length], halo: HALOS[i % HALOS.length] } : null; })
          .filter((o): o is { e: Entity; glyph: string; halo: string } => o !== null),
      });
    }
    rafRef.current = window.requestAnimationFrame(loop);
  }, [goAt, world, step, familyId, session.id, me]);

  useEffect(() => {
    const size = stageSize(MAZE_DIFFS[diff].base, stage);
    const rng = makeRng((seed >>> 0) ^ (stage * 2654435761));
    const maze = generateMaze(size, size, rng);
    const exit: Pt = { c: size - 1, r: size - 1 };
    const coins = placeCoins(maze, rng, exit, coinTarget(size));
    const start: Pt = { c: 0, r: 0 };
    const opps: Record<string, Entity> = {};
    for (const uid of othersRef.current) opps[uid] = { c: 0, r: 0, x: 0, y: 0 };
    gRef.current = {
      maze, exit, coins, player: { c: 0, r: 0, x: 0, y: 0 }, opps,
      solution: [start, ...bfsPath(maze, start, exit)],
      cell: 1, view: 300, running: false, finished: false, heldDir: null, lastStep: 0,
      startMs: 0, lastProgress: 0, lastProgWrite: 0,
    };
    fitCanvas();
    rafRef.current = window.requestAnimationFrame(loop);
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', s: 'S', a: 'W', d: 'E', W: 'N', S: 'S', A: 'W', D: 'E' };
      const dir = map[e.key]; if (!dir) return; e.preventDefault();
      const g = gRef.current; if (g && !e.repeat) { g.heldDir = dir; step(dir); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const map: Record<string, Dir> = { ArrowUp: 'N', ArrowDown: 'S', ArrowLeft: 'W', ArrowRight: 'E', w: 'N', s: 'S', a: 'W', d: 'E' };
      const dir = map[e.key]; const g = gRef.current; if (g && dir && g.heldDir === dir) g.heldDir = null;
    };
    const onResize = () => fitCanvas();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(rafRef.current);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      gRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Host escape: in a time race, don't let one straggler stall everyone — the
  // host can end the stage, scoring missing racers as DNF.
  const endStageNow = () => {
    const patch: Record<string, unknown> = {};
    for (const uid of racers) if (!finishes[uid]) patch[`state.finishes.${uid}`] = { ms: DNF, coins: 0 };
    if (Object.keys(patch).length) void updateSessionFields(familyId, session.id, patch);
  };

  const held = (dir: Dir, on: boolean) => { const g = gRef.current; if (!g) return; if (on) { g.heldDir = dir; step(dir); } else if (g.heldDir === dir) g.heldDir = null; };
  const swipeStart = useRef<{ x: number; y: number } | null>(null);

  const Pad = ({ d, label }: { d: Dir; label: string }) => (
    <button type="button" aria-label={label}
      onPointerDown={(e) => { e.preventDefault(); held(d, true); }}
      onPointerUp={() => held(d, false)} onPointerLeave={() => held(d, false)}
      className="bg-games-card rounded-kaya w-12 h-12 flex items-center justify-center text-xl font-black text-games-violet shadow-[0_4px_12px_rgba(26,18,64,0.06)] active:scale-90 transition-transform"
    >{label}</button>
  );

  const nameOf = (uid: string) => session.players.find((p) => p.uid === uid)?.name || '—';

  return (
    <div className="mx-auto" style={{ maxWidth: 340 }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="bg-games-violet text-white text-[10px] font-extrabold px-2 py-1 rounded-full">Stage {stage}/{st.totalStages ?? TOTAL_STAGES}</span>
        <span className={`text-[10px] font-extrabold px-2 py-1 rounded-full text-white ${st.mode === 'time' ? 'bg-games-teal' : 'bg-games-violet-deep'}`}>{st.mode === 'time' ? '⏱️ Best time' : '🏁 First out'}</span>
        <span className="font-display font-black text-games-ink ml-auto text-sm"><span ref={timeRef}>00:00</span></span>
        <span className="text-[11px] font-bold text-games-ink-soft">🪙 <span ref={coinRef}>0</span></span>
      </div>

      {/* live standings — you + every other racer */}
      <div className="space-y-1 mb-2">
        {[me, ...others].map((uid) => {
          const you = uid === me;
          const oi = others.indexOf(uid);
          const glyph = you ? '🦊' : GLYPHS[oi % GLYPHS.length];
          const bar = you ? 'bg-games-gold' : BARS[oi % BARS.length];
          const done = !!finishes[uid] && finishes[uid].ms < DNF;
          const w = you ? 4 : Math.max(4, Number(progress[uid] || 0));
          return (
            <div key={uid} className="flex items-center gap-2 text-[11px] font-bold">
              <span className="w-[70px] truncate text-games-ink">{glyph} {you ? 'You' : nameOf(uid)}</span>
              <div className="flex-1 h-2 bg-games-bg rounded-full overflow-hidden">
                <div ref={you ? youBarRef : undefined} className={`h-full ${bar} rounded-full transition-all`} style={{ width: `${done ? 100 : w}%` }} />
              </div>
              {done && <span className="text-games-teal">🏁</span>}
            </div>
          );
        })}
      </div>

      <div className="relative mx-auto rounded-kaya overflow-hidden border border-games-bg" style={{ width: '100%', maxWidth: 320, aspectRatio: '1 / 1' }}>
        <canvas
          ref={canvasRef}
          onPointerDown={(e) => { swipeStart.current = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={(e) => { const s = swipeStart.current; swipeStart.current = null; if (!s) return; const dx = e.clientX - s.x, dy = e.clientY - s.y; if (Math.abs(dx) < 18 && Math.abs(dy) < 18) return; if (Math.abs(dx) > Math.abs(dy)) step(dx > 0 ? 'E' : 'W'); else step(dy > 0 ? 'S' : 'N'); }}
          className="block w-full h-full" style={{ touchAction: 'none' }}
        />
        {countdown !== null && <div className="absolute inset-0 grid place-items-center bg-games-bg/85 font-display font-black text-6xl text-games-violet">{countdown}</div>}
        {finishedView && (
          <div className="absolute inset-0 grid place-items-center bg-games-ink/55 text-center p-4">
            <div className="bg-games-card rounded-kaya-lg p-5">
              <div className="text-4xl">🏁</div>
              <p className="font-display font-black text-games-ink mt-1">You finished!</p>
              <p className="text-[12px] text-games-ink-soft mt-1">{st.mode === 'time' ? 'Waiting for the others…' : 'Counting it up…'}</p>
              {st.mode === 'time' && isHost && (
                <button type="button" onClick={endStageNow} className="mt-3 bg-games-bg text-games-violet-deep font-extrabold text-[12px] px-3 py-2 rounded-full">⏭️ End stage for everyone</button>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-1.5 w-fit mx-auto mt-3">
        <span /><Pad d="N" label="▲" /><span />
        <Pad d="W" label="◀" /><span /><Pad d="E" label="▶" />
        <span /><Pad d="S" label="▼" /><span />
      </div>
    </div>
  );
}

// ── Stage tally (shown to everyone while a stage is decided) ─────────────────
function StageTally({ session, me, mode, stage, winnerUid, finishes, results, racers }: {
  session: GameSession; me: string; mode: Mode; stage: number; winnerUid: string;
  finishes: Record<string, RaceFinish>; results: RaceResult[]; racers: string[];
}) {
  const players = session.players;
  const wName = players.find((p) => p.uid === winnerUid)?.name || 'Nobody';
  const youWon = winnerUid === me;
  const wins: Record<string, number> = {};
  for (const uid of racers) wins[uid] = 0;
  for (const r of [...results, { stage, winnerUid, times: {} as Record<string, number> }]) if (r.winnerUid) wins[r.winnerUid] = (wins[r.winnerUid] || 0) + 1;
  const standings = [...players].sort((a, b) => (wins[b.uid] || 0) - (wins[a.uid] || 0));

  return (
    <div className="mx-auto text-center pt-6" style={{ maxWidth: 320 }}>
      <div className="text-5xl mb-1">{youWon ? '🏁' : '😅'}</div>
      <p className="font-display text-xl font-black text-games-ink">{wName} took stage {stage}!</p>
      {mode === 'time' && (
        <p className="text-[12px] text-games-ink-soft mt-1">
          {racers.map((uid) => `${players.find((p) => p.uid === uid)?.name || '—'} ${finishes[uid] && finishes[uid].ms < 9_999_999 ? fmtTime(finishes[uid].ms) : 'DNF'}`).join('  ·  ')}
        </p>
      )}
      <div className="bg-games-bg rounded-kaya px-4 py-2 mt-3 inline-block text-sm font-extrabold text-games-ink">
        🏆 {standings.map((p) => `${p.name} ${wins[p.uid] || 0}`).join(' · ')}
      </div>
      <p className="text-[12px] text-games-ink-soft mt-3">{stage >= 3 ? 'Final tally…' : 'Next maze is bigger — get ready! ⏳'}</p>
    </div>
  );
}
