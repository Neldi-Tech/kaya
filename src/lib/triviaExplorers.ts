'use client';

// Explorer Levels — each player earns XP for correct trivia answers; their
// level (and title) climbs as they learn. Per family at
// families/{fid}/gameMeta/explorers. Also drives the "Auto" difficulty.

import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface Explorer { xp: number; name: string }

const explorersDoc = (fid: string) => doc(db, 'families', fid, 'gameMeta', 'explorers');

/** XP → level (gentle curve: 0→L1, 45→L4, 125→L6, 320→L9, 720→L13). */
export function levelFor(xp: number): number {
  return Math.floor(Math.sqrt(Math.max(0, xp) / 5)) + 1;
}
export function xpForLevel(level: number): number {
  return 5 * (level - 1) * (level - 1);
}
export function levelTitle(level: number): string {
  if (level >= 13) return 'World Master 🌟';
  if (level >= 9) return 'Explorer 🧭';
  if (level >= 6) return 'Geographer 🗺️';
  if (level >= 3) return 'Adventurer 🎒';
  return 'Rookie 🐣';
}
/** Progress (0..1) toward the next level. */
export function levelProgress(xp: number): number {
  const lvl = levelFor(xp);
  const lo = xpForLevel(lvl), hi = xpForLevel(lvl + 1);
  return hi > lo ? Math.max(0, Math.min(1, (xp - lo) / (hi - lo))) : 1;
}

export async function readExplorers(fid: string): Promise<Record<string, Explorer>> {
  try {
    const s = await getDoc(explorersDoc(fid));
    return (s.data()?.players as Record<string, Explorer>) || {};
  } catch { return {}; }
}

/** Add XP to each player (host writes once per finished game). */
export async function recordExplorerXp(fid: string, awards: { uid: string; name: string; xp: number }[]): Promise<void> {
  if (!awards.length) return;
  try {
    const cur = await readExplorers(fid);
    const next = { ...cur };
    for (const a of awards) next[a.uid] = { xp: (cur[a.uid]?.xp || 0) + a.xp, name: a.name || cur[a.uid]?.name || 'Player' };
    await setDoc(explorersDoc(fid), { players: next, updatedAt: Date.now() }, { merge: true });
  } catch { /* best-effort — the game still plays */ }
}

/** "Auto" difficulty: grow with how much the family has explored. */
export function autoDifficulty(exploredCount: number): 'easy' | 'medium' | 'hard' {
  if (exploredCount < 60) return 'easy';
  if (exploredCount < 250) return 'medium';
  return 'hard';
}
