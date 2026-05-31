// Pure Tic-Tac-Toe logic, shared by the same-device component
// (components/games/TicTacToe) and the two-device room play
// (components/games/MultiDeviceRoom). Kept framework-free + in its own module
// so both can import it without a circular dependency.

export type Cell = 'X' | 'O' | null;

export const TTT_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

/** Winner symbol, 'draw', or null if the game is still open. */
export function decideTicTacToe(b: Cell[]): Cell | 'draw' | null {
  for (const [a, c, d] of TTT_LINES) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return b.every(Boolean) ? 'draw' : null;
}

/** A beatable-but-not-dumb move for O (the computer): win, else block, else
 *  centre, else a corner, else anything. */
export function aiMove(b: Cell[]): number {
  const empty = b.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const tryWin = (p: Cell): number => {
    for (const i of empty) {
      const t = [...b]; t[i] = p;
      if (decideTicTacToe(t) === p) return i;
    }
    return -1;
  };
  let m = tryWin('O'); if (m >= 0) return m;          // win if we can
  m = tryWin('X'); if (m >= 0) return m;              // else block the kid
  if (b[4] == null) return 4;                         // take centre
  const corners = [0, 2, 6, 8].filter((i) => b[i] == null);
  if (corners.length) return corners[0];              // then a corner
  return empty[0] ?? -1;                              // then anything
}

export const tttGlyph = (p: Cell): string => (p === 'X' ? '❌' : p === 'O' ? '⭕' : '');
