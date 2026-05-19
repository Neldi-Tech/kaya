'use client';

// /pantry/budget — Household → Per-module Budget (v2, 2026-05-19).
//
// Five module caps + their rolling current-month spend, derived from
// every CLOSED PurchaseRequest. Each card edits its own cap independently
// and writes to `family.householdBudgets[module]`. Totals roll into
// Household Finances (sums all caps + all spend).
//
// v1 only rendered Pantry; the others were placeholders until each
// module shipped. Now that all 5 are live (PR #80 finished Payroll),
// expose them all here per Elia's 2026-05-19 budget pass.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, type PurchaseModule, subscribeToRecentRequests,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';

const monthKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// Per-module visual + label config. Tints follow the rest of the app:
// leaf for Pantry + Outdoor, honey for Utility, blue for Drivers, purple
// for Payroll. Over-budget swaps to a rose tint for every module so the
// danger signal is consistent.
const MODULE_CARDS: {
  id: PurchaseModule;
  emoji: string;
  label: string;
  tint: string;
  border: string;
  eyebrow: string;
}[] = [
  { id: 'pantry',  emoji: '🛒', label: 'Pantry',   tint: 'bg-pantry-leaf-soft', border: 'border-pantry-leaf',           eyebrow: 'text-pantry-leaf-dk' },
  { id: 'outdoor', emoji: '🌿', label: 'Outdoor',  tint: 'bg-[#E6F2EC]',         border: 'border-pantry-leaf',           eyebrow: 'text-pantry-leaf-dk' },
  { id: 'drivers', emoji: '🚗', label: 'Drivers',  tint: 'bg-[#E5EFF8]',         border: 'border-[#B5CFE5]',             eyebrow: 'text-hive-blue'      },
  { id: 'utility', emoji: '⚡', label: 'Utility',  tint: 'bg-[#FFF3D9]',         border: 'border-hive-honey',            eyebrow: 'text-hive-honey-dk'  },
  { id: 'payroll', emoji: '🤝', label: 'Payroll',  tint: 'bg-[#F4EFFB]',         border: 'border-[#C9B8E5]',             eyebrow: 'text-[#5E4A8F]'      },
];

export default function BudgetPage() {
  const router = useRouter();
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  // Budget is parent-only (household money policy). Helpers shouldn't see
  // spend totals OR the cap. Bounce them back to the Pantry home, and
  // render a polite blocker below for the brief moment between role
  // detection and the redirect firing.
  useEffect(() => {
    if (!profile) return;
    if (profile.role !== 'parent') router.replace('/pantry');
  }, [profile, router]);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    if (profile.role !== 'parent') return; // don't subscribe for non-parents
    return subscribeToRecentRequests(profile.familyId, setRecent);
  }, [profile?.familyId, profile?.role]);

  // Which module's cap editor is open (null = none).
  const [editingModule, setEditingModule] = useState<PurchaseModule | null>(null);
  const [draftCap, setDraftCap] = useState('');
  const [saving, setSaving] = useState(false);

  if (profile && profile.role !== 'parent') {
    return (
      <div className="mx-auto max-w-md w-full px-4 pt-16 text-center">
        <div className="text-3xl mb-2">🔒</div>
        <h2 className="font-nunito font-black text-lg">Budget is parent-only</h2>
        <p className="text-hive-muted text-sm mt-2 mb-4">
          Household budgets are visible to parents in the family. Ask a parent to share what's relevant.
        </p>
        <Link href="/pantry" className="text-pantry-leaf-dk font-nunito font-bold text-sm underline">
          ← Back to Pantry
        </Link>
      </div>
    );
  }

  // Only count CLOSED requests in the current month — rejected requests
  // don't move money, and prior months belong to history.
  const thisMonth = monthKey();
  const closedThisMonth = useMemo(
    () => recent.filter((r) => {
      if (r.status !== 'closed') return false;
      const at = r.closedAt?.toDate?.();
      return at && monthKey(at) === thisMonth;
    }),
    [recent, thisMonth],
  );

  // Spent per module — sum of actualTotalCents (fallback to estimated
  // when actual is missing). Module field defaults to 'pantry' for back-
  // compat with very old docs created before the module discriminator.
  const spentByModule = useMemo(() => {
    const acc: Record<PurchaseModule, number> = {
      pantry: 0, outdoor: 0, drivers: 0, utility: 0, payroll: 0,
    };
    for (const r of closedThisMonth) {
      const m = (r.module ?? 'pantry') as PurchaseModule;
      acc[m] += r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
    }
    return acc;
  }, [closedThisMonth]);

  // Caps map — read from family.householdBudgets, missing keys = 0.
  const caps: Record<PurchaseModule, number> = {
    pantry:  family?.householdBudgets?.pantry  ?? 0,
    outdoor: family?.householdBudgets?.outdoor ?? 0,
    drivers: family?.householdBudgets?.drivers ?? 0,
    utility: family?.householdBudgets?.utility ?? 0,
    payroll: family?.householdBudgets?.payroll ?? 0,
  };

  const startEdit = (m: PurchaseModule) => {
    const cap = caps[m];
    setDraftCap(cap > 0 ? (cap / 100).toFixed(2) : '');
    setEditingModule(m);
  };
  const saveCap = async () => {
    if (!profile?.familyId || isGuest || !editingModule) { setEditingModule(null); return; }
    setSaving(true);
    try {
      const cents = draftCap === '' ? 0 : Math.round(parseFloat(draftCap) * 100);
      // Dot-path update so we only write the one module's cap.
      await updateDoc(doc(db, 'families', profile.familyId), {
        [`householdBudgets.${editingModule}`]: cents,
      });
      setEditingModule(null);
    } finally { setSaving(false); }
  };

  // Roll-up totals for the header strip.
  const totalSpent = MODULE_CARDS.reduce((sum, m) => sum + spentByModule[m.id], 0);
  const totalCap = MODULE_CARDS.reduce((sum, m) => sum + caps[m.id], 0);

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8 pb-32">
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Household · Budget
        </p>
        <h1 className="font-nunito font-black text-2xl lg:text-[34px] tracking-tight mt-0.5">
          {monthLabel()}
        </h1>
        <p className="text-hive-muted text-sm mt-1">
          Per-module caps roll into Household Finances. Set a cap per module — the spend bar tracks the current month's closed shops.
        </p>
      </div>

      {/* Roll-up strip — only when at least one cap is set. Helps the
          parent see the household's monthly money posture at a glance. */}
      {totalCap > 0 && (
        <div className="mt-4 bg-hive-paper border border-hive-line rounded-hive p-3 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-hive-muted">All modules · this month</p>
            <p className="font-nunito font-black text-lg text-hive-ink mt-0.5">
              {formatCents(totalSpent, currency)}
              <span className="text-hive-muted text-xs font-bold">
                {' '}of {formatCents(totalCap, currency)}
              </span>
            </p>
          </div>
          <div className={`text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] px-2.5 py-1 rounded-full ${
            totalSpent > totalCap ? 'bg-[#FCEAEA] text-hive-rose' : 'bg-pantry-leaf-soft text-pantry-leaf-dk'
          }`}>
            {totalCap > 0 ? Math.round((totalSpent / totalCap) * 100) : 0}%
          </div>
        </div>
      )}

      {/* Per-module cards */}
      <div className="mt-4 flex flex-col gap-3">
        {MODULE_CARDS.map((m) => {
          const cap = caps[m.id];
          const spent = spentByModule[m.id];
          const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
          const over = cap > 0 && spent > cap;
          const isEditing = editingModule === m.id;
          return (
            <div
              key={m.id}
              className={`rounded-hive border p-4 ${over ? 'bg-[#FCEAEA] border-[#E8B5B5]' : `${m.tint} ${m.border}`}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className={`text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] ${over ? 'text-hive-rose' : m.eyebrow}`}>
                    {m.emoji} {m.label}
                  </p>
                  <p className="font-nunito font-black text-xl lg:text-2xl text-hive-ink mt-1">
                    {formatCents(spent, currency)}
                    <span className="text-hive-muted text-sm font-bold">
                      {' '}of {cap > 0 ? formatCents(cap, currency) : '—'}
                    </span>
                  </p>
                </div>
                {isParent && !isEditing && (
                  <button
                    onClick={() => startEdit(m.id)}
                    className="text-xs font-nunito font-bold text-pantry-leaf-dk bg-white border border-hive-line rounded-full px-3 py-1.5 flex-shrink-0"
                  >
                    {cap > 0 ? 'Edit cap' : 'Set cap'}
                  </button>
                )}
              </div>

              {/* Progress bar — only meaningful when a cap is set. */}
              {cap > 0 && (
                <div className="mt-3 h-2 bg-white/70 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${over ? 'bg-hive-rose' : 'bg-pantry-leaf-dk'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}

              {/* Inline cap editor — one card opens at a time. */}
              {isParent && isEditing && (
                <div className="mt-3 bg-white border border-hive-line rounded-xl p-3">
                  <label className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">
                    Monthly cap for {m.label} ({currency})
                  </label>
                  <input
                    autoFocus
                    type="number"
                    step="0.01"
                    min={0}
                    value={draftCap}
                    onChange={(e) => setDraftCap(e.target.value)}
                    placeholder="e.g. 500"
                    className="w-full border border-hive-line rounded-lg px-3 py-2 text-sm font-nunito font-bold mt-1"
                  />
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button
                      onClick={() => setEditingModule(null)}
                      className="border border-hive-line rounded-lg py-2 font-nunito font-bold text-sm"
                    >Cancel</button>
                    <button
                      onClick={saveCap}
                      disabled={saving}
                      className="bg-pantry-leaf text-white rounded-lg py-2 font-nunito font-black text-sm"
                    >{saving ? 'Saving…' : 'Save'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Closed requests this month — combined across all modules so the
          parent sees the full month at a glance. */}
      <div className="mt-6">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-muted mb-2">
          Closed this month · {closedThisMonth.length}
        </p>
        {closedThisMonth.length === 0 ? (
          <div className="bg-hive-paper border border-hive-line rounded-hive p-5 text-center text-hive-muted text-sm">
            No purchases closed yet this month. They'll appear here as soon as a helper reconciles a shop.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {closedThisMonth.map((r) => {
              const total = r.actualTotalCents ?? r.estimatedTotalCents ?? 0;
              const m = MODULE_CARDS.find((x) => x.id === (r.module ?? 'pantry'));
              return (
                <Link
                  key={r.id}
                  href={`/pantry/purchase/${r.id}`}
                  className="bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
                >
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-base ${m?.tint ?? 'bg-pantry-leaf-soft'}`}>
                    {m?.emoji ?? '🧾'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{r.name}</div>
                    <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {m?.label ?? 'Pantry'} · {r.items.length} item{r.items.length === 1 ? '' : 's'} · closed {r.closedAt?.toDate?.().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                  <div className="font-nunito font-black text-sm text-hive-navy">
                    {formatCents(total, currency)}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
