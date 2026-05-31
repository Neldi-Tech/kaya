'use client';

// Kaya Games — parent approval queue (client side).
//
// READ is a plain client subscription: gamePlays are family-readable, and a
// single `status == 'pending'` equality filter needs no composite index. The
// WRITE (approve/reject) can't be a client write — gamePlays are write:false
// to stay forge-proof — so it POSTs to /api/games/approve, which runs the
// money math (caps + award + balance bump) under the Admin SDK with a
// verified parent token.

import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { auth, db } from './firebase';
import { isGuestActive } from './mockFamily';
import type { GamePlay } from './games';

const playsCol = (familyId: string) =>
  collection(db, 'families', familyId, 'gamePlays');

/** Live list of plays awaiting a parent's yes/no, newest first. Sort is
 *  client-side so the query stays index-free. */
export function subscribeToPendingGameApprovals(
  familyId: string,
  cb: (plays: GamePlay[]) => void,
): () => void {
  if (isGuestActive() || !familyId) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(playsCol(familyId), where('status', '==', 'pending')),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as GamePlay));
      list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      cb(list);
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[gamesApprovals] subscribe failed:', err);
      cb([]);
    },
  );
}

export interface ResolveResult {
  ok?: boolean;
  status?: string;
  pointsAwarded?: number;
  capped?: boolean;
  newTotal?: number;
  alreadyResolved?: boolean;
  error?: string;
}

async function resolvePlay(
  playId: string,
  action: 'approve' | 'reject',
  note?: string,
): Promise<ResolveResult> {
  const user = auth.currentUser;
  if (!user) return { error: 'not-signed-in' };
  let token: string;
  try { token = await user.getIdToken(); }
  catch { return { error: 'token-failed' }; }
  try {
    const res = await fetch('/api/games/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ playId, action, note: note?.trim() || undefined }),
    });
    return (await res.json()) as ResolveResult;
  } catch (e) {
    return { error: String(e) };
  }
}

/** Approve a pending game → credits HP (clipped by the family's caps). */
export const approveGamePlay = (playId: string, note?: string) =>
  resolvePlay(playId, 'approve', note);

/** Reject a pending game → no HP; an optional note is shown to the kid. */
export const rejectGamePlay = (playId: string, note?: string) =>
  resolvePlay(playId, 'reject', note);
