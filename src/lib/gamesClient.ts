'use client';

// Client → server bridge for recording a finished game.
// Gets the caller's Firebase ID token and POSTs to /api/games/award, which
// derives the kid + the parent-set points value server-side. The client
// never sends a points value or a childId — it can't forge either.
//
// HP carries real value, so nothing is credited here: a valued game comes
// back `status: 'pending'` (awaiting a parent's approval) and a 0-value game
// comes back `status: 'logged'` (recorded only).

import { auth } from '@/lib/firebase';

import type { GamePlayStatus } from '@/lib/games';

export interface AwardResult {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  status?: GamePlayStatus;     // 'pending' (awaiting approval) | 'logged' | …
  pointsAwarded?: number;      // HP actually credited (0 until approved)
  pointsPending?: number;      // HP proposed, awaiting a parent's approval
  basePoints?: number;
  multiplier?: number;
  capped?: boolean;
  newTotal?: number;
  error?: string;
}

export async function awardGame(input: {
  gameId: string;
  score?: number | null;
  durationSec?: number;
  /** Set when the completion came from a multi-device room → Fun-Points are
   *  credited by /api/games/win for all players instead of here. */
  multiplayer?: boolean;
}): Promise<AwardResult> {
  const user = auth.currentUser;
  if (!user) return { error: 'not-signed-in' };
  let token: string;
  try { token = await user.getIdToken(); }
  catch { return { error: 'token-failed' }; }
  try {
    const res = await fetch('/api/games/award', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        gameId: input.gameId,
        score: input.score ?? null,
        durationSec: input.durationSec ?? 0,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
        multiplayer: input.multiplayer ?? false,
      }),
    });
    return (await res.json()) as AwardResult;
  } catch (e) {
    return { error: String(e) };
  }
}
