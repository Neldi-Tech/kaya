// Pure Connect 4 logic, shared by the same-device component
// (components/games/Connect4) and the two-device room play
// (components/games/MultiDeviceRoom). Framework-free + standalone so both can
// import it without a circular dependency.

export const C4_COLS = 7;
export const C4_ROWS = 6;
export type Disc = 0 | 1 | 2; // 0 empty · 1 red · 2 yellow

/** Index where a disc dropped into `col` lands, or -1 if the column is full. */
export function c4DropRow(board: Disc[], col: number): number {
  for (let r = C4_ROWS - 1; r >= 0; r--) {
    if (board[r * C4_COLS + col] === 0) return r * C4_COLS + col;
  }
  return -1;
}

/** The disc that just won (1 or 2) by playing at `last`, else 0. */
export function c4CheckWin(b: Disc[], last: number): Disc {
  const player = b[last];
  if (!player) return 0;
  const r = Math.floor(last / C4_COLS), c = last % C4_COLS;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let count = 1;
    for (const sign of [1, -1]) {
      let rr = r + dr * sign, cc = c + dc * sign;
      while (rr >= 0 && rr < C4_ROWS && cc >= 0 && cc < C4_COLS && b[rr * C4_COLS + cc] === player) {
        count++; rr += dr * sign; cc += dc * sign;
      }
    }
    if (count >= 4) return player;
  }
  return 0;
}

export const c4IsFull = (b: Disc[]): boolean => b.every((v) => v !== 0);

export const c4DiscColor = (v: Disc): string => (v === 0 ? '#F5F0FF' : v === 1 ? '#FF6B6B' : '#FFC93C');
