// HP2 · Routine-fill RAG — client fetch wrapper around routineFillCore.
// One single-field range query on the family's `ratings` (auto-indexed,
// no composite index), filtered to the helper in memory. Reads only —
// nothing new is written; the helper's existing morning/evening logs
// are the source.

'use client';

import { collection, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from './firebase';
import type { HelperLink } from './firestore';
import {
  computeRoutineFill, ymdLocal, type FillRatingLite, type FillSummary, type FillHelperLite,
} from './routineFillCore';

export function helperToFillLite(link: HelperLink): FillHelperLite {
  let joinedDate: string | null = null;
  try {
    const ms = link.createdAt?.toMillis?.();
    if (ms) joinedDate = ymdLocal(new Date(ms));
  } catch { /* leave null */ }
  return {
    uid: link.uid,
    kidIds: link.kidIds ?? [],
    expectedFrequency: link.expectedFrequency,
    workDays: link.workDays ?? null,
    joinedDate,
  };
}

export async function fetchRatingsLite(familyId: string, from: string, to: string): Promise<FillRatingLite[]> {
  const snap = await getDocs(query(
    collection(db, 'families', familyId, 'ratings'),
    where('date', '>=', from),
    where('date', '<=', to),
    limit(2000),
  ));
  const out: FillRatingLite[] = [];
  snap.forEach((d) => {
    const r = d.data() as { date?: string; childId?: string; period?: string; ratedBy?: string };
    if (r.date && r.childId && r.period && r.ratedBy) {
      out.push({ date: r.date, childId: r.childId, period: r.period, ratedBy: r.ratedBy });
    }
  });
  return out;
}

export async function getRoutineFill(
  familyId: string,
  link: HelperLink,
  from: string,
  to: string,
): Promise<FillSummary> {
  const today = ymdLocal(new Date());
  const ratings = await fetchRatingsLite(familyId, from, to);
  return computeRoutineFill(helperToFillLite(link), ratings, from, to, today);
}
