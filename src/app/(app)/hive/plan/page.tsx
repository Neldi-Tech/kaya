'use client';

// /hive/plan — kid-set monthly spending plan. Per-category cents budget,
// progress bars, "X left" copy. Saves to families/{f}/kids/{kidId}/
// monthlyPlans/{YYYY-MM} via saveMonthlyPlan().
//
// Kids tweak categories with quick chips ("$5 / $10 / $15 / $20"); parents
// can also edit when viewing a kid's plan from the parent surface (same
// rule applies).

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { useHive } from '@/contexts/HiveContext';
import { saveMonthlyPlan, PLAN_CATEGORIES, TxCategory } from '@/lib/hive';
import KidSwitcher from '@/components/hive/KidSwitcher';
import NumberInput from '@/components/hive/NumberInput';
import BackButton from '@/components/ui/BackButton';
import { formatCash } from '@/components/hive/format';

const QUICK_AMOUNTS = [500, 1000, 1500, 2000, 3000]; // $5, $10, $15, $20, $30

export default function PlanPage() {
  const { profile, isGuest } = useAuth();
  const {
    activeKidId, monthlyPlan, monthKey, monthSpending, wallet, config,
  } = useHive();

  // Local working copy keyed by category id. Initialise from the saved
  // plan when it loads and re-sync if the kid is switched.
  const [budget, setBudget] = useState<Partial<Record<TxCategory, number>>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setBudget(monthlyPlan?.budget || {});
  }, [monthlyPlan, activeKidId]);

  const totalPlannedCents = useMemo(
    () => Object.values(budget).reduce<number>((sum, v) => sum + (v || 0), 0),
    [budget],
  );
  const totalSpentCents = useMemo(
    () => Object.values(monthSpending).reduce<number>((sum, v) => sum + (v || 0), 0),
    [monthSpending],
  );

  const dirty = useMemo(() => {
    const a = monthlyPlan?.budget || {};
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(budget)]));
    for (const k of keys) {
      const av = (a as any)[k] || 0;
      const bv = (budget as any)[k] || 0;
      if (av !== bv) return true;
    }
    return false;
  }, [budget, monthlyPlan]);

  const setCategory = (id: TxCategory, cents: number) => {
    setBudget((prev) => {
      const next = { ...prev };
      if (cents <= 0) delete next[id];
      else next[id] = Math.round(cents);
      return next;
    });
  };

  const useLastMonth = () => {
    if (!monthlyPlan?.budget) return;
    setBudget(monthlyPlan.budget);
  };

  const submit = async () => {
    if (!profile?.familyId || !activeKidId || isGuest) return;
    setError('');
    setSaving(true);
    try {
      await saveMonthlyPlan(profile.familyId, activeKidId, monthKey, budget);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } catch (e: any) {
      setError(e?.message || 'Failed to save the plan.');
    }
    setSaving(false);
  };

  const monthLabel = (() => {
    const [yyyy, mm] = monthKey.split('-').map((n) => parseInt(n, 10));
    if (!yyyy || !mm) return monthKey;
    const d = new Date(yyyy, mm - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  })();

  return (
    <div className="mx-auto max-w-md w-full lg:max-w-2xl px-4 lg:px-8 pt-4 lg:pt-8">
      <div className="lg:hidden"><BackButton /></div>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[3px] text-hive-honey-dk">Plan</p>
          <h1 className="font-nunito font-black text-3xl lg:text-[36px] mt-1">My spending plan 🗓️</h1>
          <p className="text-[12px] text-hive-muted mt-1">{monthLabel}</p>
        </div>
      </div>

      <KidSwitcher />

      {/* Top summary tile */}
      <div className="rounded-hive-lg bg-gradient-to-br from-[#FFE9C2] to-hive-honey-soft p-5 mb-4">
        <p className="text-[11px] font-nunito font-extrabold uppercase tracking-[2px] text-hive-honey-dk">This month</p>
        <div className="mt-2 grid grid-cols-3 gap-3 items-baseline">
          <div>
            <p className="font-nunito font-black text-2xl">{formatCash(wallet.cashCents, config.currency)}</p>
            <p className="text-[10px] text-hive-muted font-bold uppercase tracking-wider">Available</p>
          </div>
          <div>
            <p className="font-nunito font-black text-2xl text-hive-honey-dk">{formatCash(totalPlannedCents, config.currency)}</p>
            <p className="text-[10px] text-hive-muted font-bold uppercase tracking-wider">Planned</p>
          </div>
          <div>
            <p className="font-nunito font-black text-2xl text-hive-rose">{formatCash(totalSpentCents, config.currency)}</p>
            <p className="text-[10px] text-hive-muted font-bold uppercase tracking-wider">Spent</p>
          </div>
        </div>
      </div>

      {/* Per-category cards */}
      <div className="space-y-3">
        {PLAN_CATEGORIES.map((c) => {
          const planned = budget[c.id] || 0;
          const spent = monthSpending[c.id] || 0;
          const remaining = planned - spent;
          const pct = planned > 0 ? Math.min(100, Math.round((spent / planned) * 100)) : 0;
          const overBudget = planned > 0 && spent > planned;
          return (
            <div key={c.id} className="bg-hive-paper border border-hive-line rounded-hive p-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-[12px] bg-hive-honey-soft/60 flex items-center justify-center text-xl shrink-0">
                  {c.emoji}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-nunito font-extrabold text-[14px]">{c.label}</p>
                  {planned > 0 ? (
                    <p className="text-[11px] text-hive-muted">
                      <span className={overBudget ? 'text-hive-rose font-bold' : 'text-hive-green font-bold'}>
                        {formatCash(spent, config.currency)}
                      </span>{' '}of {formatCash(planned, config.currency)}
                      {!overBudget && remaining > 0 && (
                        <> · <strong className="text-hive-navy">{formatCash(remaining, config.currency)}</strong> left</>
                      )}
                      {overBudget && (
                        <> · <strong className="text-hive-rose">{formatCash(spent - planned, config.currency)} over</strong></>
                      )}
                    </p>
                  ) : (
                    <p className="text-[11px] text-hive-muted">No budget yet</p>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-hive-muted font-nunito font-bold text-base">$</span>
                  <NumberInput
                    value={planned / 100}
                    onChange={(n) => setCategory(c.id, Math.round(n * 100))}
                    allowDecimal
                    min={0}
                    ariaLabel={`${c.label} budget`}
                    placeholder="0"
                    className="w-24 h-10 px-2 bg-hive-cream rounded-[10px] text-right font-nunito font-black text-lg border border-hive-line focus:outline-none focus:ring-2 focus:ring-hive-honey/40"
                  />
                </div>
              </div>

              {/* Quick-amount chips */}
              <div className="flex flex-wrap gap-1.5 mb-2">
                {QUICK_AMOUNTS.map((cents) => (
                  <button
                    key={cents}
                    onClick={() => setCategory(c.id, cents)}
                    className={`px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border transition-colors ${
                      planned === cents
                        ? 'bg-hive-honey text-white border-transparent'
                        : 'border-hive-line bg-hive-paper text-hive-muted hover:border-hive-honey/40'
                    }`}
                  >
                    ${cents / 100}
                  </button>
                ))}
                {planned > 0 && (
                  <button
                    onClick={() => setCategory(c.id, 0)}
                    className="px-2.5 py-1 rounded-hive-pill text-[11px] font-nunito font-extrabold border border-hive-line bg-hive-paper text-hive-muted hover:text-hive-rose"
                  >
                    Clear
                  </button>
                )}
              </div>

              {planned > 0 && (
                <div className="h-2 bg-hive-line rounded-hive-pill overflow-hidden">
                  <div
                    className={`h-full rounded-hive-pill transition-[width] ${overBudget ? 'bg-hive-rose' : 'bg-hive-honey'}`}
                    style={{ width: `${overBudget ? 100 : pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {monthlyPlan?.budget && Object.keys(monthlyPlan.budget).length > 0 && !dirty && (
        <p className="text-center text-[11px] text-hive-muted mt-4">
          Plan saved for {monthLabel}. Tweak the numbers above any time.
        </p>
      )}

      {error && (
        <p className="text-hive-rose text-sm font-bold mt-3 text-center">{error}</p>
      )}

      {/* Sticky-ish footer actions */}
      <div className="mt-4 mb-2 flex items-center gap-3">
        <button
          onClick={submit}
          disabled={!dirty || saving || isGuest}
          className="flex-1 h-12 rounded-hive bg-hive-honey hover:bg-hive-honey-dk text-white font-nunito font-black text-sm disabled:opacity-40 transition-colors shadow-[0_8px_20px_-8px_rgba(243,156,47,0.5)]"
        >
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save plan'}
        </button>
        {monthlyPlan?.budget && !dirty && (
          <button
            onClick={useLastMonth}
            className="h-12 px-4 rounded-hive-pill border border-hive-line bg-hive-paper text-[12px] font-nunito font-extrabold text-hive-muted"
            type="button"
          >
            Reset to saved
          </button>
        )}
      </div>

      <p className="text-center text-[11px] text-hive-muted mt-2 leading-relaxed">
        Plans are a guide — they don&apos;t block spending. When you ask to spend, you&apos;ll see if it&apos;s within budget.{' '}
        <Link href="/hive/cash-out" className="text-hive-honey-dk font-bold hover:underline">Request a spend →</Link>
      </p>
    </div>
  );
}
