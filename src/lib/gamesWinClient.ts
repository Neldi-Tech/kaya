'use client';

// Records a finished multi-device game's win. The host calls this with the
// sessionId; the server derives the winner from the session (forge-proof) and
// updates the leaderboard's win + streak counters. Idempotent server-side.

import { auth } from '@/lib/firebase';

export interface WinResult {
  ok?: boolean;
  winnerUid?: string | null;
  winnerStreak?: number;
  skipped?: boolean;
  alreadyRecorded?: boolean;
  error?: string;
}

export async function recordWin(sessionId: string): Promise<WinResult> {
  const user = auth.currentUser;
  if (!user) return { error: 'not-signed-in' };
  let token: string;
  try { token = await user.getIdToken(); } catch { return { error: 'token-failed' }; }
  try {
    const res = await fetch('/api/games/win', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId }),
    });
    return (await res.json()) as WinResult;
  } catch (e) {
    return { error: String(e) };
  }
}
