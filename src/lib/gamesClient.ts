'use client';

// Client → server bridge for awarding House Points from a finished game.
// Gets the caller's Firebase ID token and POSTs to /api/games/award, which
// derives the kid + points server-side and enforces the daily cap. The
// client never sends a points value or a childId — it can't forge either.

import { auth } from '@/lib/firebase';

export interface AwardResult {
  ok?: boolean;
  skipped?: boolean;
  reason?: string;
  pointsAwarded?: number;
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
      }),
    });
    return (await res.json()) as AwardResult;
  } catch (e) {
    return { error: String(e) };
  }
}
