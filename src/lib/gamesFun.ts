// Kaya Games — Fun-Points (pure; shared by the server award/win routes AND the
// client board, so no Firestore/SDK import here).
//
// Fun-Points are a SECOND, gaming-only currency, separate from House Points:
//   • Every game awards them; HP stays reserved for mind-strengthening games.
//   • No real value, no parent approval — instant, for the family gaming board.
//   • Stored per-player on families/{fid}/gameStats/{uid} (career + this week),
//     so PARENTS and kids both accrue them.
// Earned as  base(game) × difficulty × outcome  — the winner of a multiplayer
// game gets FUN_WIN_MULT× the base; everyone else (and solo players) get 1×.

// The display name is deliberately a single constant — Elia will pick the final
// name; changing it here renames it everywhere.
export const FUN_LABEL = 'Fun Points';
export const FUN_EMOJI = '✨';

/** Winner of a multiplayer game gets this multiple of the base. */
export const FUN_WIN_MULT = 2;

/** Difficulty multipliers (applied where a game reports a level). */
export const FUN_DIFFICULTY: Record<'easy' | 'medium' | 'hard', number> = { easy: 1, medium: 1.5, hard: 2 };

/** Question of the Day — Fun-Points. Answering pays QOTD_DAILY (right OR wrong,
 *  so it stays a friendly daily habit for parents and young kids alike); a
 *  correct answer adds QOTD_CORRECT; and each time the personal streak lands on
 *  a multiple of the family's target (default 3 days) it pays QOTD_MILESTONE ×
 *  target as a celebratory burst. Server-credited in /api/games/qotd/answer. */
export const QOTD_DAILY_FUN = 40;
export const QOTD_CORRECT_FUN = 20;
export const QOTD_MILESTONE_FUN = 30;

/** Arcade scale on the catalog's inherent value, so Fun-Points read as big,
 *  satisfying gaming numbers (distinct from the small, valuable HP). Tunable. */
const FUN_SCALE = 5;

/** Base Fun-Points for a game, from its catalog `points` (its inherent value). */
export function gameFunValue(points: number | undefined): number {
  return Math.max(1, Math.round((points || 10) * FUN_SCALE));
}

/** Fold a Fun-Points award into the player's running totals, resetting the
 *  weekly bucket when the ISO-week key rolls over. Pure → both routes share it. */
export function nextFun(
  cur: { funPoints?: number; funWeekly?: number; funWeekKey?: string },
  amount: number,
  weekKey: string,
): { funPoints: number; funWeekly: number; funWeekKey: string } {
  const sameWeek = cur.funWeekKey === weekKey;
  return {
    funPoints: (cur.funPoints || 0) + amount,
    funWeekly: (sameWeek ? (cur.funWeekly || 0) : 0) + amount,
    funWeekKey: weekKey,
  };
}
