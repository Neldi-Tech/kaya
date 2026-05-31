'use client';

// Client → server bridge for a Real-World challenge completion. The kid
// uploads a photo (uploadGameProof) then calls this with the resulting URL;
// the server records a PENDING gamePlay carrying the proof, which the parent
// then approves in the existing /games/approvals queue.

import { auth } from '@/lib/firebase';

export interface ChallengeResult {
  ok?: boolean;
  status?: string;
  pointsPending?: number;
  skipped?: boolean;
  reason?: string;
  error?: string;
}

export async function submitChallenge(input: { gameId: string; proofUrl: string }): Promise<ChallengeResult> {
  const user = auth.currentUser;
  if (!user) return { error: 'not-signed-in' };
  let token: string;
  try { token = await user.getIdToken(); } catch { return { error: 'token-failed' }; }
  try {
    const res = await fetch('/api/games/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        gameId: input.gameId,
        proofUrl: input.proofUrl,
        tzOffsetMinutes: -new Date().getTimezoneOffset(),
      }),
    });
    return (await res.json()) as ChallengeResult;
  } catch (e) {
    return { error: String(e) };
  }
}
