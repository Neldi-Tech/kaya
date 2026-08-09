// ── 📊 Meeting Meter (approved 2026-07-20 · OF-5) ───────────────────────
// Post-meeting 4-face rating from EVERY member's own device. Ratings live
// in the family-writable `gameMeta` collection (doc id meetingMeter_<id>)
// — the meetings collection is create-only for family members, so the
// meter rides the same no-rules-deploy path QotD state uses. The notes
// page + share email join the meter doc back onto the meeting record.

import {
  doc, getDoc, setDoc, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';

export const METER_FACES = [
  { score: 1, emoji: '😴', label: 'Sleepy' },
  { score: 2, emoji: '🙂', label: 'Good' },
  { score: 3, emoji: '😄', label: 'Great' },
  { score: 4, emoji: '🤩', label: 'Best night!' },
] as const;

export interface MeterDoc {
  meetingId: string;
  /** Meeting date, YYYY-MM-DD — lets cards find "this week's" meter. */
  date: string;
  /** uid → 1..4. One vote per member; re-tapping overwrites. */
  ratings: Record<string, number>;
  updatedAt: number;
}

const meterRef = (familyId: string, meetingId: string) =>
  doc(db, 'families', familyId, 'gameMeta', `meetingMeter_${meetingId}`);

/** Record (or change) one member's rating. Merge-safe from any device. */
export async function rateMeeting(
  familyId: string, meetingId: string, date: string, uid: string, score: number,
): Promise<void> {
  await setDoc(meterRef(familyId, meetingId), {
    meetingId,
    date,
    ratings: { [uid]: score },
    updatedAt: Date.now(),
  }, { merge: true });
}

export function subscribeMeter(
  familyId: string, meetingId: string, cb: (m: MeterDoc | null) => void,
): () => void {
  return onSnapshot(meterRef(familyId, meetingId), (snap) => {
    cb(snap.exists() ? (snap.data() as MeterDoc) : null);
  }, () => cb(null));
}

export async function getMeter(familyId: string, meetingId: string): Promise<MeterDoc | null> {
  try {
    const snap = await getDoc(meterRef(familyId, meetingId));
    return snap.exists() ? (snap.data() as MeterDoc) : null;
  } catch {
    return null;
  }
}

/** Average + vote count of a meter doc. null when nobody voted yet. */
export function meterAverage(m: MeterDoc | null | undefined): { avg: number; count: number } | null {
  const scores = Object.values(m?.ratings || {}).filter((n) => n >= 1 && n <= 4);
  if (scores.length === 0) return null;
  return { avg: scores.reduce((a, b) => a + b, 0) / scores.length, count: scores.length };
}

/** The face nearest an average — for compact "😄 3.2 · 4 votes" labels. */
export function faceForAvg(avg: number): { emoji: string; label: string } {
  const f = METER_FACES[Math.min(METER_FACES.length - 1, Math.max(0, Math.round(avg) - 1))];
  return { emoji: f.emoji, label: f.label };
}

/** Compact one-line summary for the notes page + share email. */
export function meterSummaryLabel(m: MeterDoc | null | undefined): string | null {
  const a = meterAverage(m);
  if (!a) return null;
  const f = faceForAvg(a.avg);
  return `${f.emoji} ${a.avg.toFixed(1)} / 4 · ${a.count} ${a.count === 1 ? 'vote' : 'votes'}`;
}

/** 🏆 Best-yet check — fetch prior meetings' meters and compare averages.
 *  Returns true when `meetingId`'s average beats every previous rated
 *  meeting. Caps the lookback so the check stays cheap. */
export async function isBestMeetingYet(
  familyId: string, meetingId: string, priorMeetingIds: string[],
): Promise<boolean> {
  const mine = meterAverage(await getMeter(familyId, meetingId));
  if (!mine) return false;
  const prior = await Promise.all(
    priorMeetingIds.slice(0, 12).map((id) => getMeter(familyId, id)),
  );
  const priorAvgs = prior.map((m) => meterAverage(m)?.avg).filter((v): v is number => v != null);
  if (priorAvgs.length === 0) return false;
  return mine.avg > Math.max(...priorAvgs);
}
