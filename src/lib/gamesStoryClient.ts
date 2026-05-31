'use client';

// Saves a finished Story Builder story as a keepsake. The host calls this with
// the sessionId; the server reads the story from the session (forge-proof),
// AI-scores it, stamps an expiry from the family's retention setting, and writes
// it to families/{fid}/stories. Idempotent server-side (session.storySaved).

import { auth } from '@/lib/firebase';
import type { StoryScore } from '@/lib/stories';

export interface SaveStoryResult {
  ok?: boolean;
  storyId?: string;
  score?: StoryScore | null;
  alreadySaved?: boolean;
  skipped?: boolean;
  error?: string;
}

export async function saveStory(sessionId: string): Promise<SaveStoryResult> {
  const user = auth.currentUser;
  if (!user) return { error: 'not-signed-in' };
  let token: string;
  try { token = await user.getIdToken(); } catch { return { error: 'token-failed' }; }
  try {
    const res = await fetch('/api/games/story/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId }),
    });
    return (await res.json()) as SaveStoryResult;
  } catch (e) {
    return { error: String(e) };
  }
}
