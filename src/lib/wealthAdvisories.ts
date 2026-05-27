// Household → Wealth advisories.
//
// Generated server-side by /api/cron/wealth-advisor. Parents READ from
// the client; the only client-write is the "dismiss" action which the
// Firestore rule allows (P1 restricted it to the action fields only).
// `confirmRedirection` cancels source subs + creates a stub investment
// via /api/redirection/confirm.

import {
  collection, doc, updateDoc, getDocs, query, where, orderBy, limit as qlimit,
  Timestamp, onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

export type WealthAdvisoryType =
  | 'unused_subscription'
  | 'tithe_health'
  | 'spend_anomaly'
  | 'redirection_opportunity';

export type WealthAdvisoryStatus = 'open' | 'dismissed' | 'acted' | 'expired';

export interface WealthAdvisory {
  id: string;
  type: WealthAdvisoryType;
  title: string;
  body: string;
  detectedAt: Timestamp;

  // For redirection_opportunity
  candidateSubIds: string[];
  potentialAnnualSaving: number;        // cents in household currency
  suggestedDestination: 'index_fund' | 'savings' | 'custom';

  status: WealthAdvisoryStatus;
  actedAt: Timestamp | null;
  actedBy: string | null;
  resultingInvestmentId: string | null;
  expiresAt: Timestamp;
}

const advisoriesCol = (familyId: string) =>
  collection(db, 'families', familyId, 'wealth_advisories');

/** Subscribe to open advisories for the family, newest first. Uses the
 *  (status ASC, detectedAt DESC) composite index from P1. */
export function subscribeToOpenAdvisories(
  familyId: string,
  cb: (advisories: WealthAdvisory[]) => void,
  opts: { maxEntries?: number } = {},
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    advisoriesCol(familyId),
    where('status', '==', 'open'),
    orderBy('detectedAt', 'desc'),
    qlimit(opts.maxEntries ?? 20),
  );
  return onSnapshot(
    q,
    (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() } as WealthAdvisory)));
    },
    (err) => {
      // eslint-disable-next-line no-console
      console.error('[wealthAdvisories] subscribe failed:', err);
      cb([]);
    },
  );
}

/** Filter helper: advisories that mention the given sub id (so the
 *  Sub Detail page can render only the ones relevant to it). */
export function advisoriesForSub(advisories: WealthAdvisory[], subId: string): WealthAdvisory[] {
  return advisories.filter((a) => a.candidateSubIds.includes(subId));
}

/** Dismiss an advisory — the Firestore rule from P1 allows updating
 *  only the [status, actedAt, actedBy, resultingInvestmentId] fields. */
export async function dismissAdvisory(
  familyId: string,
  advisoryId: string,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  await updateDoc(doc(advisoriesCol(familyId), advisoryId), {
    status: 'dismissed',
    actedAt: Timestamp.now(),
    actedBy: uid,
  });
}

/** Read-only enumeration for the dashboard widget. */
export async function listOpenAdvisories(familyId: string): Promise<WealthAdvisory[]> {
  if (isGuestActive()) return [];
  const snap = await getDocs(query(advisoriesCol(familyId), where('status', '==', 'open')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WealthAdvisory));
}

// ── Confirm redirection (client → API) ───────────────────────────────
//
// Cancels source subs, creates a stub investment doc in
// /families/{f}/investments/{id}, marks the advisory acted. Server
// route runs it all in a transaction so the cancellation and the
// investment write are atomic — the user never sees "subs cancelled
// but no investment recorded" or vice versa.

export interface ConfirmRedirectionInput {
  familyId: string;
  advisoryId: string;
  destinationType: 'index_fund' | 'savings' | 'custom';
  destinationLabel?: string;
  monthlyContributionCents: number;
  cancelSubIds: string[];
  confirmedByUid: string;
}

export async function confirmRedirection(
  input: ConfirmRedirectionInput,
): Promise<{ ok: true; investmentId: string }> {
  if (isGuestActive()) return { ok: true, investmentId: 'guest-inv' };
  const res = await fetch('/api/redirection/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`confirmRedirection failed: ${res.status} ${text}`);
  }
  return res.json();
}
