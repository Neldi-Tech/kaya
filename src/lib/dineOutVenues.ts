// Dine Out venues (2026-05-23) — a per-family record of the places you
// eat out, built from Dine Out logs. Powers "Places to go" (re-select +
// filter) and the Diamond recommendation: when BOTH parents rate a venue
// Diamond it earns a family Diamond (above the star average).
//
// Designed to roll up beyond one family later — store per-parent ratings
// + the family Diamond now; a future cross-family aggregation can derive
// network "Diamond Status" (see project_kaya_diamond_venues memory).
'use client';

import {
  collection, doc, getDoc, setDoc, onSnapshot, query, orderBy, limit,
  serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export interface VenueRating { stars: number; diamond: boolean }

export interface Venue {
  id: string;            // slug of the name
  name: string;
  emoji: string;         // sub-tag emoji or 🍽️
  subTag?: string;       // last DineOutCategory id used
  count: number;         // visits logged
  totalSpentCents: number;
  /** Per-parent latest rating, keyed by parent uid. */
  ratings: Record<string, VenueRating>;
  /** Average of all parents' star ratings (0 = none yet). */
  avgStars: number;
  /** Family Diamond — true when 2+ parents rated it Diamond. */
  diamond: boolean;
  /** Accumulated 1–2 word highlight tags (deduped). */
  highlights: string[];
  lastVisitAt?: Timestamp;
}

const venuesCol = (familyId: string) =>
  collection(db, 'families', familyId, 'venues');

/** Stable doc id for a venue — slug of the name, so re-logging the same
 *  place dedupes onto one record. */
export function venueId(name: string): string {
  const slug = name.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return slug || 'venue';
}

/** Live list of the family's venues, most-visited first. */
export function subscribeToVenues(familyId: string, cb: (v: Venue[]) => void): () => void {
  if (isGuestActive()) { cb([]); return () => {}; }
  const q = query(venuesCol(familyId), orderBy('count', 'desc'), limit(100));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Venue))),
    () => cb([]),
  );
}

/** Record a Dine Out visit against a venue: bump count + spend, set this
 *  parent's rating, recompute the star average + family Diamond, merge
 *  highlights. Read-modify-write (a meal log is low-frequency). */
export async function recordVenueVisit(
  familyId: string,
  args: {
    name: string;
    parentUid: string;
    stars: number;          // 0–5 (0 = no star rating given)
    diamond: boolean;
    highlights?: string[];
    spentCents?: number;
    subTag?: string;
    emoji?: string;
  },
): Promise<void> {
  if (isGuestActive()) return;
  const name = args.name.trim();
  if (!name) return;
  const id = venueId(name);
  const ref = doc(venuesCol(familyId), id);
  const snap = await getDoc(ref);
  const prev = snap.exists() ? (snap.data() as Venue) : null;

  const ratings: Record<string, VenueRating> = { ...(prev?.ratings ?? {}) };
  ratings[args.parentUid] = {
    stars: Math.max(0, Math.min(5, Math.round(args.stars || 0))),
    diamond: !!args.diamond,
  };
  const starVals = Object.values(ratings).map((r) => r.stars).filter((s) => s > 0);
  const avgStars = starVals.length
    ? Math.round((starVals.reduce((a, b) => a + b, 0) / starVals.length) * 10) / 10
    : 0;
  // Family Diamond = both parents (2+) marked it Diamond.
  const diamond = Object.values(ratings).filter((r) => r.diamond).length >= 2;
  const highlights = Array.from(new Set([
    ...(prev?.highlights ?? []),
    ...(args.highlights ?? []).map((h) => h.trim()).filter(Boolean),
  ])).slice(0, 16);

  const subTag = args.subTag ?? prev?.subTag;
  await setDoc(ref, {
    id,
    name,
    emoji: args.emoji ?? prev?.emoji ?? '🍽️',
    ...(subTag ? { subTag } : {}),
    count: (prev?.count ?? 0) + 1,
    totalSpentCents: (prev?.totalSpentCents ?? 0) + Math.max(0, args.spentCents ?? 0),
    ratings,
    avgStars,
    diamond,
    highlights,
    lastVisitAt: serverTimestamp(),
  });
}
