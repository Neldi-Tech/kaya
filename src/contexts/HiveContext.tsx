'use client';

// HiveContext — real-time wallet, transactions and pending requests for a
// single "active kid" view. A parent sees the kid currently picked in the
// dashboard; a kid sees their own. The provider also exposes derived
// values (total net worth, save rate, weekly earnings) memoised so the
// Wallet / Insights screens don't re-compute on every render.

import {
  createContext, useContext, useEffect, useMemo, useState, ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { useFamily } from './FamilyContext';
import {
  Wallet, HiveTransaction, ApprovalRequest, Goal, HiveConfig, MonthlyPlan,
  EMPTY_WALLET, readHiveConfig, currentMonthKey, spendingByCategoryInMonth,
  subscribeToWallet, subscribeToHiveTransactions,
  subscribeToKidRequests, subscribeToPendingApprovals,
  subscribeToGoals, subscribeToMonthlyPlan,
} from '@/lib/hive';

interface HiveContextType {
  /** The kid this context is currently focused on. Null if none picked. */
  activeKidId: string | null;
  setActiveKidId: (id: string | null) => void;

  config: HiveConfig;

  wallet: Wallet;
  transactions: HiveTransaction[];
  goals: Goal[];

  /** Requests for the active kid only (kid-side view). */
  myRequests: ApprovalRequest[];
  /** All pending requests in the family (parent inbox). Empty for kid users. */
  pendingApprovals: ApprovalRequest[];

  /** Derived: total worth in cents (HP and Honey converted at current rates). */
  totalNetWorthCents: number;
  /** Derived: % saved this calendar month (in / (in + out)). */
  saveRate: number | null;
  /** Derived: cents earned in the last 7 days. */
  weeklyEarningsCents: number;

  /** This calendar month's spending plan, or null if the kid hasn't set one. */
  monthlyPlan: MonthlyPlan | null;
  /** Convenience: current YYYY-MM key. Re-rendered with the active month. */
  monthKey: string;
  /** Per-category spending in the current month, derived from `transactions`. */
  monthSpending: Partial<Record<string, number>>;

  loading: boolean;
}

const HiveContext = createContext<HiveContextType | null>(null);

export function HiveProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const { family, children: kids } = useFamily();

  // Pick a default active kid:
  //   - kid user → their own childId
  //   - parent/helper → the first kid in the family (the kid switcher in the
  //     UI calls setActiveKidId() to swap)
  const [activeKidId, setActiveKidId] = useState<string | null>(null);
  useEffect(() => {
    if (activeKidId) return;
    if (profile?.role === 'kid' && profile.childId) {
      setActiveKidId(profile.childId);
      return;
    }
    if (kids.length > 0) setActiveKidId(kids[0].id);
  }, [profile?.role, profile?.childId, kids, activeKidId]);

  const config = useMemo(() => readHiveConfig(family), [family]);

  const [wallet, setWallet] = useState<Wallet>(EMPTY_WALLET);
  const [transactions, setTransactions] = useState<HiveTransaction[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [myRequests, setMyRequests] = useState<ApprovalRequest[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalRequest[]>([]);
  const [monthlyPlan, setMonthlyPlan] = useState<MonthlyPlan | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  // Recompute the month key once a minute so the month rolls over without
  // a page reload near midnight on the first of the month.
  const [monthKey, setMonthKey] = useState(currentMonthKey());
  useEffect(() => {
    const id = setInterval(() => setMonthKey(currentMonthKey()), 60_000);
    return () => clearInterval(id);
  }, []);

  const familyId = profile?.familyId;

  // Wallet + transactions + goals + this-kid requests subscriptions.
  useEffect(() => {
    if (!familyId || !activeKidId) {
      setWallet(EMPTY_WALLET);
      setTransactions([]);
      setGoals([]);
      setMyRequests([]);
      setWalletLoading(false);
      return;
    }
    setWalletLoading(true);
    const unsubs: Array<() => void> = [];
    unsubs.push(subscribeToWallet(familyId, activeKidId, (w) => {
      setWallet(w || EMPTY_WALLET);
      setWalletLoading(false);
    }));
    unsubs.push(subscribeToHiveTransactions(familyId, activeKidId, setTransactions));
    unsubs.push(subscribeToGoals(familyId, activeKidId, setGoals));
    unsubs.push(subscribeToKidRequests(familyId, activeKidId, setMyRequests));
    unsubs.push(subscribeToMonthlyPlan(familyId, activeKidId, monthKey, setMonthlyPlan));
    return () => { unsubs.forEach((u) => u()); };
  }, [familyId, activeKidId, monthKey]);

  // Parent-only inbox subscription.
  useEffect(() => {
    if (!familyId || profile?.role !== 'parent') {
      setPendingApprovals([]);
      return;
    }
    return subscribeToPendingApprovals(familyId, setPendingApprovals);
  }, [familyId, profile?.role]);

  // ── Derived values ──────────────────────────────────────────────
  const totalNetWorthCents = useMemo(() => {
    // HP → Cash via the two configured rates. Honey → Cash via Lever B.
    // We always convert through Honey to keep the single source of truth.
    const hpAsHoney = config.hpToHoneyRate > 0 ? wallet.housePoints / config.hpToHoneyRate : 0;
    const honeyAsCash = (wallet.honeyCoins + hpAsHoney) * config.honeyToCashRate * 100;
    return Math.round(honeyAsCash + wallet.cashCents);
  }, [wallet, config]);

  const saveRate = useMemo(() => {
    if (transactions.length === 0) return null;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    let inCents = 0;
    let outCents = 0;
    for (const t of transactions) {
      if (t.layer !== 'cash') continue;
      const ts = (t.createdAt as any)?.toMillis?.();
      if (typeof ts !== 'number' || ts < monthStart) continue;
      if (t.direction === 'in') inCents += t.amount;
      else outCents += t.amount;
    }
    const total = inCents + outCents;
    if (total === 0) return null;
    return Math.round((inCents / total) * 100);
  }, [transactions]);

  const monthSpending = useMemo(
    () => spendingByCategoryInMonth(transactions, monthKey),
    [transactions, monthKey],
  );

  const weeklyEarningsCents = useMemo(() => {
    const cutoff = Date.now() - 7 * 86_400_000;
    let earned = 0;
    for (const t of transactions) {
      if (t.layer !== 'cash' || t.direction !== 'in') continue;
      const ts = (t.createdAt as any)?.toMillis?.();
      if (typeof ts !== 'number' || ts < cutoff) continue;
      earned += t.amount;
    }
    return earned;
  }, [transactions]);

  return (
    <HiveContext.Provider
      value={{
        activeKidId, setActiveKidId,
        config, wallet, transactions, goals,
        myRequests, pendingApprovals,
        totalNetWorthCents, saveRate, weeklyEarningsCents,
        monthlyPlan, monthKey, monthSpending,
        loading: walletLoading,
      }}
    >
      {children}
    </HiveContext.Provider>
  );
}

export function useHive() {
  const ctx = useContext(HiveContext);
  if (!ctx) throw new Error('useHive must be used within HiveProvider');
  return ctx;
}
