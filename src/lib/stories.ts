// Kaya Games — saved "Story Keepsake" types (pure; NO Firestore/SDK import, so
// both the Admin save route and the client gallery can share them).

export interface StoryScore {
  /** Overall 1–5 stars (whole number) — generous, this is a keepsake. */
  stars: number;
  /** A fun, child-friendly title the AI gave the story. */
  title: string;
  /** 1–2 warm, kid-facing sentences celebrating the story. */
  praise: string;
  creativity: number;   // 0–100
  teamwork: number;     // 0–100
  imagination: number;  // 0–100
}

export interface StorySentence { uid: string; name: string; text: string }

export interface SavedStory {
  id: string;
  gameId: string;                 // 'story-builder'
  createdAt: number;              // ms epoch
  expiresAt: number | null;       // ms epoch; null = kept forever
  contributors: string[];         // distinct player display names, in order
  sentences: StorySentence[];     // each contributed sentence
  text: string;                   // sentences joined into one passage
  title: string;                  // score.title, or 'A Family Story'
  score: StoryScore | null;       // null if the AI was unavailable
  savedByUid: string;
  savedByName: string;
}

/** A story is expired (hidden in the gallery) once now passes expiresAt.
 *  expiresAt null/0 means "kept forever" and never expires. */
export function storyExpired(s: { expiresAt?: number | null }, nowMs: number): boolean {
  return typeof s.expiresAt === 'number' && s.expiresAt > 0 && nowMs >= s.expiresAt;
}
