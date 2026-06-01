// Kaya Wealth · Bank Accounts vault — client data layer (PR5 · 2026-06-01).
//
// The masked list is read directly (owner-only rule); every mutation +
// reveal goes through the Admin-SDK step-up routes with a fresh 2FA code.

'use client';

import { collection, onSnapshot } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';

export type BankAccountType = 'operating' | 'savings' | 'fx' | 'other';

export interface BankAccountMasked {
  id: string;
  bankName: string;
  type: BankAccountType;
  currency: string;
  balanceCents: number | null;
  tail: string;
}

export const BANK_TYPE_LABEL: Record<BankAccountType, string> = {
  operating: 'Operating', savings: 'Savings', fx: 'FX', other: 'Other',
};

export function subscribeBankAccounts(uid: string, cb: (a: BankAccountMasked[]) => void): () => void {
  return onSnapshot(
    collection(db, 'users', uid, 'bankAccounts'),
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BankAccountMasked, 'id'>) }));
      list.sort((a, b) => a.bankName.localeCompare(b.bankName));
      cb(list);
    },
    () => cb([]),
  );
}

interface BankResp { ok?: boolean; error?: string; number?: string; acctId?: string }

async function post(path: string, body: object): Promise<BankResp> {
  const u = auth.currentUser;
  const token = u ? await u.getIdToken() : '';
  try {
    const res = await fetch(path, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as BankResp;
  } catch {
    return { ok: false, error: 'network' };
  }
}

export function addBank(input: {
  code: string; bankName: string; type: BankAccountType; currency: string; balanceCents?: number | null; fullNumber: string;
}): Promise<BankResp> {
  return post('/api/wealth/bank/add', input);
}
export function revealBank(acctId: string, code: string): Promise<BankResp> {
  return post('/api/wealth/bank/reveal', { acctId, code });
}
export function deleteBank(acctId: string, code: string): Promise<BankResp> {
  return post('/api/wealth/bank/delete', { acctId, code });
}
