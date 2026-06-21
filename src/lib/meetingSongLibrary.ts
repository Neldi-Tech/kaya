// Meeting Song Library (Sunday-Meeting v4 · 2026-06-21).
//
// Every song used to close a meeting is saved here so the family can replay
// loved ones in the future. Each member can rate a song (1–5★); the library
// sorts highest-average first so favourites float to the top.
//
//   families/{familyId}/meetingSongLibrary/{songId}
//     { id, url, title?, provider, addedByName?, addedByUid?, addedAt,
//       playCount, lastPlayedAt?, ratings:{ [uid]: 1..5 }, avgRating, ratingCount }
//
// songId is derived from the link (YouTube id / Spotify id) so the same song
// pasted twice collapses to one entry (and its playCount climbs).

import {
  collection, doc, getDoc, getDocs, setDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { resolveSongEmbed } from './songEmbed';

const COL = 'meetingSongLibrary';

export interface SongLibraryEntry {
  id: string;
  url: string;
  title?: string;
  provider: 'youtube' | 'spotify' | 'other';
  addedByName?: string;
  addedByUid?: string;
  addedAt: number;
  playCount: number;
  lastPlayedAt?: number;
  /** uid → stars (1..5). One rating per member; re-rating overwrites. */
  ratings?: Record<string, number>;
  avgRating: number;   // 0 when unrated
  ratingCount: number;
  /** v4.1 — when set, this song is the chosen closing song for that meeting
   *  cycle (YYYY-MM-DD of the meeting day, or 'always' for no-schedule
   *  families). Lives here (family-writable) instead of on the parents-only
   *  family doc, so the meeting LEADER of the day — even a kid — can set it. */
  pickedForCycle?: string;
  pickedByName?: string;
}

/** Stable id for a link so the same song collapses to one library entry.
 *  YouTube → yt_<videoId>, Spotify → sp_<type>_<id>, else a sanitized slug. */
export function songIdFromUrl(url: string): string {
  const e = resolveSongEmbed(url);
  if (e.provider === 'youtube') {
    const m = e.embedUrl?.match(/embed\/([A-Za-z0-9_-]{11})/);
    if (m) return `yt_${m[1]}`;
  }
  if (e.provider === 'spotify') {
    const m = e.embedUrl?.match(/embed\/(\w+)\/([A-Za-z0-9]+)/);
    if (m) return `sp_${m[1]}_${m[2]}`;
  }
  // Fallback: sanitized slug of the URL (cap length for a valid doc id).
  return 'u_' + (url || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 60);
}

function providerOf(url: string): SongLibraryEntry['provider'] {
  const p = resolveSongEmbed(url).provider;
  return p === 'youtube' || p === 'spotify' ? p : 'other';
}

function recompute(ratings: Record<string, number> | undefined): { avgRating: number; ratingCount: number } {
  const vals = Object.values(ratings || {}).filter((n) => typeof n === 'number' && n > 0);
  if (vals.length === 0) return { avgRating: 0, ratingCount: 0 };
  const sum = vals.reduce((a, b) => a + b, 0);
  return { avgRating: Math.round((sum / vals.length) * 10) / 10, ratingCount: vals.length };
}

/**
 * Add a song to the library (or bump its playCount if already there).
 * Called from the closing-song reveal and the hub setter. Best-effort —
 * never throw into the caller; the song still plays if this fails.
 * Returns the songId so the caller can wire ratings to it.
 */
export async function upsertSong(
  familyId: string,
  song: { url: string; title?: string; addedByName?: string; addedByUid?: string; now?: number },
): Promise<string> {
  const url = (song.url || '').trim();
  const id = songIdFromUrl(url);
  const ref = doc(db, 'families', familyId, COL, id);
  const now = song.now ?? Date.now();
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const prev = snap.data() as SongLibraryEntry;
      await setDoc(ref, {
        playCount: (prev.playCount || 0) + 1,
        lastPlayedAt: now,
        // Fill a title in later if we now have one and didn't before.
        ...(song.title && !prev.title ? { title: song.title } : {}),
      }, { merge: true });
    } else {
      const entry: SongLibraryEntry = {
        id,
        url,
        title: song.title,
        provider: providerOf(url),
        addedByName: song.addedByName,
        addedByUid: song.addedByUid,
        addedAt: now,
        playCount: 1,
        lastPlayedAt: now,
        ratings: {},
        avgRating: 0,
        ratingCount: 0,
      };
      await setDoc(ref, entry);
    }
  } catch {
    /* best-effort — the song still plays even if the library write fails
       (e.g. rules not yet deployed). */
  }
  return id;
}

/** Set this member's rating (1..5) for a song and recompute the average. */
export async function rateSong(
  familyId: string,
  songId: string,
  uid: string,
  stars: number,
): Promise<void> {
  const ref = doc(db, 'families', familyId, COL, songId);
  try {
    const snap = await getDoc(ref);
    const prev = snap.exists() ? (snap.data() as SongLibraryEntry) : null;
    const ratings = { ...(prev?.ratings || {}), [uid]: Math.max(1, Math.min(5, Math.round(stars))) };
    const { avgRating, ratingCount } = recompute(ratings);
    await setDoc(ref, { ratings, avgRating, ratingCount }, { merge: true });
  } catch {
    /* best-effort */
  }
}

/** Read the whole library, sorted by avgRating desc then playCount desc. */
export async function getSongLibrary(familyId: string): Promise<SongLibraryEntry[]> {
  try {
    const snap = await getDocs(collection(db, 'families', familyId, COL));
    return snap.docs.map((d) => d.data() as SongLibraryEntry).sort(sortSongs);
  } catch {
    return [];
  }
}

/** Live subscription, same sort. Returns an unsubscribe fn. */
export function subscribeSongLibrary(
  familyId: string,
  cb: (rows: SongLibraryEntry[]) => void,
): () => void {
  return onSnapshot(
    collection(db, 'families', familyId, COL),
    (snap) => cb(snap.docs.map((d) => d.data() as SongLibraryEntry).sort(sortSongs)),
    () => cb([]),
  );
}

function sortSongs(a: SongLibraryEntry, b: SongLibraryEntry): number {
  if ((b.avgRating || 0) !== (a.avgRating || 0)) return (b.avgRating || 0) - (a.avgRating || 0);
  if ((b.playCount || 0) !== (a.playCount || 0)) return (b.playCount || 0) - (a.playCount || 0);
  return (b.lastPlayedAt || b.addedAt || 0) - (a.lastPlayedAt || a.addedAt || 0);
}

// ── Today's closing song (v4.1) ──────────────────────────────────────
// The chosen closing song for the current meeting cycle lives in the
// family-writable library (tagged `pickedForCycle`) — NOT on the
// parents-only family doc — so a kid LEADER of the day can set it too.

/** Set (or replace) today's closing song: upsert the song, tag it for this
 *  cycle, and clear the tag off any other song that held it. Returns the
 *  song id.
 *
 *  Unlike the reveal-path helpers, this DOES throw on failure — the hub
 *  setter surfaces the error so a permission-denied (e.g. rules not yet
 *  deployed) is visible instead of silently doing nothing. */
export async function setTodaysSong(
  familyId: string,
  song: { url: string; cycleKey: string; setByName?: string; setByUid?: string; title?: string; now?: number },
): Promise<string> {
  const url = (song.url || '').trim();
  const id = songIdFromUrl(url);
  const ref = doc(db, 'families', familyId, COL, id);
  const now = song.now ?? Date.now();

  // Upsert the song (throws on permission error — caller surfaces it).
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const prev = snap.data() as SongLibraryEntry;
    await setDoc(ref, {
      playCount: (prev.playCount || 0) + 1,
      lastPlayedAt: now,
      ...(song.title && !prev.title ? { title: song.title } : {}),
    }, { merge: true });
  } else {
    const entry: SongLibraryEntry = {
      id, url, title: song.title, provider: providerOf(url),
      addedByName: song.setByName, addedByUid: song.setByUid,
      addedAt: now, playCount: 1, lastPlayedAt: now,
      ratings: {}, avgRating: 0, ratingCount: 0,
    };
    await setDoc(ref, entry);
  }

  // Clear the tag off any previously-picked song for this cycle.
  const all = await getDocs(collection(db, 'families', familyId, COL));
  await Promise.all(all.docs.map((d) => {
    const data = d.data() as SongLibraryEntry;
    if (d.id !== id && data.pickedForCycle === song.cycleKey) {
      return setDoc(d.ref, { pickedForCycle: '' }, { merge: true });
    }
    return Promise.resolve();
  }));

  // Tag the chosen one.
  await setDoc(ref, { pickedForCycle: song.cycleKey, pickedByName: song.setByName || '' }, { merge: true });
  return id;
}

/** The song chosen for a given cycle, or null. */
export async function getTodaysSong(familyId: string, cycleKey: string): Promise<SongLibraryEntry | null> {
  try {
    const snap = await getDocs(collection(db, 'families', familyId, COL));
    const hit = snap.docs.map((d) => d.data() as SongLibraryEntry).find((s) => s.pickedForCycle === cycleKey);
    return hit || null;
  } catch {
    return null;
  }
}

/** Live subscription to today's chosen song. Returns an unsubscribe fn. */
export function subscribeTodaysSong(
  familyId: string,
  cycleKey: string,
  cb: (song: SongLibraryEntry | null) => void,
): () => void {
  return onSnapshot(
    collection(db, 'families', familyId, COL),
    (snap) => cb(snap.docs.map((d) => d.data() as SongLibraryEntry).find((s) => s.pickedForCycle === cycleKey) || null),
    () => cb(null),
  );
}

/** Remove today's pick (clears the tag off whatever held it for this cycle). */
export async function clearTodaysSong(familyId: string, cycleKey: string): Promise<void> {
  try {
    const snap = await getDocs(collection(db, 'families', familyId, COL));
    await Promise.all(snap.docs.map((d) => {
      const data = d.data() as SongLibraryEntry;
      if (data.pickedForCycle === cycleKey) return setDoc(d.ref, { pickedForCycle: '' }, { merge: true });
      return Promise.resolve();
    }));
  } catch {
    /* best-effort */
  }
}
