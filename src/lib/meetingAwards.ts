// 🙋 Meeting awards — client flows over /api/meetings/awards.
//   kids    → proposeMeetingAwards()          (a parent decides later)
//   parents → awardMeetingDirect()            (straight in, as always)
//           → decideMeetingAward()            (approve · adjust · decline + note)
// The points themselves ride the normal award rail (giveAward) BETWEEN a
// claim/reserve and a finalize — the same safe pattern as Leader notes — so
// badges, the 🏅 kid emails and thresholds behave exactly as today, and a
// failure half-way releases the slot instead of stranding it.

import { auth as fbAuth } from '@/lib/firebase';
import { giveAward } from '@/lib/firestore';
import type { MeetingAwardProposal, MeetingAwardType, WindowKey } from '@/lib/meetingAwards.shared';

export type { MeetingAwardProposal, MeetingAwardType };

export class MeetingAwardError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  let token: string | undefined;
  try { token = await fbAuth.currentUser?.getIdToken(); } catch { /* below */ }
  if (!token) throw new MeetingAwardError('unauthenticated');
  let res: Response;
  try {
    res = await fetch('/api/meetings/awards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch { throw new MeetingAwardError('offline'); }
  const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!res.ok || !json.ok) throw new MeetingAwardError(json.error || 'failed');
  return json;
}

export interface AwardItem { type: MeetingAwardType; rank?: number; childId: string }

/** A kid proposes one award — or the whole podium as one bundle (one push for the parents). */
export const proposeMeetingAwards = (familyId: string, key: WindowKey, meetingDate: string, items: AwardItem[]) =>
  call<{ proposals: MeetingAwardProposal[]; results: Array<{ slot: string; ok: boolean; error?: string }> }>({ action: 'propose', familyId, key, meetingDate, items });

export const listMeetingAwards = (familyId: string, q: { from: string; to: string } | { pending: true }) =>
  call<{ proposals: MeetingAwardProposal[] }>({ action: 'list', familyId, ...('from' in q ? q : {}) });

interface Awarder { uid: string; displayName?: string | null }

/** A parent awards straight in — reserve the slot → the normal award → finalize. */
export async function awardMeetingDirect(o: {
  familyId: string; me: Awarder; key: WindowKey; meetingDate: string; item: AwardItem; points: number; diamondMinPoints: number;
}): Promise<MeetingAwardProposal> {
  const r = await call<{ proposals: MeetingAwardProposal[] }>({ action: 'reserve-direct', familyId: o.familyId, key: o.key, meetingDate: o.meetingDate, items: [o.item] });
  const p = r.proposals[0];
  const points = Math.max(1, Math.round(o.points));
  try {
    const given = await giveAward(o.familyId, {
      childId: p.childId,
      kind: points >= o.diamondMinPoints ? 'diamond' : 'regular',
      points,
      reason: p.reason,
      category: 'family-meeting',
      awardedBy: o.me.uid,
      awardedByName: o.me.displayName || 'Parent',
      meetingSlot: p.slot,
    });
    await call({ action: 'finalize', familyId: o.familyId, id: p.id, decision: 'approved', finalPoints: points, awardId: given.id });
    return { ...p, status: 'approved', finalPoints: points, awardId: given.id, resolvedByName: o.me.displayName || 'Parent', resolvedAt: Date.now() };
  } catch (e) {
    await call({ action: 'release', familyId: o.familyId, id: p.id }).catch(() => {});
    throw e;
  }
}

/** A parent decides a kid's proposal — always with a note for the kids. */
export async function decideMeetingAward(o: {
  familyId: string; me: Awarder; proposal: MeetingAwardProposal; decision: 'approve' | 'decline'; finalPoints: number; note: string; diamondMinPoints: number;
}): Promise<{ status: MeetingAwardProposal['status']; finalPoints: number }> {
  if (o.note.trim().split(/\s+/).filter(Boolean).length < 2) throw new MeetingAwardError('note-required');
  const p = o.proposal;
  await call({ action: 'claim', familyId: o.familyId, id: p.id });
  try {
    if (o.decision === 'decline') {
      return await call<{ status: MeetingAwardProposal['status']; finalPoints: number }>({ action: 'finalize', familyId: o.familyId, id: p.id, decision: 'declined', parentNote: o.note });
    }
    const points = Math.max(1, Math.round(o.finalPoints));
    const given = await giveAward(o.familyId, {
      childId: p.childId,
      kind: points >= o.diamondMinPoints ? 'diamond' : 'regular',
      points,
      reason: `${p.reason} · proposed by ${p.proposedByName.split(' ')[0]}`,
      category: 'family-meeting',
      awardedBy: o.me.uid,
      awardedByName: o.me.displayName || 'Parent',
      meetingSlot: p.slot,
    });
    return await call<{ status: MeetingAwardProposal['status']; finalPoints: number }>({
      action: 'finalize', familyId: o.familyId, id: p.id, decision: points === p.points ? 'approved' : 'adjusted', finalPoints: points, awardId: given.id, parentNote: o.note,
    });
  } catch (e) {
    await call({ action: 'release', familyId: o.familyId, id: p.id }).catch(() => {});
    throw e;
  }
}
