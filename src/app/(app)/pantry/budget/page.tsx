'use client';

// /pantry/budget — Household → Pantry Budget (Step 1 v1).
//
// This is the per-module Budget the design proposal calls for:
// the cap a parent sets for Pantry, plus the rolling spend from
// every closed PurchaseRequest in the current month. Future steps
// add External / Utility / Payroll budgets as siblings on this
// page and roll the lot into Household Finances.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/AuthContext';
import { useFamily } from '@/contexts/FamilyContext';
import { useHive } from '@/contexts/HiveContext';
import {
  type PurchaseRequest, subscribeToRecentRequests,
} from '@/lib/purchase';
import { formatCents } from '@/components/pantry/format';

const monthKey = (d: Date = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (d: Date = new Date()) =>
  d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export default function BudgetPage() {
  const { profile, isGuest } = useAuth();
  const { family } = useFamily();
  const { config } = useHive();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  const cap = family?.householdBudgets?.pantry ?? 0;
  const [editing, setEditing] = useState(false);
  const [draftCap, setDraftCap] = useState('');
  const [saving, setSaving] = useState(false);

  const [recent, setRecent] = useState<PurchaseRequest[]>([]);
  useEffect(() => {
    if (!profile?.familyId) return;
    return subscribeToRecentRequests(profile.familyId, setRecent);
  }, [profile?.familyId]);

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
  const spent = closedThisMonth.reduce(
    (acc, r) => acc + (r.actualTotalCents ?? r.estimatedTotalCents ?? 0),
    0,
  );
  const pct = cap > 0 ? Math.min(100, Math.round((spent / cap) * 100)) : 0;
  const over = cap > 0 && spent > cap;

  const startEdit = () => {
    setDraftCap(cap > 0 ? (cap / 100).toFixed(2) : '');
    setEditing(true);
  };
  const saveCap = async () => {
    if (!profile?.familyId || isGuest) { setEditing(false); return; }
    setSaving(true);
    try {
      const cents = draftCap === '' ? 0 : Math.round(parseFloat(draftCap) * 100);
      await updateDoc(doc(db, 'families', profile.familyId), {
        'householdBudgets.pantry': cents,
      });
      setEditing(false);
    } finally { setSaving(false); }
  };

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
          Per-module caps roll into Household Finances. Step 1 covers Pantry; the rest land as those modules ship.
        </p>
      </div>

      {/* Pantry budget card */}
      <div className={`mt-4 rounded-hive border p-4 ${
        over ? 'bg-[#FCEAEA] border-[#E8B5B5]' : 'bg-pantry-leaf-soft border-pantry-leaf'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[1.5px] text-pantry-leaf-dk">🛒 Pantry</p>
            <p className="font-nunito font-black text-2xl text-hive-ink mt-1">
              {formatCents(spent, currency)}
              <span className="text-hive-muted text-sm font-bold">
                {' '}of {cap > 0 ? formatCents(cap, currency) : '—'}
              </span>
            </p>
          </div>
          {isParent && !editing && (
            <button
              onClick={startEdit}
              className="text-xs font-nunito font-bold text-pantry-leaf-dk bg-white border border-pantry-leaf-soft rounded-full px-3 py-1.5"
            >
              {cap > 0 ? 'Edit cap' : 'Set cap'}
            </button>
          )}
        </div>

        {/* Progress bar (only meaningful with a cap) */}
        {cap > 0 && (
          <div className="mt-3 h-2 bg-white/70 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full ${over ? 'bg-hive-rose' : 'bg-pantry-leaf-dk'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        {/* Cap editor — parent only */}
        {isParent && editing && (
          <div className="mt-3 bg-white border border-pantry-leaf-soft rounded-xl p-3">
            <label className="text-[10px] font-bold text-hive-muted uppercase tracking-[1.5px]">
              Monthly cap ({currency})
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
                onClick={() => setEditing(false)}
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

      {/* Closed requests this month */}
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
              return (
                <Link
                  key={r.id}
                  href={`/pantry/purchase/${r.id}`}
                  className="bg-hive-paper border border-hive-line rounded-hive p-3.5 flex items-center gap-3 no-underline"
                >
                  <div className="w-10 h-10 rounded-xl bg-pantry-leaf-soft flex items-center justify-center text-base">🧾</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-nunito font-extrabold text-sm text-hive-navy truncate">{r.name}</div>
                    <div className="text-[11px] text-hive-muted font-bold mt-0.5">
                      {r.items.length} items · closed {r.closedAt?.toDate?.().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
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

      <p className="text-[11px] text-hive-muted text-center mt-8 font-bold">
        External · Utility · Payroll budgets land as those modules ship.
      </p>
    </div>
  );
}
