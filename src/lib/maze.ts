// Kaya Games — Maze Quest engine. Framework-free on purpose: the solo
// component and the two-phone race import the SAME generator, so a shared
// seed builds the identical maze on both devices. Also holds the canvas
// painter (drawMaze) so solo + race render pixel-for-pixel the same.

export type Dir = 'N' | 'E' | 'S' | 'W';
export interface Pt { c: number; r: number }
export interface MazeCell { c: number; r: number; walls: Record<Dir, boolean> }
export interface Maze { cells: MazeCell[]; cols: number; rows: number }

export const DELTA: Record<Dir, [number, number]> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const OPP: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];

// mulberry32 — small deterministic RNG. Same seed ⇒ same maze on both phones.
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const idx = (cols: number, c: number, r: number) => r * cols + c;

// Recursive-backtracker (iterative) — a perfect maze: exactly one path between
// any two cells, so BFS below always reaches the exit.
export function generateMaze(cols: number, rows: number, rng: () => number): Maze {
  const cells: MazeCell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) cells.push({ c, r, walls: { N: true, E: true, S: true, W: true } });
  }
  const visited = new Uint8Array(cells.length);
  const stack: number[] = [];
  let cur = 0;
  visited[0] = 1;
  for (;;) {
    const cell = cells[cur];
    const opts: Array<[Dir, number]> = [];
    if (cell.r > 0 && !visited[idx(cols, cell.c, cell.r - 1)]) opts.push(['N', idx(cols, cell.c, cell.r - 1)]);
    if (cell.c < cols - 1 && !visited[idx(cols, cell.c + 1, cell.r)]) opts.push(['E', idx(cols, cell.c + 1, cell.r)]);
    if (cell.r < rows - 1 && !visited[idx(cols, cell.c, cell.r + 1)]) opts.push(['S', idx(cols, cell.c, cell.r + 1)]);
    if (cell.c > 0 && !visited[idx(cols, cell.c - 1, cell.r)]) opts.push(['W', idx(cols, cell.c - 1, cell.r)]);
    if (opts.length) {
      const [dir, ni] = opts[Math.floor(rng() * opts.length)];
      cell.walls[dir] = false;
      cells[ni].walls[OPP[dir]] = false;
      stack.push(cur);
      visited[ni] = 1;
      cur = ni;
    } else if (stack.length) {
      cur = stack.pop() as number;
    } else {
      break;
    }
  }
  return { cells, cols, rows };
}

export const cellOf = (maze: Maze, c: number, r: number): MazeCell => maze.cells[idx(maze.cols, c, r)];
export const canMove = (maze: Maze, from: Pt, dir: Dir): boolean => !cellOf(maze, from.c, from.r).walls[dir];

// One BFS step from `from` toward `to`. Returns the next cell to move into.
export function bfsNext(maze: Maze, from: Pt, to: Pt): Pt | null {
  if (from.c === to.c && from.r === to.r) return null;
  const n = maze.cells.length;
  const prev = new Int32Array(n).fill(-1);
  const seen = new Uint8Array(n);
  const start = idx(maze.cols, from.c, from.r);
  const goal = idx(maze.cols, to.c, to.r);
  const q: number[] = [start];
  seen[start] = 1;
  let head = 0;
  while (head < q.length) {
    const at = q[head++];
    if (at === goal) break;
    const cell = maze.cells[at];
    for (const d of DIRS) {
      if (cell.walls[d]) continue;
      const ni = idx(maze.cols, cell.c + DELTA[d][0], cell.r + DELTA[d][1]);
      if (!seen[ni]) { seen[ni] = 1; prev[ni] = at; q.push(ni); }
    }
  }
  if (!seen[goal]) return null;
  let node = goal;
  while (prev[node] !== start) node = prev[node];
  return { c: maze.cells[node].c, r: maze.cells[node].r };
}

// Full shortest path of cells from → to (used for hints + progress %). The
// default cap is the cell count — a shortest path can never exceed it, so this
// always reaches the exit; pass a small max (e.g. 6) when you only want a peek.
export function bfsPath(maze: Maze, from: Pt, to: Pt, max = maze.cols * maze.rows): Pt[] {
  const path: Pt[] = [];
  let step: Pt = from;
  for (let i = 0; i < max; i++) {
    const nx = bfsNext(maze, step, to);
    if (!nx) break;
    path.push(nx);
    step = nx;
    if (nx.c === to.c && nx.r === to.r) break;
  }
  return path;
}

// 2..100 — how close `at` is to the exit, by remaining path length.
export function progressPct(maze: Maze, at: Pt, exit: Pt): number {
  const remain = bfsPath(maze, at, exit).length;
  const full = (maze.cols - 1) + (maze.rows - 1);
  return Math.max(2, Math.min(100, Math.round((1 - remain / Math.max(1, full)) * 100)));
}

// ── Coins ──────────────────────────────────────────────────────────────────
export interface Coin { c: number; r: number; got: boolean }

export function placeCoins(maze: Maze, rng: () => number, exit: Pt, want: number): Coin[] {
  const coins: Coin[] = [];
  let guard = 0;
  while (coins.length < want && guard++ < 600) {
    const c = Math.floor(rng() * maze.cols);
    const r = Math.floor(rng() * maze.rows);
    if ((c === 0 && r === 0) || (c === exit.c && r === exit.r)) continue;
    if (coins.some((k) => k.c === c && k.r === r)) continue;
    coins.push({ c, r, got: false });
  }
  return coins;
}

export const coinTarget = (size: number): number => Math.min(8, Math.max(4, Math.round(size * 0.55)));

// ── Difficulty + worlds ──────────────────────────────────────────────────────
export type Difficulty = 'easy' | 'medium' | 'hard';
export interface DiffCfg { base: number; dianaMs: number; chaserMs: number; chaserDefault: boolean; label: string; emoji: string; blurb: string }

export const MAZE_DIFFS: Record<Difficulty, DiffCfg> = {
  easy: { base: 8, dianaMs: 300, chaserMs: 380, chaserDefault: false, label: 'Easy', emoji: '🟢', blurb: 'small · no chaser' },
  medium: { base: 11, dianaMs: 235, chaserMs: 300, chaserDefault: true, label: 'Medium', emoji: '🟡', blurb: 'bigger · slow chaser' },
  hard: { base: 14, dianaMs: 185, chaserMs: 235, chaserDefault: true, label: 'Hard', emoji: '🔴', blurb: 'huge · fast chaser' },
};

export interface MazeWorld { id: string; name: string; emoji: string; exit: string; bg: [string, string]; wall: string; stories: string[] }

// Note: world id `cosmos` carries the display name "Kaya Universe" — kept a
// distinct id so it never collides with the app-wide `universe` tour module.
export const MAZE_WORLDS: MazeWorld[] = [
  { id: 'cavern', name: 'Coin Cavern', emoji: '🪙', exit: '🚪', bg: ['#FFF6E0', '#F3E2BD'], wall: '#7a5a2e',
    stories: ['Deep in the Coin Cavern — grab the coins before the echo wakes.', 'The cavern re-carved itself overnight. Find the old mine door.', 'Lanterns are low — follow the coins to the way out.'] },
  { id: 'forest', name: 'Crystal Forest', emoji: '🌲', exit: '🌳', bg: ['#E9F7EF', '#CDEAD7'], wall: '#2f6b46',
    stories: ['The Crystal Forest shifts every run — reach the great oak.', 'Fireflies moved the paths again. Trust the glow.', 'Coins are dewdrops tonight — gather them to the old tree.'] },
  { id: 'starbridge', name: 'Star Bridge', emoji: '🌌', exit: '⭐', bg: ['#ECECFB', '#D6D6F4'], wall: '#3a3a78',
    stories: ['Cross the Star Bridge before the comet passes.', 'Stardust is scattered — link the stars to the gate.', 'The bridge rebuilt itself among the constellations.'] },
  { id: 'cosmos', name: 'Kaya Universe', emoji: '🪐', exit: '🪐', bg: ['#F0E9FB', '#DBC9F4'], wall: '#5b3a8c',
    stories: ['Welcome to the Kaya Universe — find the home planet.', 'New galaxy generated. Collect coins, orbit your way out.', 'The wormholes shuffled — find the planet gate.'] },
];

export const pickStory = (world: MazeWorld, rng: () => number): string =>
  world.stories[Math.floor(rng() * world.stories.length)];

// Solo climbs by 1 cell/level; a race stage grows by 2.
export const soloSize = (base: number, level: number): number => base + (level - 1);
export const stageSize = (base: number, stage: number): number => base + (stage - 1) * 2;

// ── Canvas painter (shared by solo + race) ───────────────────────────────────
export interface Entity { c: number; r: number; x: number; y: number }
export interface DrawState {
  maze: Maze; world: MazeWorld; cell: number; view: number;
  coins: Coin[]; exit: Pt;
  player: Entity; playerGlyph: string;
  // other racers (2-phone / family race) — each drawn as a ghost runner
  opponents?: Array<{ e: Entity; glyph: string; halo: string }>;
  chaser?: Entity | null;
  hintCells?: Pt[] | null; stunned?: boolean;
}

const emojiAt = (ctx: CanvasRenderingContext2D, glyph: string, x: number, y: number, size: number) => {
  ctx.font = `${size}px "Plus Jakarta Sans", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, x, y);
};

export function drawMaze(ctx: CanvasRenderingContext2D, s: DrawState): void {
  const { maze, world, cell, view } = s;
  // themed background
  const g = ctx.createLinearGradient(0, 0, view, view);
  g.addColorStop(0, world.bg[0]);
  g.addColorStop(1, world.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, view, view);
  // hint glow
  if (s.hintCells && s.hintCells.length) {
    ctx.fillStyle = 'rgba(107,63,224,0.18)';
    for (const c of s.hintCells) ctx.fillRect(c.c * cell, c.r * cell, cell, cell);
  }
  // walls
  ctx.strokeStyle = world.wall;
  ctx.lineWidth = Math.max(2, cell * 0.12);
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const cl of maze.cells) {
    const x = cl.c * cell;
    const y = cl.r * cell;
    if (cl.walls.N) { ctx.moveTo(x, y); ctx.lineTo(x + cell, y); }
    if (cl.walls.W) { ctx.moveTo(x, y); ctx.lineTo(x, y + cell); }
    if (cl.walls.E && cl.c === maze.cols - 1) { ctx.moveTo(x + cell, y); ctx.lineTo(x + cell, y + cell); }
    if (cl.walls.S && cl.r === maze.rows - 1) { ctx.moveTo(x, y + cell); ctx.lineTo(x + cell, y + cell); }
  }
  ctx.stroke();
  // coins
  for (const k of s.coins) {
    if (k.got) continue;
    emojiAt(ctx, '🪙', (k.c + 0.5) * cell, (k.r + 0.5) * cell, cell * 0.55);
  }
  // exit portal
  const ex = (s.exit.c + 0.5) * cell;
  const ey = (s.exit.r + 0.5) * cell;
  ctx.fillStyle = 'rgba(255,201,60,0.30)';
  ctx.beginPath();
  ctx.arc(ex, ey, cell * 0.5, 0, Math.PI * 2);
  ctx.fill();
  emojiAt(ctx, world.exit, ex, ey, cell * 0.62);
  // helpers
  const halo = (e: Entity, col: string) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(e.x, e.y, cell * 0.42, 0, Math.PI * 2); ctx.fill(); };
  // chaser
  if (s.chaser) { halo(s.chaser, 'rgba(107,63,224,0.28)'); emojiAt(ctx, '👻', s.chaser.x, s.chaser.y, cell * 0.6); }
  // opponents (other racers)
  if (s.opponents) for (const o of s.opponents) { halo(o.e, o.halo); emojiAt(ctx, o.glyph, o.e.x, o.e.y, cell * 0.6); }
  // player
  halo(s.player, s.stunned ? 'rgba(255,80,80,0.45)' : 'rgba(255,201,60,0.42)');
  emojiAt(ctx, s.playerGlyph, s.player.x, s.player.y, cell * 0.64);
}

export const fmtTime = (ms: number): string => {
  const sec = Math.floor(ms / 1000);
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${m < 10 ? '0' : ''}${m}:${r < 10 ? '0' : ''}${r}`;
};
