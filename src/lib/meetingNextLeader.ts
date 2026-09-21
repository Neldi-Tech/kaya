// 🎡 Client for the next-leader gateway (/api/meetings/next-leader).
// Picks + wheel spins save server-side so they work from a kid's login
// too — the family doc is parents-only in Firestore rules.

import { auth as fbAuth } from '@/lib/firebase';

export interface NextLeaderSaved {
  id: string;
  name: string;
  emoji: string;
  kind: 'parent' | 'kid' | 'helper';
  pickedBy: string;
  pickedByName?: string;
  pickedAt: number;
  via?: 'wheel' | 'pick';
}

export class NextLeaderError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}

/** Plain-words message for every failure — never a raw Firebase string. */
export function nextLeaderErrorText(code: string): string {
  switch (code) {
    case 'already-spun': return 'The wheel has already been spun tonight — a parent can change the pick from their own phone.';
    case 'kids-use-wheel': return 'Kids use the wheel — it\'s the fair way. Tap 🎡 Spin the Wheel.';
    case 'not-in-family': return 'That person isn\'t in this family any more — refresh and try again.';
    case 'empty-pool': return 'Nobody is in the wheel yet.';
    case 'unauthenticated': case 'invalid-token': return 'Please sign in again, then spin once more.';
    case 'admin-not-configured': return 'Saving isn\'t available on this preview — it works on the live app.';
    case 'offline': return 'No connection — check the internet and try again.';
    default: return 'Could not save the pick — please try again.';
  }
}

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  let token: string | undefined;
  try { token = await fbAuth.currentUser?.getIdToken(); } catch { /* handled below */ }
  if (!token) throw new NextLeaderError('unauthenticated');
  let res: Response;
  try {
    res = await fetch('/api/meetings/next-leader', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
  } catch { throw new NextLeaderError('offline'); }
  const json = await res.json().catch(() => ({})) as { ok?: boolean; error?: string } & T;
  if (!res.ok || !json.ok) throw new NextLeaderError(json.error || 'failed');
  return json;
}

/** A parent taps a name chip. */
export const pickNextLeader = (familyId: string, date: string, memberId: string) =>
  call<{ leader: NextLeaderSaved }>({ action: 'pick', familyId, date, memberId });

/** Anyone spins — the SERVER draws the winner; the wheel animates to it. */
export const spinNextLeader = (familyId: string, date: string, poolIds: string[], tonightLeaderId: string | null) =>
  call<{ leader: NextLeaderSaved; eligibleIds: string[]; sitOutIds: string[] }>({
    action: 'spin', familyId, date, poolIds, ...(tonightLeaderId ? { tonightLeaderId } : {}),
  });
