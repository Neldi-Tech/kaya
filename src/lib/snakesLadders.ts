// Pure Snakes & Ladders logic + board, shared by the same-device component
// (components/games/SnakesLadders) and the two-device room play
// (components/games/MultiDeviceRoom). Framework-free + standalone so both can
// import it without a circular dependency.

export const SL_LADDERS: Record<number, number> = { 1: 38, 4: 14, 9: 31, 21: 42, 28: 84, 51: 67, 72: 91, 80: 99 };
export const SL_SNAKES: Record<number, number> = { 17: 7, 54: 34, 62: 19, 64: 60, 87: 24, 93: 73, 95: 75, 98: 79 };

/** Board cell number for a grid position (row 0 = top), laid out boustrophedon
 *  (snake-wise) so 1 is bottom-left and 100 top-left. */
export function slCellNumber(rowFromTop: number, col: number): number {
  const br = 9 - rowFromTop;
  return br % 2 === 0 ? br * 10 + col + 1 : br * 10 + (10 - col);
}

/** New square after rolling `die` from `cur`: must land exactly on 100, then
 *  apply any ladder (climb) or snake (slide). */
export function slAdvance(cur: number, die: number): number {
  let next = cur + die;
  if (next > 100) next = cur;                 // must land exactly on 100
  if (SL_LADDERS[next]) next = SL_LADDERS[next];
  else if (SL_SNAKES[next]) next = SL_SNAKES[next];
  return next;
}

/** A fair 1–6 die roll. */
export const slRollDie = (): number => 1 + Math.floor(Math.random() * 6);
