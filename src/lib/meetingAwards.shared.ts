// 🙋 Meeting awards — shared, PURE layer (Sunday Meeting upgrade · PR4 ·
// approved design v2, 21-Sep-2026 · R11–R16).
//
// The Sunday-meeting bonuses — ⭐ Star podium · 🏆 Excellent Belt · 🪜 Ladder
// champion — can now be PROPOSED by a kid running the meeting and decided by
// a parent; parents still award straight in. No firebase imports here: the
// Admin gateway (/api/meetings/awards) and the client both use it, so the
// server re-checks a winner with the SAME functions the screen used.
//
// One slot = one award, ever (F5): `star·1·{child}·{from}·{to}`. A kid's
// proposal, a parent's approval and a parent's direct award all live under
// that one key in `meetingAwardProposals/{slot}`, so "✓ awarded" survives a
// refresh and a second device, and nothing can be given twice.

import type { Child, DailyRating, Routine } from './firestore';
import {
  computeWindowRange, computeDayScores, computeStarStandings, starPodiumRanks, beltChampions, computeReview,
  type WindowKey, type WindowRange,
} from './meetingReview';

export type MeetingAwardType = 'star' | 'belt' | 'ladder';
export type MeetingAwardStatus = 'pending' | 'resolving' | 'approved' | 'adjusted' | 'declined';

export interface MeetingAwardProposal {
  id: string;                 // = slot
  slot: string;
  type: MeetingAwardType;
  rank?: 1 | 2 | 3;           // star only
  childId: string;
  childName: string;
  childEmoji: string;
  from: string;
  to: string;
  rangeLabel: string;
  /** The family's set amount (kids can't change it — parents adjust on approval). */
  points: number;
  /** Server-composed; becomes the award's reason on approval. */
  reason: string;
  /** Server-composed proof line ("2 perfect days · Tue · 15-Sep, Fri · 18-Sep"). */
  evidence: string;
  status: MeetingAwardStatus;
  /** true = a parent awarded straight in (no proposal step). */
  direct?: boolean;
  proposedBy: string;
  proposedByName: string;
  bundleId?: string;
  createdAt: number;
  finalPoints?: number;
  awardId?: string;
  parentNote?: string;
  resolvedBy?: string;
  resolvedByName?: string;
  resolvedAt?: number;
}

/** R12 — the family's set amounts. Belt = the Diamond floor (a perfect day is a Diamond-tier honour). */
export function meetingAwardPoints(type: MeetingAwardType, rank: number | undefined, diamondMinPoints: number): number {
  if (type === 'belt') return Math.max(5, diamondMinPoints);
  if (type === 'ladder') return 2;
  return rank === 1 ? 3 : rank === 2 ? 2 : 1;
}

export const MEDAL: Record<number, { emoji: string; label: string }> = {
  1: { emoji: '🥇', label: 'Winner' },
  2: { emoji: '🥈', label: '2nd' },
  3: { emoji: '🥉', label: '3rd' },
};

/** Firestore-safe doc id (no slashes) — also the dedupe key. */
export function meetingAwardSlot(type: MeetingAwardType, rank: number | undefined, childId: string, from: string, to: string): string {
  return [type, type === 'star' ? String(rank || 0) : '0', childId, from, to].join('__');
}

export const AWARD_TITLE: Record<MeetingAwardType, string> = {
  star: '⭐ Star podium',
  belt: '🏆 Excellent Belt bonus',
  ladder: '🪜 Ladder bonus',
};

export function awardTitle(p: Pick<MeetingAwardProposal, 'type' | 'rank'>): string {
  return p.type === 'star' && p.rank ? `${AWARD_TITLE.star} ${MEDAL[p.rank].emoji}` : AWARD_TITLE[p.type];
}

// ── Which windows a KID may propose from (Q4 · F6) ───────────────────
// EXACTLY the two ceremonies Elia approved: weekly = "Last 7 days", monthly
// = "This month". Nothing else — not Last 14 days, not Lifetime, and not the
// Months ▾ picker either: "Sep 2026" is a DIFFERENT slot from "This month"
// for the very same month, which would let one Star be claimed twice.

function addDaysStr(s: string, n: number): string {
  const d = new Date(`${s}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function kidWindowAllowed(key: WindowKey, meetingDate: string, todayStr: string): boolean {
  // The meeting date must be "now" (±1 day absorbs time zones) — no proposing for a night long gone.
  if (meetingDate < addDaysStr(todayStr, -1) || meetingDate > addDaysStr(todayStr, 1)) return false;
  return key.kind === 'last7' || key.kind === 'mtd';
}

export const KID_WINDOW_HINT = 'Kids can propose on “Last 7 days” or “This month” — the two ceremonies.';

// ── Who REALLY won (R13) — the same math the screen shows ────────────

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${DAY_ABBR[new Date(y, m - 1, d).getDay()]} · ${String(d).padStart(2, '0')}-${MONTH_ABBR[m - 1]}`;
}

export interface VerifiedAward { ok: true; reason: string; evidence: string }
export interface RefusedAward { ok: false; error: 'not-the-winner' | 'nothing-to-award' }

export function verifyMeetingAward(o: {
  type: MeetingAwardType; rank?: number; childId: string;
  children: Child[]; routines: Routine[]; ratings: DailyRating[]; range: WindowRange;
}): VerifiedAward | RefusedAward {
  const { type, rank, childId, children, routines, ratings, range } = o;
  const kid = children.find((c) => c.id === childId);
  if (!kid) return { ok: false, error: 'not-the-winner' };
  const name = kid.name.split(' ')[0];
  const dayScores = computeDayScores(children, ratings, range);

  if (type === 'star') {
    if (rank !== 1 && rank !== 2 && rank !== 3) return { ok: false, error: 'not-the-winner' };
    const { standings } = computeStarStandings(dayScores);
    const ranks = starPodiumRanks(standings);
    if (ranks.get(childId) !== rank) return { ok: false, error: 'not-the-winner' };
    const s = standings.find((x) => x.childId === childId);
    return {
      ok: true,
      reason: `⭐ Star podium ${MEDAL[rank].emoji} ${MEDAL[rank].label} — ${range.label}`,
      evidence: `${name} is ${MEDAL[rank].emoji} on the Star podium — score ${s?.score ?? 0} (${s?.excellent ?? 0} 🌟 · ${s?.good ?? 0} 👍 · ${s?.bad ?? 0} 👎 over ${s?.daysRated ?? 0} day${s?.daysRated === 1 ? '' : 's'}).`,
    };
  }

  if (type === 'belt') {
    const champs = beltChampions(dayScores);
    const mine = champs.find((c) => c.childId === childId);
    if (!mine || !mine.isChampion || mine.count <= 0) return { ok: false, error: champs.some((c) => c.isChampion) ? 'not-the-winner' : 'nothing-to-award' };
    const days = mine.days.map((d) => d.date).sort().map(shortDay).join(', ');
    const others = champs.filter((c) => c.isChampion && c.childId !== childId).length;
    return {
      ok: true,
      reason: `Excellent Belt — ${mine.count} perfect day${mine.count === 1 ? '' : 's'} · ${range.label}`,
      evidence: `${name} is the Belt champion — ${mine.count} perfect day${mine.count === 1 ? '' : 's'} (${days}).${others ? ` Shared with ${others} other${others === 1 ? '' : 's'}.` : ''}`,
    };
  }

  // ladder — most routines kept Excellent (ties each receive it, R14)
  const review = computeReview(children, routines, ratings, [], range);
  if (review.ladderWinnerCount <= 0) return { ok: false, error: 'nothing-to-award' };
  if (!review.ladderWinnerIds.includes(childId)) return { ok: false, error: 'not-the-winner' };
  const n = review.ladderWinnerCount;
  const tie = review.ladderWinnerIds.length - 1;
  return {
    ok: true,
    reason: `🪜 Ladder champion — ${n} routine${n === 1 ? '' : 's'} kept Excellent · ${range.label}`,
    evidence: `${name} is the Ladder champion — ${n} routine${n === 1 ? '' : 's'} kept Excellent on every rated day.${tie ? ` Tied with ${tie} other${tie === 1 ? '' : 's'} — each receives it.` : ''}`,
  };
}

export { computeWindowRange };
export type { WindowKey, WindowRange };

/** Plain words for every gateway refusal. */
export function meetingAwardErrorText(code: string): string {
  switch (code) {
    case 'kid-proposals-off': return 'Proposing is switched off for your family — ask a parent to give this one.';
    case 'window-not-allowed': return KID_WINDOW_HINT;
    case 'not-the-winner': return 'Kaya checked the ratings — that isn’t the winner for this window. Refresh and look again.';
    case 'nothing-to-award': return 'Nobody has earned this one in this window yet.';
    case 'already-proposed': return 'Already proposed — it’s waiting for a parent.';
    case 'already-awarded': return 'This one has already been awarded.';
    case 'already-decided': return 'A parent has already decided this one.';
    case 'note-required': return 'Add a short note for the kids — they read it on the meeting screen.';
    case 'not-pending': return 'Someone else is deciding this one right now.';
    case 'parents-only': return 'Only a parent can do that.';
    case 'kids-propose': return 'Parents award straight in — no need to propose.';
    case 'unauthenticated': case 'invalid-token': return 'Please sign in again.';
    case 'admin-not-configured': return 'Saving isn’t available on this preview — it works on the live app.';
    case 'offline': return 'No connection — check the internet and try again.';
    default: return 'Something went wrong — please try again.';
  }
}
