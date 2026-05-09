'use client';

// /pantry/budget — monthly budget per category with live spend
// tracking. Parents-only edit per the design (helpers + kids read).
// Spent comes from spentByCategoryInMonth on every list with weekOf
// in the active month, summed by item.category.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePantry } from '@/contexts/PantryContext';
import { useHive } from '@/contexts/HiveContext';
import {
  STAPLE_CATEGORIES, StapleCategory,
  savePantryBudget, monthLabel,
} from '@/lib/pantry';
import { formatCents } from '@/components/pantry/format';
import NumberInput from '@/components/ui/NumberInput';
import BackButton from '@/components/ui/BackButton';

const QUICK_AMOUNTS_USD = [25, 50, 100, 200];
const QUICK_AMOUNTS_TZS = [25000, 50000, 100000, 200000];
const QUICK_AMOUNTS_KES = [2500, 5000, 10000, 20000];

function quickAmountsFor(currency: string): number[] {
  switch (currency) {
    case 'TZS': case 'UGX': return QUICK_AMOUNTS_TZS;
    case 'KES': return QUICK_AMOUNTS_KES;
    case 'NGN': return QUICK_AMOUNTS_TZS;
    default: return QUICK_AMOUNTS_USD;
  }
}

export default function BudgetPage() {
  const { profile, isGuest } = useAuth();
  const { budget, monthSpentByCategory, monthSpentTotalCents, monthKey } = usePantry();
  const { config } = useHive();
  const currency = config.currency;
  const isParent = profile?.role === 'parent';

  // Working copy keyed by category (cents). Re-syncs when the persisted
  // budget changes externally.
  const [working, setWorking] = useState<Partial<Record<StapleCategory, number>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setWorking(budget?.categoryBudgets || {});
  }, [budget]);

  const totalPlannedCents = useMemo(
    () => Object.values(working).reduce<number>((sum, v) => sum + (v || 0), 0),
    [working],
  );

  const dirty = useMemo(() => {
    const a = budget?.categoryBudgets || {};
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(working)]));
    for (const k of keys) {
      if (((a as any)[k] || 0) !== ((working as any)[k] || 0)) return true;
    }
    return false;
  }, [working, budget]);

  const setCategory = (id: StapleCategory, cents: number) => {
    setWorking((prev) => {
      const next = { ...prev };
      if (cents <= 0) delete next[id];
      else next[id] = Math.round(cents);
      return next;
    });
  };

  const submit = async () => {
    if (!profile?.familyId || !profile?.uid || isGuest) return;
    setError('');
    setSaving(true);
    try {
      await savePantryBudget(profile.familyId, monthKey, working, profile.uid);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e: any) {
      setError(e?.message || 'Failed to save the budget.');
    }
    setSaving(false);
  };

  const remaining = Math.max(0, totalPlannedCents - monthSpentTotalCents);
  const pct = totalPlannedCents > 0 ? Math.min(100, Math.round((monthSpentTotalCents / totalPlannedCents) * 100)) : 0;
  const overall = totalPlannedCents > 0 && monthSpentTotalCents > totalPlannedCents;
  const quickAmounts = quickAmountsFor(currency);

  // Days remaining → "TSh X / day average pace" footer copy.
  const daysLeft = (() => {
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return lastDay - now.getDate();
  })();

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-3xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-pantry-leaf-dk">
          Pantry · Budget
        </p>
        <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">{monthLabel(monthKey)} 💰</h1>
      </div>

      {/* Top tile */}
      <div className={`rounded-hive-lg p-5 mb-4 ${
        overall
          ? 'bg-gradient-to-br from-[#FCEAEA] to-white border border-hive-rose'
          : 'bg-gradient-to-br from-pantry-leaf-soft to-white border border-pantry-leaf'
      }`}>
        <p className={`text-[10px] font-bold uppercase tracking-[1.5px] ${overall ? 'text-hive-rose' : 'text-pantry-leaf-dk'}`}>
          This month
        </p>
        <div className="flex items-baseline gap-2 mt-1">
          <span className={`font-nunito font-black text-3xl ${overall ? 'text-hive-rose' : 'text-hive-navy'}`}>
            {formatCents(monthSpentTotalCents, currency)}
          </span>
          <span className="text-[12px] text-hive-muted font-bold">
            of {totalPlannedCents > 0 ? formatCents(totalPlannedCents, currency) : '— no budget set —'}
          </span>
        </div>
        {totalPlannedCents > 0 && (
          <>
            <div className="h-2 bg-white/60 rounded-hive-pill overflow-hidden mt-2">
              <div
                className={`h-full rounded-hive-pill transition-[width] ${overall ? 'bg-hive-rose' : 'bg-pantry-leaf'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className={`text-[11px] font-bold mt-2 ${overall ? 'text-hive-rose' : 'text-pantry-leaf-dk'}`}>
              {overall
                ? `⚠️ ${formatCents(monthSpentTotalCents - totalPlannedCents, currency)} over · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
                : `${formatCents(remaining, currency)} left · ${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
            </p>
          </>
        )}
      </div>

      {/* Per-category cards */}
      <div className="space-y-2.5">
        {STAPLE_CATEGORIES.map((c) => {
          const planned = working[c.id] || 0;
          const spent = monthSpentByCategory[c.id] || 0;
          const overC = planned > 0 && spent > planned;
          const pctC = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : 0;
          return (
            <div key={c.id} className="bg-hive-paper border border-hive-line rounded-hive p-3">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-9 h-9 rounded-[10px] bg-pantry-leaf-soft text-pantry-leaf-dk flex items-center justify-center text-lg shrink-0">
                  {c.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[13px]">{c.label}</p>
                  {planned > 0 ? (
                    <p className="text-[11px] text-hive-muted">
                      <span className={overC ? 'text-hive-rose font-bold' : 'text-pantry-leaf-dk font-bold'}>
                        {formatCents(spent, currency)}
                      </span>{' '}of {formatCents(planned, currency)}
                      {!overC && spent < planned && (
                        <> · <strong className="text-hive-navy">{formatCents(planned - spent, currency)}</strong> left</>
                      )}
                      {overC && (
                        <> · <strong className="text-hive-rose">{formatCents(spent - planned, currency)} over</strong></>
                      )}
                    </p>
                  ) : (
                    <p className="text-[11px] text-hive-muted">
                      No budget · {formatCents(spent, currency)} spent so far
                    </p>
                  )}
                </div>
                {isParent && (
                  <div className="flex items-baseline gap-1">
                    <span className="text-hive-muted font-nunito font-bold text-[11px]">
                      {currency === 'USD' ? '$' : currency}
                    </span>
                    <NumberInput
                      value={planned / 100}
                      onChange={(n) => setCategory(c.id, Math.round(n * 100))}
                      allowDecimal={currency === 'USD' || currency === 'EUR' || currency === 'GBP'}
                      min={0}
                      ariaLabel={`${c.label} budget`}
                      placeholder="0"
                      className="w-24 h-9 px-2 bg-hive-cream rounded-[10px] text-right font-nunito font-black text-[13px] border border-hive-line focus:outline-none focus:ring-2 focus:ring-pantry-leaf/40"
                    />
                  </div>
                )}
              </div>
              {planned > 0 && (
                <div className="h-1.5 bg-hive-line rounded-hive-pill overflow-hidden">
                  <div
                    className={`h-full rounded-hive-pill transition-[width] ${overC ? 'bg-hive-rose' : 'bg-pantry-leaf'}`}
                    style={{ width: `${overC ? 100 : pctC}%` }}
                  />
                </div>
              )}
              {isParent && quickAmounts.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {quickAmounts.map((v) => (
                    <button
                      key={v}
                      onClick={() => setCategory(c.id, v * 100)}
                      className={`px-2 py-1 rounded-hive-pill text-[10px] font-nunito font-extrabold border transition-colors ${
                        planned === v * 100
                          ? 'bg-pantry-leaf text-white border-transparent'
                          : 'border-hive-line bg-hive-paper text-hive-muted hover:border-pantry-leaf/40'
                      }`}
                    >
                      {currency === 'USD' || currency === 'EUR' || currency === 'GBP' ? `${currency === 'USD' ? '$' : ''}${v}` : `${v.toLocaleString('en-US')}`}
                    </button>
                  ))}
                  {planned > 0 && (
                    <button
                      onClick={() => setCategory(c.id, 0)}
                      className="px-2 py-1 rounded-hive-pill text-[10px] font-nunito font-extrabold border border-hive-line bg-hive-paper text-hive-muted hover:text-hive-rose"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {error && <p className="text-hive-rose text-[12px] font-bold mt-3">{error}</p>}

      {isParent && (
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={submit}
            disabled={!dirty || saving || isGuest}
            className="flex-1 h-12 rounded-hive bg-pantry-leaf hover:bg-pantry-leaf-dk text-white font-nunito font-black text-sm disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(91,168,140,0.5)]"
          >
            {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save budget'}
          </button>
          {dirty && !saving && (
            <button
              onClick={() => setWorking(budget?.categoryBudgets || {})}
              className="h-12 px-4 rounded-hive-pill border border-hive-line bg-hive-paper text-[11px] font-nunito font-extrabold text-hive-muted"
            >
              Reset
            </button>
          )}
        </div>
      )}

      <p className="text-center text-[11px] text-hive-muted mt-4 leading-relaxed">
        Spend totals come from item costs on every list with a {monthLabel(monthKey)} week.{' '}
        <Link href="/pantry" className="text-pantry-leaf-dk font-bold hover:underline">← Back to Pantry</Link>
      </p>
    </div>
  );
}
