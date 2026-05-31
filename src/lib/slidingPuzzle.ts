// Kaya Games — Sliding Puzzle logic (pure; shared by the solo game AND the
// multi-device race, so every phone in a race starts from the SAME scramble).

export const SP_N = 3; // 3×3 board, tiles 1–8 + a gap (0)

export function spIsSolved(a: number[]): boolean {
  for (let i = 0; i < a.length - 1; i++) if (a[i] !== i + 1) return false;
  return a[a.length - 1] === 0;
}

export function spSolvable(a: number[]): boolean {
  const t = a.filter((v) => v !== 0);
  let inv = 0;
  for (let i = 0; i < t.length; i++) for (let j = i + 1; j < t.length; j++) if (t[i] > t[j]) inv++;
  return inv % 2 === 0; // odd-width board → solvable iff inversions even
}

export function spShuffled(): number[] {
  let a: number[];
  do {
    a = [...Array(SP_N * SP_N).keys()];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
  } while (!spSolvable(a) || spIsSolved(a));
  return a;
}

/** Is tile index i orthogonally adjacent to the gap at `blank`? */
export function spAdjacent(i: number, blank: number): boolean {
  const r = Math.floor(i / SP_N), c = i % SP_N;
  const br = Math.floor(blank / SP_N), bc = blank % SP_N;
  return Math.abs(r - br) + Math.abs(c - bc) === 1;
}
