// The Hive · Phase 1 (ledger-only) data layer.
//
// Three balance layers per kid:
//   L1 House Points (HP)  → already lives on `families/{f}/children/{kidId}.totalPoints`
//   L2 Honey Coins (🍯)   → committed savings, integer
//   L3 Cash ($)            → integer cents (avoids float drift)
//
// All Hive collections live under `families/{familyId}/kids/{kidId}/...`
// (separate sub-tree from the existing `children/{kidId}` doc so the legacy
// gameplay schema stays untouched). The `kidId` here is the same Child id.
//
// Every balance-touching write goes through `runTransaction` so the wallet
// doc and the ledger row always update together. Parent vs kid role is
// enforced in `firestore.rules`; this module trusts the rules and writes
// directly from the client (Spark plan — no Cloud Functions yet).
//
// All transfers + spends route through `approvalRequests` — a parent must
// resolve each one. Per Family.requireApprovalForHpToHoney (default true)
// even HP→Honey conversions wait for parent approval; flip the flag off
// to restore the design's "auto-approved" HP→Honey behaviour.

import {
  collection, doc, getDoc, setDoc, addDoc,
  query, where, orderBy, limit, Timestamp, serverTimestamp,
  onSnapshot, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { isGuestActive } from './mockFamily';

// ── Types ─────────────────────────────────────────────────────────

export type HiveLayer = 'house_points' | 'honey' | 'cash';
export type TxDirection = 'in' | 'out';
export type TxStatus = 'completed' | 'pending_approval' | 'approved' | 'rejected';

export type ApprovalType = 'hp_to_honey' | 'cash_out' | 'spend';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

// Categories used both as the `category` on a HiveTransaction AND as the
// keys of a kid's monthly spending plan. Earning categories (chore, quest,
// award, convert, allowance, gift, business) are also valid TxCategory
// values but never appear in a budget — they're income, not expenses.
//
// 'spend' remains as a generic fallback for legacy / "I'm not sure" entries.
export type TxCategory =
  | 'chore' | 'quest' | 'award' | 'convert' | 'allowance'
  | 'gift'  | 'business'
  | 'spend' | 'shopping' | 'books' | 'treats' | 'donation' | 'savings' | 'other';

// Subset of TxCategory that can appear on a budget line. Keep this list
// lined up with the chips on /hive/cash-out and /hive/plan.
export const PLAN_CATEGORIES: { id: TxCategory; emoji: string; label: string }[] = [
  { id: 'shopping', emoji: '🛒', label: 'Shopping' },
  { id: 'books',    emoji: '📚', label: 'Books' },
  { id: 'treats',   emoji: '🍦', label: 'Treats' },
  { id: 'donation', emoji: '❤️', label: 'Donation' },
  { id: 'savings',  emoji: '🍯', label: 'Savings' },
  { id: 'other',    emoji: '✨', label: 'Other' },
];

export interface HiveConfig {
  hpToHoneyRate: number;            // HP per 1 Honey Coin (default 100)
  honeyToCashRate: number;          // USD per 1 Honey Coin (default 1.00)
  currency: string;                 // ISO-4217-like; default "USD"
  minCashOut: number;               // minimum Honey to allow a cash-out request (default 5)
  spendRequiresApproval: boolean;   // default true
  cashOutRequiresApproval: boolean; // default true
  requireApprovalForHpToHoney: boolean; // default true — see comment in code
  autoAllowance?: {
    enabled: boolean;
    kidId?: string;
    amountCents?: number;
    cadence?: 'weekly' | 'monthly';
    nextRunAt?: Timestamp;
  };
}

export const DEFAULT_HIVE_CONFIG: HiveConfig = {
  hpToHoneyRate: 100,
  honeyToCashRate: 1.0,
  currency: 'USD',
  minCashOut: 5,
  spendRequiresApproval: true,
  cashOutRequiresApproval: true,
  // Per the v2 design, HP→Honey is "auto-approved · no parent confirmation
  // needed" (line 434 of Kaya-Hive_Design-Proposal-v2_2026-05-07.html).
  // Per the user's overriding instruction ("parents to approve transfers"),
  // we default this to true. Families can flip it off in /parent/rates to
  // restore the original instant flow.
  requireApprovalForHpToHoney: true,
};

export interface Wallet {
  // Mirror of the kid's HP from the legacy `children/{id}.totalPoints`. Kept
  // in sync on each successful HP-touching transaction so the Wallet screen
  // doesn't need a second query. If they ever drift, `totalPoints` wins.
  housePoints: number;
  honeyCoins: number;
  cashCents: number;
  totalLifetimeEarnedCents: number;
  totalLifetimeSpentCents: number;
  updatedAt?: Timestamp;
}

export const EMPTY_WALLET: Wallet = {
  housePoints: 0,
  honeyCoins: 0,
  cashCents: 0,
  totalLifetimeEarnedCents: 0,
  totalLifetimeSpentCents: 0,
};

export interface HiveTransaction {
  id: string;
  layer: HiveLayer;
  direction: TxDirection;
  /** HP / Honey are integers; Cash is integer cents. */
  amount: number;
  category: TxCategory;
  description: string;
  status: TxStatus;
  /** Pairs the two halves of a conversion (HP-out + Honey-in share an id). */
  linkedTxId?: string;
  /** Approval request that produced this entry, if any. */
  requestId?: string;
  createdBy: string;     // user uid
  approvedBy?: string;
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

export interface Goal {
  id: string;
  title: string;
  icon: string;          // emoji
  /** Target in the chosen layer's natural unit (Honey integer or Cash cents). */
  targetAmount: number;
  currentAmount: number;
  layer: 'honey' | 'cash';
  status: 'active' | 'completed' | 'abandoned';
  createdAt: Timestamp;
  completedAt?: Timestamp;
}

// ── Monthly spending plan ─────────────────────────────────────────
//
// A kid-set budget for the current calendar month, keyed by category. Total
// is denormalised so the Hive Home can show "$30 planned" without summing
// the map. Lives at families/{f}/kids/{kidId}/monthlyPlans/{YYYY-MM} —
// document id IS the month key so we can read the active month with one
// snapshot listener.
export interface MonthlyPlan {
  monthKey: string;                          // 'YYYY-MM'
  /** Map of category → planned cents. Missing keys = no budget for that category. */
  budget: Partial<Record<TxCategory, number>>;
  totalCents: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** "2026-05" for May 2026. Used as the doc id of the active monthly plan. */
export function currentMonthKey(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Sum a kid's spending in the given month, grouped by category. Pure
 *  function on the existing transaction stream — no extra Firestore read. */
export function spendingByCategoryInMonth(
  transactions: HiveTransaction[],
  monthKey: string,
): Partial<Record<TxCategory, number>> {
  const [yyyy, mm] = monthKey.split('-').map((n) => parseInt(n, 10));
  if (!yyyy || !mm) return {};
  const start = new Date(yyyy, mm - 1, 1).getTime();
  const end = new Date(yyyy, mm, 1).getTime();
  const out: Partial<Record<TxCategory, number>> = {};
  for (const t of transactions) {
    if (t.layer !== 'cash' || t.direction !== 'out') continue;
    const ts = (t.createdAt as any)?.toMillis?.();
    if (typeof ts !== 'number' || ts < start || ts >= end) continue;
    const c = t.category;
    out[c] = (out[c] || 0) + t.amount;
  }
  return out;
}

export interface ApprovalRequest {
  id: string;
  kidId: string;
  type: ApprovalType;
  /** Always populated for any cash-touching request. */
  amountCents?: number;
  /** Honey amount on hp_to_honey + cash_out requests. */
  honeyAmount?: number;
  /** HP amount on hp_to_honey requests. */
  hpAmount?: number;
  description: string;
  category?: TxCategory;
  status: ApprovalStatus;
  rejectionReason?: string;
  resultingTxIds?: string[];
  createdAt: Timestamp;
  createdBy: string;
  resolvedAt?: Timestamp;
  resolvedBy?: string;
}

// ── Path helpers ──────────────────────────────────────────────────

const walletPath = (familyId: string, kidId: string) =>
  doc(db, 'families', familyId, 'kids', kidId, 'wallet', 'balances');

const txCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'hiveTransactions');

const goalCol = (familyId: string, kidId: string) =>
  collection(db, 'families', familyId, 'kids', kidId, 'goals');

const requestCol = (familyId: string) =>
  collection(db, 'families', familyId, 'approvalRequests');

const planRef = (familyId: string, kidId: string, monthKey: string) =>
  doc(db, 'families', familyId, 'kids', kidId, 'monthlyPlans', monthKey);

const childRef = (familyId: string, kidId: string) =>
  doc(db, 'families', familyId, 'children', kidId);

// ── Reads + subscriptions ─────────────────────────────────────────

export async function getWallet(familyId: string, kidId: string): Promise<Wallet | null> {
  if (isGuestActive()) return EMPTY_WALLET;
  const snap = await getDoc(walletPath(familyId, kidId));
  return snap.exists() ? (snap.data() as Wallet) : null;
}

export function subscribeToWallet(
  familyId: string,
  kidId: string,
  cb: (wallet: Wallet | null) => void,
): () => void {
  if (isGuestActive()) {
    cb(EMPTY_WALLET);
    return () => {};
  }
  return onSnapshot(walletPath(familyId, kidId), (snap) => {
    cb(snap.exists() ? (snap.data() as Wallet) : null);
  });
}

export function subscribeToHiveTransactions(
  familyId: string,
  kidId: string,
  cb: (txs: HiveTransaction[]) => void,
  max = 50,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    txCol(familyId, kidId),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as HiveTransaction)));
  });
}

export function subscribeToGoals(
  familyId: string,
  kidId: string,
  cb: (goals: Goal[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(goalCol(familyId, kidId), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as Goal)));
  });
}

/** All pending requests in the family (parent inbox). */
export function subscribeToPendingApprovals(
  familyId: string,
  cb: (requests: ApprovalRequest[]) => void,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('status', '==', 'pending'),
    orderBy('createdAt', 'desc'),
  );
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ApprovalRequest)));
  });
}

/** Just one kid's requests — used for the kid's "your pending" surface. */
export function subscribeToKidRequests(
  familyId: string,
  kidId: string,
  cb: (requests: ApprovalRequest[]) => void,
  max = 20,
): () => void {
  if (isGuestActive()) {
    cb([]);
    return () => {};
  }
  const q = query(
    requestCol(familyId),
    where('kidId', '==', kidId),
    orderBy('createdAt', 'desc'),
    limit(max),
  );
  return onSnapshot(q, (s) => {
    cb(s.docs.map((d) => ({ id: d.id, ...d.data() } as ApprovalRequest)));
  });
}

// ── Monthly plan ──────────────────────────────────────────────────

export function subscribeToMonthlyPlan(
  familyId: string,
  kidId: string,
  monthKey: string,
  cb: (plan: MonthlyPlan | null) => void,
): () => void {
  if (isGuestActive()) {
    cb(null);
    return () => {};
  }
  return onSnapshot(planRef(familyId, kidId, monthKey), (snap) => {
    cb(snap.exists() ? ({ ...(snap.data() as MonthlyPlan), monthKey }) : null);
  });
}

/** Save a kid's plan for a given month. Idempotent — re-saving the same
 *  month overwrites. Total is recomputed from the budget map. */
export async function saveMonthlyPlan(
  familyId: string,
  kidId: string,
  monthKey: string,
  budget: Partial<Record<TxCategory, number>>,
): Promise<void> {
  if (isGuestActive()) return;
  // Drop zero / negative entries so the doc stays clean.
  const cleaned: Partial<Record<TxCategory, number>> = {};
  let total = 0;
  for (const [k, v] of Object.entries(budget)) {
    if (typeof v === 'number' && v > 0) {
      cleaned[k as TxCategory] = Math.round(v);
      total += Math.round(v);
    }
  }
  await setDoc(
    planRef(familyId, kidId, monthKey),
    {
      monthKey,
      budget: cleaned,
      totalCents: total,
      updatedAt: serverTimestamp(),
      // Set createdAt only if absent — Firestore preserves the existing
      // value when merge:true and the field is omitted on update.
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );
}

// ── Wallet bootstrap ──────────────────────────────────────────────

/** Idempotent: ensures a wallet doc exists for the kid, mirroring HP from
 *  the legacy `children/{id}.totalPoints` on first creation. */
export async function ensureWallet(
  familyId: string,
  kidId: string,
  initialHousePoints = 0,
): Promise<void> {
  if (isGuestActive()) return;
  const ref = walletPath(familyId, kidId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists()) return;
    const seed: Wallet = { ...EMPTY_WALLET, housePoints: initialHousePoints };
    tx.set(ref, { ...seed, updatedAt: serverTimestamp() });
  });
}

// ── Hive config helpers ───────────────────────────────────────────

export function readHiveConfig(family: { hiveConfig?: Partial<HiveConfig> } | null): HiveConfig {
  return { ...DEFAULT_HIVE_CONFIG, ...(family?.hiveConfig || {}) };
}

// ── Approval request creation (kid-side) ──────────────────────────

/** Create a HP→Honey request. The actual balance move happens on parent
 *  approval. Returns the new request id. */
export async function requestHpToHoney(
  familyId: string,
  kidId: string,
  hpAmount: number,
  cfg: HiveConfig,
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(hpAmount) || hpAmount <= 0) throw new Error('Pick a positive HP amount.');
  const honeyAmount = Math.floor(hpAmount / cfg.hpToHoneyRate);
  if (honeyAmount <= 0) throw new Error(`You need at least ${cfg.hpToHoneyRate} HP to make 1 🍯.`);

  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'hp_to_honey' as ApprovalType,
    hpAmount,
    honeyAmount,
    description: `Convert ${hpAmount} HP → ${honeyAmount} 🍯`,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

export async function requestCashOut(
  familyId: string,
  kidId: string,
  honeyAmount: number,
  cfg: HiveConfig,
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(honeyAmount) || honeyAmount <= 0) throw new Error('Pick a positive 🍯 amount.');
  if (honeyAmount < cfg.minCashOut) throw new Error(`Cash-out minimum is ${cfg.minCashOut} 🍯.`);
  const amountCents = Math.round(honeyAmount * cfg.honeyToCashRate * 100);

  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'cash_out' as ApprovalType,
    honeyAmount,
    amountCents,
    description: `Cash out ${honeyAmount} 🍯 → $${(amountCents / 100).toFixed(2)}`,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

export async function requestSpend(
  familyId: string,
  kidId: string,
  amountCents: number,
  description: string,
  category: TxCategory,
  createdBy: string,
): Promise<string> {
  if (isGuestActive()) return 'guest-request';
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Pick a positive amount.');
  if (!description.trim()) throw new Error('Tell us what the money is for.');

  const ref = await addDoc(requestCol(familyId), {
    kidId,
    type: 'spend' as ApprovalType,
    amountCents,
    description: description.trim(),
    category,
    status: 'pending' as ApprovalStatus,
    createdAt: serverTimestamp(),
    createdBy,
  });
  return ref.id;
}

/** Kid cancels their own still-pending request. */
export async function cancelOwnRequest(
  familyId: string,
  requestId: string,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(requestCol(familyId), requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = reqSnap.data() as ApprovalRequest;
    if (req.status !== 'pending') throw new Error('Request is no longer pending.');
    if (req.createdBy !== uid) throw new Error('Only the requester can cancel.');
    tx.update(reqRef, {
      status: 'rejected' as ApprovalStatus,
      rejectionReason: 'Cancelled by requester',
      resolvedAt: serverTimestamp(),
      resolvedBy: uid,
    });
  });
}

// ── Approval resolution (parent-side) ─────────────────────────────

/**
 * Atomically approve or reject a request. On approval the wallet doc + the
 * matching `hiveTransactions` entries + (for HP-touching requests) the
 * legacy `children/{id}.totalPoints` are all updated in one transaction.
 *
 * `approverUid` must belong to a parent in `familyId` — the rules also
 * enforce this server-side, but we fail fast here for a better error.
 */
export async function resolveApprovalRequest(
  familyId: string,
  requestId: string,
  decision: 'approved' | 'rejected',
  approverUid: string,
  rejectionReason?: string,
): Promise<void> {
  if (isGuestActive()) return;
  await runTransaction(db, async (tx) => {
    const reqRef = doc(requestCol(familyId), requestId);
    const reqSnap = await tx.get(reqRef);
    if (!reqSnap.exists()) throw new Error('Request not found.');
    const req = { id: reqSnap.id, ...reqSnap.data() } as ApprovalRequest;
    if (req.status !== 'pending') throw new Error('Request already resolved.');

    if (decision === 'rejected') {
      tx.update(reqRef, {
        status: 'rejected' as ApprovalStatus,
        rejectionReason: rejectionReason || '',
        resolvedAt: serverTimestamp(),
        resolvedBy: approverUid,
      });
      return;
    }

    // ── Approval branches per request type ────────────────────────
    const wRef = walletPath(familyId, req.kidId);
    const wSnap = await tx.get(wRef);
    if (!wSnap.exists()) throw new Error('Wallet not initialised for this kid.');
    const wallet = wSnap.data() as Wallet;

    if (req.type === 'hp_to_honey') {
      const hp = req.hpAmount ?? 0;
      const honey = req.honeyAmount ?? 0;
      const cRef = childRef(familyId, req.kidId);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists()) throw new Error('Child not found.');
      const child = cSnap.data() as { totalPoints?: number };
      if ((child.totalPoints ?? 0) < hp) throw new Error('Not enough House Points.');

      // Two paired ledger entries — same linkedTxId so we can pivot on a
      // conversion in the activity feed.
      const link = doc(txCol(familyId, req.kidId)).id;
      const outRef = doc(txCol(familyId, req.kidId), `${link}-out`);
      const inRef = doc(txCol(familyId, req.kidId), `${link}-in`);
      const now = serverTimestamp();

      tx.update(cRef, { totalPoints: (child.totalPoints ?? 0) - hp });
      tx.set(wRef, {
        ...wallet,
        housePoints: Math.max(0, wallet.housePoints - hp),
        honeyCoins: wallet.honeyCoins + honey,
        updatedAt: now,
      });
      tx.set(outRef, {
        layer: 'house_points', direction: 'out', amount: hp, category: 'convert',
        description: `Saved ${hp} HP → ${honey} 🍯`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.set(inRef, {
        layer: 'honey', direction: 'in', amount: honey, category: 'convert',
        description: `From ${hp} HP`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds: [`${link}-out`, `${link}-in`],
      });
    } else if (req.type === 'cash_out') {
      const honey = req.honeyAmount ?? 0;
      const cents = req.amountCents ?? 0;
      if (wallet.honeyCoins < honey) throw new Error('Not enough Honey Coins.');

      const link = doc(txCol(familyId, req.kidId)).id;
      const outRef = doc(txCol(familyId, req.kidId), `${link}-out`);
      const inRef = doc(txCol(familyId, req.kidId), `${link}-in`);
      const now = serverTimestamp();

      tx.set(wRef, {
        ...wallet,
        honeyCoins: wallet.honeyCoins - honey,
        cashCents: wallet.cashCents + cents,
        totalLifetimeEarnedCents: wallet.totalLifetimeEarnedCents + cents,
        updatedAt: now,
      });
      tx.set(outRef, {
        layer: 'honey', direction: 'out', amount: honey, category: 'convert',
        description: `Cashed out ${honey} 🍯`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.set(inRef, {
        layer: 'cash', direction: 'in', amount: cents, category: 'convert',
        description: `From ${honey} 🍯`,
        status: 'completed', linkedTxId: link, requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds: [`${link}-out`, `${link}-in`],
      });
    } else if (req.type === 'spend') {
      const cents = req.amountCents ?? 0;
      if (wallet.cashCents < cents) throw new Error('Not enough Cash to cover the spend.');

      const txRef = doc(txCol(familyId, req.kidId));
      const now = serverTimestamp();

      tx.set(wRef, {
        ...wallet,
        cashCents: wallet.cashCents - cents,
        totalLifetimeSpentCents: wallet.totalLifetimeSpentCents + cents,
        updatedAt: now,
      });
      tx.set(txRef, {
        layer: 'cash', direction: 'out', amount: cents,
        category: req.category || 'spend',
        description: req.description,
        status: 'completed', requestId,
        createdBy: req.createdBy, approvedBy: approverUid,
        createdAt: now, completedAt: now,
      });
      tx.update(reqRef, {
        status: 'approved' as ApprovalStatus,
        resolvedAt: now,
        resolvedBy: approverUid,
        resultingTxIds: [txRef.id],
      });
    } else {
      throw new Error(`Unknown approval type: ${(req as any).type}`);
    }
  });
}

// ── Direct cash deposit (parent-only) ─────────────────────────────

/** Allowance / gift / business income deposit, no approval needed because
 *  the parent IS the approver. Rules block kids from calling this. */
export async function depositCash(
  familyId: string,
  kidId: string,
  amountCents: number,
  category: 'allowance' | 'gift' | 'business' | 'other',
  description: string,
  uid: string,
): Promise<void> {
  if (isGuestActive()) return;
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Amount must be positive cents.');
  await runTransaction(db, async (txn) => {
    const wRef = walletPath(familyId, kidId);
    const wSnap = await txn.get(wRef);
    const wallet = (wSnap.exists() ? wSnap.data() : EMPTY_WALLET) as Wallet;
    const txRef = doc(txCol(familyId, kidId));
    const now = serverTimestamp();
    txn.set(wRef, {
      ...wallet,
      cashCents: wallet.cashCents + amountCents,
      totalLifetimeEarnedCents: wallet.totalLifetimeEarnedCents + amountCents,
      updatedAt: now,
    });
    txn.set(txRef, {
      layer: 'cash', direction: 'in', amount: amountCents, category,
      description: description.trim() || category, status: 'completed',
      createdBy: uid, approvedBy: uid,
      createdAt: now, completedAt: now,
    });
  });
}

// ── Goals ─────────────────────────────────────────────────────────

export async function addGoal(
  familyId: string,
  kidId: string,
  goal: Omit<Goal, 'id' | 'createdAt' | 'currentAmount' | 'status'>,
): Promise<string> {
  if (isGuestActive()) return 'guest-goal';
  const ref = await addDoc(goalCol(familyId, kidId), {
    ...goal,
    currentAmount: 0,
    status: 'active' as Goal['status'],
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

// ── Family-level config writes (parent-only) ──────────────────────

export async function setHiveConfig(
  familyId: string,
  patch: Partial<HiveConfig>,
): Promise<void> {
  if (isGuestActive()) return;
  // The Family doc may not have hiveConfig yet; merge into a sub-field.
  await setDoc(
    doc(db, 'families', familyId),
    { hiveConfig: patch } as any,
    { merge: true },
  );
}
