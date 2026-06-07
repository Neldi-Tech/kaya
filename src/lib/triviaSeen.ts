'use client';

// Trivia "never-repeats" memory. Per family we keep the most-recent question
// texts (capped) so the AI generator can avoid them AND we can drop any that
// slip through — plus a running count of questions ever explored. Stored at
// families/{fid}/gameMeta/triviaSeen (family-readable/writable).

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

const RECENT_CAP = 150; // questions remembered (a kid won't notice a repeat older than this)

export interface TriviaSeen { recent: string[]; count: number }

export function normalizeQ(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Key the memory by mode so general + each local country keep separate pools. */
function seenDoc(familyId: string, scope: string) {
  return doc(db, 'families', familyId, 'gameMeta', `triviaSeen_${scope}`);
}

export async function readTriviaSeen(familyId: string, scope = 'general'): Promise<TriviaSeen> {
  try {
    const snap = await getDoc(seenDoc(familyId, scope));
    const d = snap.data() as { recent?: string[]; count?: number } | undefined;
    return { recent: Array.isArray(d?.recent) ? d!.recent! : [], count: Number(d?.count) || 0 };
  } catch { return { recent: [], count: 0 }; }
}

/** Record the freshly-served questions; returns the new total-explored count. */
export async function recordTriviaSeen(
  familyId: string, newTexts: string[], prev: TriviaSeen, scope = 'general',
): Promise<number> {
  const recent = [...newTexts, ...prev.recent].slice(0, RECENT_CAP);
  const count = prev.count + newTexts.length;
  try {
    await setDoc(seenDoc(familyId, scope), { recent, count, updatedAt: Date.now() }, { merge: true });
  } catch { /* best-effort — the game still plays */ }
  return count;
}

/** Drop any question whose normalized text matches one we've recently served. */
export function dedupeAgainst<T extends { q: string }>(qs: T[], recent: string[]): T[] {
  const seen = new Set(recent.map(normalizeQ));
  return qs.filter((x) => !seen.has(normalizeQ(x.q)));
}
